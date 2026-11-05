-- =====================================================================
-- 02_advanced.sql : Views, Functions, Stored Procedures, Triggers
-- Run:  mysql -u root -p hospital_dispatch < 02_advanced.sql
-- =====================================================================
USE hospital_dispatch;

-- ============================ VIEWS ==================================
CREATE OR REPLACE VIEW v_hospital_bed_availability AS
SELECT h.hospital_id, h.name AS hospital_name, w.ward_id, w.ward_type,
       COUNT(b.bed_id)                                   AS total_beds,
       CAST(COALESCE(SUM(b.status = 'Occupied'),    0) AS SIGNED) AS occupied,
       CAST(COALESCE(SUM(b.status = 'Available'),   0) AS SIGNED) AS available,
       CAST(COALESCE(SUM(b.status = 'Maintenance'), 0) AS SIGNED) AS maintenance,
       ROUND(100 * COALESCE(SUM(b.status = 'Occupied'), 0) / NULLIF(COUNT(b.bed_id), 0), 1) AS occupancy_pct
FROM hospital h
JOIN ward w      ON w.hospital_id = h.hospital_id
LEFT JOIN bed b  ON b.ward_id = w.ward_id
GROUP BY h.hospital_id, h.name, w.ward_id, w.ward_type;

CREATE OR REPLACE VIEW v_active_dispatches AS
SELECT d.request_id, d.status, d.dispatch_time,
       c.call_id, c.pickup_location, c.severity, c.call_time,
       v.vehicle_id, v.registration_no, v.vehicle_type,
       dr.driver_id, dr.full_name AS driver_name, dr.phone_number AS driver_phone,
       h.hospital_id AS dest_hospital_id, h.name AS dest_hospital
FROM dispatch_request d
JOIN emergency_call c ON c.call_id = d.call_id
JOIN vehicle v        ON v.vehicle_id = d.vehicle_id
JOIN driver dr        ON dr.driver_id = d.driver_id
JOIN hospital h       ON h.hospital_id = d.hospital_id
WHERE d.status IN ('Dispatched','En_Route','Arrived');

CREATE OR REPLACE VIEW v_fleet_status AS
SELECT h.hospital_id, h.name AS hospital_name, v.vehicle_type,
       COUNT(*) AS total,
       CAST(SUM(v.status = 'Available')   AS SIGNED) AS available,
       CAST(SUM(v.status = 'Dispatched')  AS SIGNED) AS dispatched,
       CAST(SUM(v.status = 'Maintenance') AS SIGNED) AS maintenance
FROM vehicle v JOIN hospital h ON h.hospital_id = v.hospital_id
GROUP BY h.hospital_id, h.name, v.vehicle_type;

DELIMITER $$

-- ============================ FUNCTION ===============================
DROP FUNCTION IF EXISTS fn_available_beds$$
CREATE FUNCTION fn_available_beds(p_hospital_id INT) RETURNS INT
READS SQL DATA
BEGIN
  DECLARE v_cnt INT DEFAULT 0;
  SELECT COUNT(*) INTO v_cnt
  FROM bed b JOIN ward w ON w.ward_id = b.ward_id
  WHERE w.hospital_id = p_hospital_id AND b.status = 'Available';
  RETURN v_cnt;
END$$

