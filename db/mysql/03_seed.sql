-- =====================================================================
-- 03_seed.sql : sample data (Bengaluru). Run AFTER 01 and 02.
-- Users are created by nextjs/scripts/seed-users.mjs (bcrypt hashes).
-- =====================================================================
USE hospital_dispatch;

INSERT INTO hospital (name, city, ph_no, capacity, latitude, longitude) VALUES
 ('City General Hospital',     'Bengaluru', '08022223333', 60, 12.971600, 77.594600),
 ('Lakeside Medical Centre',   'Bengaluru', '08044445555', 40, 12.934500, 77.610100),
 ('Northgate Trauma Centre',   'Bengaluru', '08066667777', 30, 13.035000, 77.597000);

INSERT INTO ward (hospital_id, ward_type, total_beds) VALUES
 (1,'ICU',10),(1,'Emergency',20),(1,'General',20),(1,'Trauma',10),
 (2,'ICU',6), (2,'Emergency',14),(2,'General',20),
 (3,'ICU',5), (3,'Emergency',10),(3,'General',15);

-- Create bed rows for every ward (ordered so bed_ids are stable)
INSERT INTO bed (ward_id, bed_number)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 20)
SELECT w.ward_id, CONCAT(LEFT(w.ward_type,1), LPAD(s.n,2,'0'))
FROM ward w JOIN seq s ON s.n <= w.total_beds
ORDER BY w.ward_id, s.n;

INSERT INTO vehicle (hospital_id, registration_no, vehicle_type) VALUES
 (1,'KA01AB1001','ICU'),(1,'KA01AB1002','ALS'),(1,'KA01AB1003','BLS'),(1,'KA01AB1004','BLS'),
 (2,'KA02CD2001','ALS'),(2,'KA02CD2002','BLS'),(2,'KA02CD2003','BLS'),
 (3,'KA03EF3001','ICU'),(3,'KA03EF3002','BLS'),(3,'KA03EF3003','Neonatal');

INSERT INTO driver (full_name, phone_number, license_number) VALUES
 ('Ravi Kumar','9800000001','KA0120200001'),('Suresh Gowda','9800000002','KA0120200002'),
 ('Manjunath R','9800000003','KA0220200003'),('Imran Pasha','9800000004','KA0220200004'),
 ('Anil Reddy','9800000005','KA0320200005'),('Prakash N','9800000006','KA0320200006'),
 ('Dinesh S','9800000007','KA0120200007'),('Mohan Das','9800000008','KA0220200008'),
 ('Karthik V','9800000009','KA0320200009'),('Santosh B','9800000010','KA0120200010');

-- Currently admitted patients (triggers mark beds Occupied)
INSERT INTO patient (name, age, gender, severity, admission_time, chief_complaint) VALUES
 ('Arjun Mehta',   54,'M','Critical', NOW() - INTERVAL 5 HOUR, 'Chest pain'),
 ('Sneha Iyer',    31,'F','High',     NOW() - INTERVAL 4 HOUR, 'Road accident, fracture'),
 ('Rohit Sharma',  42,'M','Medium',   NOW() - INTERVAL 3 HOUR, 'High fever'),
 ('Fatima Khan',   67,'F','High',     NOW() - INTERVAL 2 HOUR, 'Breathing difficulty'),
 ('Vikram Rao',    25,'M','Low',      NOW() - INTERVAL 1 HOUR, 'Minor laceration');
INSERT INTO bed_allocation (bed_id, patient_id, allocated_time) VALUES
 (1,1, NOW() - INTERVAL 5 HOUR),(2,2, NOW() - INTERVAL 4 HOUR),
 (11,3,NOW() - INTERVAL 3 HOUR),(61,4,NOW() - INTERVAL 2 HOUR),(106,5,NOW() - INTERVAL 1 HOUR);

-- Past patients (already discharged)
INSERT INTO patient (name, age, gender, severity, admission_time, chief_complaint) VALUES
 ('Meena Pillai',  60,'F','Medium', NOW() - INTERVAL 3 DAY, 'Dehydration'),
 ('Karan Joshi',   35,'M','High',   NOW() - INTERVAL 2 DAY, 'Appendicitis'),
 ('Divya Nair',     8,'F','Low',    NOW() - INTERVAL 1 DAY, 'Asthma attack');
INSERT INTO bed_allocation (bed_id, patient_id, allocated_time, discharge_time) VALUES
 (12,6, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 2 DAY),
 (31,7, NOW() - INTERVAL 2 DAY, NOW() - INTERVAL 1 DAY),
 (13,8, NOW() - INTERVAL 1 DAY, NOW() - INTERVAL 20 HOUR);

-- Emergency calls
INSERT INTO emergency_call (caller_phone, pickup_location, call_time, severity, pickup_lat, pickup_lng) VALUES
 ('9900000001','MG Road near Trinity Metro Station',    NOW() - INTERVAL 3 DAY,  'High',     12.975600, 77.606800),
 ('9900000002','Whitefield Main Road, ITPL gate',       NOW() - INTERVAL 3 DAY,  'Critical', 12.969800, 77.750000),
 ('9900000003','Koramangala 5th Block, Forum Mall',     NOW() - INTERVAL 2 DAY,  'Medium',   12.935200, 77.624500),
 ('9900000004','Jayanagar 4th Block bus stand',         NOW() - INTERVAL 2 DAY,  'Low',      12.930800, 77.583800),
 ('9900000005','Hebbal flyover service road',           NOW() - INTERVAL 1 DAY,  'Critical', 13.035800, 77.597000),
 ('9900000006','Electronic City Phase 1, Infosys gate', NOW() - INTERVAL 1 DAY,  'High',     12.845200, 77.660200),
 ('9900000007','Indiranagar 100 Feet Road',             NOW() - INTERVAL 20 MINUTE,'Critical',12.978400, 77.640800),
 ('9900000008','Yelahanka New Town, Kogilu Cross',      NOW() - INTERVAL 5 MINUTE, 'Medium',  13.100700, 77.596300);

-- Historical (completed) dispatches => response-time analytics
INSERT INTO dispatch_request (call_id, vehicle_id, driver_id, hospital_id, dispatch_time, status) VALUES
 (1, 2, 1, 1, NOW() - INTERVAL 3 DAY  + INTERVAL 3 MINUTE, 'Completed'),
 (2, 1, 2, 1, NOW() - INTERVAL 3 DAY  + INTERVAL 2 MINUTE, 'Completed'),
 (3, 5, 3, 2, NOW() - INTERVAL 2 DAY  + INTERVAL 6 MINUTE, 'Completed'),
 (4, 6, 4, 2, NOW() - INTERVAL 2 DAY  + INTERVAL 9 MINUTE, 'Completed'),
 (5, 8, 5, 3, NOW() - INTERVAL 1 DAY  + INTERVAL 2 MINUTE, 'Completed'),
 (6, 3, 7, 1, NOW() - INTERVAL 1 DAY  + INTERVAL 5 MINUTE, 'Cancelled');

-- One live dispatch (vehicle 2 / driver 1 become Dispatched / On_Duty via trigger)
INSERT INTO dispatch_request (call_id, vehicle_id, driver_id, hospital_id, dispatch_time, status)
VALUES (7, 2, 1, 1, NOW() - INTERVAL 15 MINUTE, 'En_Route');
