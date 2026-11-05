-- =====================================================================
-- 05_test_cases.sql : integrity / concurrency-safety test cases
-- Each statement marked EXPECT ERROR must fail; others must succeed.
-- Run on a FRESHLY seeded DB (01 -> 02 -> 03 -> 05), before 04_queries.sql,
-- using --force so one expected failure does not stop the file:
--   mysql -u root -p --force hospital_dispatch < 05_test_cases.sql
-- =====================================================================
USE hospital_dispatch;

-- T1 EXPECT ERROR (CHECK): invalid age
INSERT INTO patient (name, age, gender, severity) VALUES ('Bad Age', 200, 'M', 'Low');

-- T2 EXPECT ERROR (ENUM): invalid severity
INSERT INTO patient (name, age, gender, severity) VALUES ('Bad Sev', 30, 'M', 'Extreme');

-- T3 EXPECT ERROR (trigger): allocate an already-occupied bed
INSERT INTO patient (name, age, gender, severity) VALUES ('T3 Patient', 30, 'F', 'Low');
SET @occupied_bed = (SELECT bed_id FROM bed WHERE status = 'Occupied' LIMIT 1);
INSERT INTO bed_allocation (bed_id, patient_id) VALUES (@occupied_bed, LAST_INSERT_ID());

-- T4 EXPECT ERROR (UNIQUE generated col): patient 1 already has an active bed
SET @free_bed = (SELECT bed_id FROM bed WHERE status = 'Available' LIMIT 1);
INSERT INTO bed_allocation (bed_id, patient_id) VALUES (@free_bed, 1);

-- T5 EXPECT ERROR (CHECK): discharge before allocation
INSERT INTO bed_allocation (bed_id, patient_id, allocated_time, discharge_time)
VALUES (@free_bed, 2, NOW(), NOW() - INTERVAL 1 DAY);

-- T6 EXPECT ERROR (trigger): dispatch a vehicle that is already dispatched (vehicle 2)
INSERT INTO dispatch_request (call_id, vehicle_id, driver_id, hospital_id) VALUES (8, 2, 3, 1);

-- T7 EXPECT ERROR (FK): dispatch to a non-existent hospital
SET @v = (SELECT vehicle_id FROM vehicle WHERE status='Available' LIMIT 1);
SET @d = (SELECT driver_id  FROM driver  WHERE status='Available' LIMIT 1);
INSERT INTO dispatch_request (call_id, vehicle_id, driver_id, hospital_id) VALUES (8, @v, @d, 999);

-- T8 EXPECT ERROR (trigger): ward larger than hospital capacity
INSERT INTO ward (hospital_id, ward_type, total_beds) VALUES (3, 'Trauma', 500);

-- T9 EXPECT ERROR (CHECK): bad phone format
INSERT INTO emergency_call (caller_phone, pickup_location, severity) VALUES ('abc', 'Nowhere', 'Low');

-- T10 EXPECT SUCCESS: full admit -> bed Occupied -> discharge -> bed Available
CALL sp_register_and_allocate('T10 Patient', 40, 'M', 'High', 2, 'Test');
SELECT b.bed_id, b.status FROM bed b JOIN bed_allocation ba ON ba.bed_id=b.bed_id
 WHERE ba.patient_id = (SELECT MAX(patient_id) FROM patient) AND ba.discharge_time IS NULL;  -- Occupied
CALL sp_discharge_patient((SELECT MAX(patient_id) FROM patient));
SELECT status FROM bed WHERE bed_id = (SELECT bed_id FROM bed_allocation ORDER BY allocation_id DESC LIMIT 1); -- Available

-- T11 EXPECT SUCCESS: dispatch lifecycle frees vehicle + driver
CALL sp_dispatch_ambulance(8, NULL, NULL);
SET @req = (SELECT MAX(request_id) FROM dispatch_request);
CALL sp_update_dispatch_status(@req, 'En_Route');
CALL sp_update_dispatch_status(@req, 'Arrived');
CALL sp_update_dispatch_status(@req, 'Completed');
SELECT v.status AS vehicle_status, dr.status AS driver_status
FROM dispatch_request d JOIN vehicle v ON v.vehicle_id=d.vehicle_id JOIN driver dr ON dr.driver_id=d.driver_id
WHERE d.request_id = @req;                                         -- Available / Available

-- T12 EXPECT ERROR: invalid transition (Completed -> En_Route)
CALL sp_update_dispatch_status(@req, 'En_Route');

-- T13 EXPECT ERROR + ROLLBACK: hospital with no free bed -> procedure fails and
-- leaves NO orphan patient row (compare the two counts: they must be equal)
UPDATE bed b JOIN ward w ON w.ward_id=b.ward_id SET b.status='Maintenance'
 WHERE w.hospital_id = 3 AND b.status='Available';
SELECT COUNT(*) AS patients_before FROM patient;
CALL sp_register_and_allocate('T13 Patient', 50, 'F', 'High', 3, 'No bed test');
SELECT COUNT(*) AS patients_after FROM patient;