-- ============================ TRIGGERS ===============================
-- Hospital capacity guard: sum(ward.total_beds) <= hospital.capacity
DROP TRIGGER IF EXISTS trg_ward_bi$$
CREATE TRIGGER trg_ward_bi BEFORE INSERT ON ward FOR EACH ROW
BEGIN
  IF (SELECT COALESCE(SUM(total_beds),0) FROM ward WHERE hospital_id = NEW.hospital_id) + NEW.total_beds
     > (SELECT capacity FROM hospital WHERE hospital_id = NEW.hospital_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ward beds exceed hospital capacity';
  END IF;
END$$

-- Ward capacity guard: cannot create more bed rows than ward.total_beds
DROP TRIGGER IF EXISTS trg_bed_bi$$
CREATE TRIGGER trg_bed_bi BEFORE INSERT ON bed FOR EACH ROW
BEGIN
  IF (SELECT COUNT(*) FROM bed WHERE ward_id = NEW.ward_id)
     >= (SELECT total_beds FROM ward WHERE ward_id = NEW.ward_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ward is already at its total_beds limit';
  END IF;
END$$

-- Bed must be free before allocation
DROP TRIGGER IF EXISTS trg_alloc_bi$$
CREATE TRIGGER trg_alloc_bi BEFORE INSERT ON bed_allocation FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  IF NEW.discharge_time IS NULL THEN
    SELECT status INTO v_status FROM bed WHERE bed_id = NEW.bed_id;
    IF v_status IS NULL OR v_status <> 'Available' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Bed is not available for allocation';
    END IF;
  END IF;
END$$

-- Allocation => bed becomes Occupied
DROP TRIGGER IF EXISTS trg_alloc_ai$$
CREATE TRIGGER trg_alloc_ai AFTER INSERT ON bed_allocation FOR EACH ROW
BEGIN
  IF NEW.discharge_time IS NULL THEN
    UPDATE bed SET status = 'Occupied' WHERE bed_id = NEW.bed_id;
  END IF;
END$$

-- Discharge => bed becomes Available again
DROP TRIGGER IF EXISTS trg_alloc_au$$
CREATE TRIGGER trg_alloc_au AFTER UPDATE ON bed_allocation FOR EACH ROW
BEGIN
  IF OLD.discharge_time IS NULL AND NEW.discharge_time IS NOT NULL THEN
    UPDATE bed SET status = 'Available' WHERE bed_id = NEW.bed_id AND status = 'Occupied';
  END IF;
END$$

-- Dispatch: vehicle and driver must both be free
DROP TRIGGER IF EXISTS trg_dispatch_bi$$
CREATE TRIGGER trg_dispatch_bi BEFORE INSERT ON dispatch_request FOR EACH ROW
BEGIN
  IF NEW.status IN ('Dispatched','En_Route','Arrived') THEN
    IF (SELECT status FROM vehicle WHERE vehicle_id = NEW.vehicle_id) <> 'Available' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vehicle is not available';
    END IF;
    IF (SELECT status FROM driver WHERE driver_id = NEW.driver_id) <> 'Available' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Driver is not available';
    END IF;
  END IF;
END$$

DROP TRIGGER IF EXISTS trg_dispatch_ai$$
CREATE TRIGGER trg_dispatch_ai AFTER INSERT ON dispatch_request FOR EACH ROW
BEGIN
  IF NEW.status IN ('Dispatched','En_Route','Arrived') THEN
    UPDATE vehicle SET status = 'Dispatched' WHERE vehicle_id = NEW.vehicle_id;
    UPDATE driver  SET status = 'On_Duty'    WHERE driver_id  = NEW.driver_id;
  END IF;
END$$

-- Completed / Cancelled => free the vehicle and driver
DROP TRIGGER IF EXISTS trg_dispatch_au$$
CREATE TRIGGER trg_dispatch_au AFTER UPDATE ON dispatch_request FOR EACH ROW
BEGIN
  IF OLD.status IN ('Dispatched','En_Route','Arrived') AND NEW.status IN ('Completed','Cancelled') THEN
    UPDATE vehicle SET status = 'Available' WHERE vehicle_id = NEW.vehicle_id AND status = 'Dispatched';
    UPDATE driver  SET status = 'Available' WHERE driver_id  = NEW.driver_id  AND status = 'On_Duty';
  END IF;
END$$

-- ====================== STORED PROCEDURES ============================
-- 1) Admit patient + pick best bed atomically (transaction + row locks)
DROP PROCEDURE IF EXISTS sp_register_and_allocate$$
CREATE PROCEDURE sp_register_and_allocate(
  IN p_name VARCHAR(100), IN p_age INT, IN p_gender VARCHAR(1),
  IN p_severity VARCHAR(10), IN p_hospital_id INT, IN p_complaint VARCHAR(255))
BEGIN
  DECLARE v_patient INT DEFAULT NULL;
  DECLARE v_bed     INT DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  -- Critical/High go to ICU first; others to Emergency/General first.
  -- SKIP LOCKED => two concurrent admissions never fight for the same bed.
  SELECT b.bed_id INTO v_bed
  FROM bed b JOIN ward w ON w.ward_id = b.ward_id
  WHERE w.hospital_id = p_hospital_id AND b.status = 'Available'
  ORDER BY CASE WHEN p_severity IN ('Critical','High')
                THEN FIELD(w.ward_type,'ICU','Trauma','Emergency','General','Pediatric')
                ELSE FIELD(w.ward_type,'Emergency','General','Trauma','Pediatric','ICU') END,
           b.bed_id
  LIMIT 1
  FOR UPDATE OF b SKIP LOCKED;

  IF v_bed IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No bed available in this hospital';
  END IF;

  INSERT INTO patient (name, age, gender, severity, chief_complaint)
  VALUES (p_name, p_age, p_gender, p_severity, p_complaint);
  SET v_patient = LAST_INSERT_ID();

  INSERT INTO bed_allocation (bed_id, patient_id) VALUES (v_bed, v_patient);

  COMMIT;

  SELECT v_patient AS patient_id, v_bed AS bed_id, w.ward_type, bd.bed_number, p_hospital_id AS hospital_id
  FROM bed bd JOIN ward w ON w.ward_id = bd.ward_id WHERE bd.bed_id = v_bed;
END$$

-- 2) Discharge patient (trigger frees the bed)
DROP PROCEDURE IF EXISTS sp_discharge_patient$$
CREATE PROCEDURE sp_discharge_patient(IN p_patient_id INT)
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;
  UPDATE bed_allocation SET discharge_time = NOW()
  WHERE patient_id = p_patient_id AND discharge_time IS NULL;
  IF ROW_COUNT() = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Patient has no active bed allocation';
  END IF;
  COMMIT;
  SELECT p_patient_id AS patient_id, 'Discharged' AS result;
