-- =====================================================================
-- 04_queries.sql : DML + important queries (JOIN, GROUP BY, HAVING,
-- ORDER BY, aggregates, subqueries, window fn, FULLTEXT, views, procs)
-- =====================================================================
USE hospital_dispatch;

-- ---------- DML ----------
INSERT INTO emergency_call (caller_phone, pickup_location, severity, pickup_lat, pickup_lng)
VALUES ('9911223344', 'Residency Road near Brigade Tower', 'High', 12.970000, 77.606000);

UPDATE bed SET status = 'Maintenance'
WHERE bed_id = 60 AND status = 'Available';                       -- take a bed out of service

DELETE FROM emergency_call
WHERE call_id NOT IN (SELECT call_id FROM dispatch_request)
  AND call_time < NOW() - INTERVAL 30 DAY;                        -- purge stale undispatched calls

-- ---------- Q1: live bed availability per hospital (view + JOIN + aggregate) ----------
SELECT hospital_name, SUM(total_beds) AS beds, SUM(available) AS free_beds,
       ROUND(100*SUM(occupied)/SUM(total_beds),1) AS occupancy_pct
FROM v_hospital_bed_availability
GROUP BY hospital_id, hospital_name
ORDER BY free_beds DESC;

-- ---------- Q2: wards above 70% occupancy (GROUP BY ... HAVING) ----------
SELECT h.name, w.ward_type, COUNT(*) AS beds, SUM(b.status='Occupied') AS occupied
FROM hospital h JOIN ward w ON w.hospital_id=h.hospital_id JOIN bed b ON b.ward_id=w.ward_id
GROUP BY h.hospital_id, h.name, w.ward_id, w.ward_type
HAVING SUM(b.status='Occupied')/COUNT(*) > 0.7;

-- ---------- Q3: hospitals with NO free ICU bed (NOT EXISTS subquery) ----------
SELECT h.hospital_id, h.name FROM hospital h
WHERE NOT EXISTS (
  SELECT 1 FROM ward w JOIN bed b ON b.ward_id=w.ward_id
  WHERE w.hospital_id=h.hospital_id AND w.ward_type='ICU' AND b.status='Available');

-- ---------- Q4: currently admitted patients with their bed (4-table JOIN) ----------
SELECT p.patient_id, p.name, p.severity, h.name AS hospital, w.ward_type, b.bed_number,
       TIMESTAMPDIFF(MINUTE, ba.allocated_time, NOW()) AS minutes_admitted
FROM bed_allocation ba
JOIN patient p  ON p.patient_id = ba.patient_id
JOIN bed b      ON b.bed_id = ba.bed_id
JOIN ward w     ON w.ward_id = b.ward_id
JOIN hospital h ON h.hospital_id = w.hospital_id
WHERE ba.discharge_time IS NULL
ORDER BY FIELD(p.severity,'Critical','High','Medium','Low'), ba.allocated_time;

-- ---------- Q5: average call->dispatch response time by severity ----------
SELECT c.severity, COUNT(*) AS dispatches,
       ROUND(AVG(TIMESTAMPDIFF(SECOND, c.call_time, d.dispatch_time))/60, 1) AS avg_response_min
FROM dispatch_request d JOIN emergency_call c ON c.call_id = d.call_id
WHERE d.status <> 'Cancelled'
GROUP BY c.severity
ORDER BY avg_response_min;

-- ---------- Q6: busiest drivers (completed runs) with rank (window function) ----------
SELECT dr.full_name, COUNT(*) AS runs,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS busy_rank
FROM dispatch_request d JOIN driver dr ON dr.driver_id = d.driver_id
WHERE d.status = 'Completed'
GROUP BY dr.driver_id, dr.full_name;

-- ---------- Q7: average length of stay by ward type (discharged only) ----------
SELECT w.ward_type, ROUND(AVG(TIMESTAMPDIFF(HOUR, ba.allocated_time, ba.discharge_time)),1) AS avg_stay_hours
FROM bed_allocation ba JOIN bed b ON b.bed_id=ba.bed_id JOIN ward w ON w.ward_id=b.ward_id
WHERE ba.discharge_time IS NOT NULL
GROUP BY w.ward_type;

-- ---------- Q8: calls that never got a dispatch (LEFT JOIN anti-join) ----------
SELECT c.call_id, c.pickup_location, c.severity, c.call_time
FROM emergency_call c LEFT JOIN dispatch_request d ON d.call_id = c.call_id
WHERE d.request_id IS NULL ORDER BY c.call_time;

-- ---------- Q9: vehicles above-average dispatch count (subquery in HAVING) ----------
SELECT v.registration_no, COUNT(*) AS runs
FROM dispatch_request d JOIN vehicle v ON v.vehicle_id = d.vehicle_id
GROUP BY v.vehicle_id, v.registration_no
HAVING COUNT(*) > (SELECT COUNT(*)/COUNT(DISTINCT vehicle_id) FROM dispatch_request);

-- ---------- Q10: FULLTEXT search on pickup location ----------
SELECT call_id, pickup_location, severity,
       MATCH(pickup_location) AGAINST ('Road' IN NATURAL LANGUAGE MODE) AS relevance
FROM emergency_call
WHERE MATCH(pickup_location) AGAINST ('Road' IN NATURAL LANGUAGE MODE)
ORDER BY relevance DESC;

-- ---------- Q11: fleet + live dispatch views ----------
SELECT * FROM v_fleet_status;
SELECT * FROM v_active_dispatches;

-- ---------- Stored procedure calls ----------
CALL sp_register_and_allocate('Test Patient', 45, 'M', 'Critical', 1, 'Stroke symptoms');
CALL sp_dispatch_ambulance(8, NULL, NULL);
CALL sp_update_dispatch_status(1, 'En_Route');   -- will fail: request 1 is already Completed
CALL sp_discharge_patient(1);