END$$

-- 3) Dispatch ambulance: p_vehicle_id / p_hospital_id optional (NULL = auto)
--    The API passes the geo-nearest vehicle found in MongoDB; MySQL stays
--    the source of truth and falls back to auto-selection if it is stale.
DROP PROCEDURE IF EXISTS sp_dispatch_ambulance$$
CREATE PROCEDURE sp_dispatch_ambulance(
  IN p_call_id INT, IN p_vehicle_id INT, IN p_hospital_id INT)
BEGIN
  DECLARE v_sev     VARCHAR(10) DEFAULT NULL;
  DECLARE v_vehicle INT DEFAULT NULL;
  DECLARE v_driver  INT DEFAULT NULL;
  DECLARE v_hosp    INT DEFAULT NULL;
  DECLARE v_req     INT DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  -- [merge] FOR UPDATE serialises two dispatchers (or a double-click) working on the SAME call
  SELECT severity INTO v_sev FROM emergency_call WHERE call_id = p_call_id FOR UPDATE;
  IF v_sev IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Emergency call not found';
  END IF;
  -- [merge] a call may be re-dispatched only after its earlier dispatch was Cancelled
  IF EXISTS (SELECT 1 FROM dispatch_request WHERE call_id = p_call_id AND status <> 'Cancelled') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Call already dispatched';
  END IF;

  IF p_vehicle_id IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle FROM vehicle
    WHERE vehicle_id = p_vehicle_id AND status = 'Available'
    FOR UPDATE;
  END IF;

  IF v_vehicle IS NULL THEN
    SELECT vehicle_id INTO v_vehicle FROM vehicle
    WHERE status = 'Available'
    ORDER BY CASE WHEN v_sev IN ('Critical','High')
                  THEN FIELD(vehicle_type,'ICU','ALS','BLS','Neonatal')
                  ELSE FIELD(vehicle_type,'BLS','ALS','ICU','Neonatal') END,
             vehicle_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  END IF;
  IF v_vehicle IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No available vehicle';
  END IF;

  SELECT driver_id INTO v_driver FROM driver
  WHERE status = 'Available' ORDER BY driver_id LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF v_driver IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No available driver';
  END IF;

  IF p_hospital_id IS NOT NULL THEN
    SET v_hosp = p_hospital_id;
  ELSE
    SELECT hospital_id INTO v_hosp FROM hospital
    ORDER BY fn_available_beds(hospital_id) DESC, hospital_id LIMIT 1;
  END IF;
  IF v_hosp IS NULL OR fn_available_beds(v_hosp) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Destination hospital has no free beds';
  END IF;

  INSERT INTO dispatch_request (call_id, vehicle_id, driver_id, hospital_id)
  VALUES (p_call_id, v_vehicle, v_driver, v_hosp);
  SET v_req = LAST_INSERT_ID();

  COMMIT;

  SELECT d.request_id, d.status, d.dispatch_time, v.vehicle_id, v.registration_no, v.vehicle_type,
         dr.driver_id, dr.full_name AS driver_name, h.hospital_id, h.name AS hospital_name
  FROM dispatch_request d
  JOIN vehicle v  ON v.vehicle_id = d.vehicle_id
  JOIN driver dr  ON dr.driver_id = d.driver_id
  JOIN hospital h ON h.hospital_id = d.hospital_id
  WHERE d.request_id = v_req;
END$$

-- 4) Controlled status transitions
DROP PROCEDURE IF EXISTS sp_update_dispatch_status$$
CREATE PROCEDURE sp_update_dispatch_status(IN p_request_id INT, IN p_status VARCHAR(15))
BEGIN
  DECLARE v_old VARCHAR(15) DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;
  SELECT status INTO v_old FROM dispatch_request WHERE request_id = p_request_id FOR UPDATE;
  IF v_old IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Dispatch request not found';
  END IF;
  IF NOT ( (v_old = 'Dispatched' AND p_status IN ('En_Route','Cancelled'))
        OR (v_old = 'En_Route'   AND p_status IN ('Arrived','Cancelled'))
        OR (v_old = 'Arrived'    AND p_status IN ('Completed','Cancelled')) ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid dispatch status transition';
  END IF;
  UPDATE dispatch_request SET status = p_status WHERE request_id = p_request_id;
  COMMIT;
  SELECT p_request_id AS request_id, v_old AS old_status, p_status AS new_status;
END$$

-- 5) [merge] Create a ward AND its N beds atomically (Hospitals page -> "Add ward").
--    trg_ward_bi enforces sum(ward beds) <= hospital capacity; trg_bed_bi enforces the ward limit.
--    Bed numbers follow the seed convention: first letter of the ward type + 2-digit counter (I01, E01, G01 ...).
DROP PROCEDURE IF EXISTS sp_add_ward$$
CREATE PROCEDURE sp_add_ward(IN p_hospital_id INT, IN p_ward_type VARCHAR(20), IN p_total_beds INT)
BEGIN
  DECLARE v_ward INT DEFAULT NULL;
  DECLARE i INT DEFAULT 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  IF p_total_beds IS NULL OR p_total_beds < 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A ward needs at least 1 bed';
  END IF;
  START TRANSACTION;
  INSERT INTO ward (hospital_id, ward_type, total_beds) VALUES (p_hospital_id, p_ward_type, p_total_beds);
  SET v_ward = LAST_INSERT_ID();
  WHILE i <= p_total_beds DO
    INSERT INTO bed (ward_id, bed_number) VALUES (v_ward, CONCAT(LEFT(p_ward_type, 1), LPAD(i, 2, '0')));
    SET i = i + 1;
  END WHILE;
  COMMIT;
  SELECT v_ward AS ward_id, p_total_beds AS beds_created;
END$$

DELIMITER ;
