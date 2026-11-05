-- =====================================================================
-- Hospital Emergency Bed Allocation & Fleet Dispatch Engine
-- 01_schema.sql : DDL (CREATE / ALTER / DROP, PK, FK, constraints, indexes)
-- Requires MySQL 8.0.16+ (CHECK constraints), 8.0.1+ (SKIP LOCKED)
-- Run:  mysql -u root -p < 01_schema.sql
-- =====================================================================
DROP DATABASE IF EXISTS hospital_dispatch;
CREATE DATABASE hospital_dispatch CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE hospital_dispatch;

-- HOSPITAL
CREATE TABLE hospital (
  hospital_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  city        VARCHAR(60)  NOT NULL,
  ph_no       VARCHAR(15)  NOT NULL,
  capacity    INT          NOT NULL,
  CONSTRAINT uq_hospital_phone UNIQUE (ph_no),
  CONSTRAINT chk_hospital_capacity CHECK (capacity > 0),
  CONSTRAINT chk_hospital_phone CHECK (ph_no REGEXP '^[0-9+]{10,15}$')
) ENGINE=InnoDB;

-- WARD (1 hospital : N wards)
CREATE TABLE ward (
  ward_id     INT AUTO_INCREMENT PRIMARY KEY,
  hospital_id INT NOT NULL,
  ward_type   ENUM('ICU','Emergency','General','Trauma','Pediatric') NOT NULL,
  total_beds  INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_ward_hospital FOREIGN KEY (hospital_id)
    REFERENCES hospital(hospital_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT uq_ward_type UNIQUE (hospital_id, ward_type),
  CONSTRAINT chk_ward_beds CHECK (total_beds >= 0)
) ENGINE=InnoDB;

-- BED (1 ward : N beds)
CREATE TABLE bed (
  bed_id     INT AUTO_INCREMENT PRIMARY KEY,
  ward_id    INT NOT NULL,
  bed_number VARCHAR(10) NOT NULL,
  status     ENUM('Available','Occupied','Maintenance') NOT NULL DEFAULT 'Available',
  CONSTRAINT fk_bed_ward FOREIGN KEY (ward_id)
    REFERENCES ward(ward_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT uq_bed_number UNIQUE (ward_id, bed_number)
) ENGINE=InnoDB;

-- PATIENT
CREATE TABLE patient (
  patient_id     INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  age            INT NOT NULL,
  gender         ENUM('M','F','O') NOT NULL,
  severity       ENUM('Low','Medium','High','Critical') NOT NULL,
  admission_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_patient_age CHECK (age BETWEEN 0 AND 120)
) ENGINE=InnoDB;

-- BED_ALLOCATION (resolves Bed <-> Patient over time)
-- Generated "active_*" columns + UNIQUE => the DB itself guarantees a bed has
-- at most one active patient and a patient at most one active bed
-- (UNIQUE ignores NULLs, so discharged rows never collide).
CREATE TABLE bed_allocation (
  allocation_id     INT AUTO_INCREMENT PRIMARY KEY,
  bed_id            INT NOT NULL,
  patient_id        INT NOT NULL,
  allocated_time    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  discharge_time    DATETIME NULL,
  active_bed_id     INT GENERATED ALWAYS AS (IF(discharge_time IS NULL, bed_id, NULL)) STORED,
  active_patient_id INT GENERATED ALWAYS AS (IF(discharge_time IS NULL, patient_id, NULL)) STORED,
  CONSTRAINT fk_alloc_bed     FOREIGN KEY (bed_id)     REFERENCES bed(bed_id)         ON DELETE RESTRICT,
  CONSTRAINT fk_alloc_patient FOREIGN KEY (patient_id) REFERENCES patient(patient_id) ON DELETE RESTRICT,
  CONSTRAINT uq_one_active_per_bed     UNIQUE (active_bed_id),
  CONSTRAINT uq_one_active_per_patient UNIQUE (active_patient_id),
  CONSTRAINT chk_discharge_after_alloc CHECK (discharge_time IS NULL OR discharge_time >= allocated_time)
) ENGINE=InnoDB;

-- VEHICLE
CREATE TABLE vehicle (
  vehicle_id      INT AUTO_INCREMENT PRIMARY KEY,
  hospital_id     INT NOT NULL,
  registration_no VARCHAR(15) NOT NULL,
  vehicle_type    ENUM('BLS','ALS','ICU','Neonatal') NOT NULL,
  status          ENUM('Available','Dispatched','Maintenance') NOT NULL DEFAULT 'Available',
  CONSTRAINT fk_vehicle_hospital FOREIGN KEY (hospital_id)
    REFERENCES hospital(hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_vehicle_reg UNIQUE (registration_no)
) ENGINE=InnoDB;

-- DRIVER
CREATE TABLE driver (
  driver_id      INT AUTO_INCREMENT PRIMARY KEY,
  full_name      VARCHAR(100) NOT NULL,
  phone_number   VARCHAR(15)  NOT NULL,
  license_number VARCHAR(20)  NOT NULL,
  status         ENUM('Available','On_Duty','Off_Duty') NOT NULL DEFAULT 'Available',
  CONSTRAINT uq_driver_phone   UNIQUE (phone_number),
  CONSTRAINT uq_driver_license UNIQUE (license_number),
  CONSTRAINT chk_driver_phone  CHECK (phone_number REGEXP '^[0-9+]{10,15}$')
) ENGINE=InnoDB;

-- EMERGENCY_CALL
CREATE TABLE emergency_call (
  call_id         INT AUTO_INCREMENT PRIMARY KEY,
  caller_phone    VARCHAR(15)  NOT NULL,
  pickup_location VARCHAR(255) NOT NULL,
  call_time       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  severity        ENUM('Low','Medium','High','Critical') NOT NULL,
  CONSTRAINT chk_caller_phone CHECK (caller_phone REGEXP '^[0-9+]{10,15}$')
) ENGINE=InnoDB;

-- DISPATCH_REQUEST (Call -> Vehicle + Driver + destination Hospital)
-- active_* generated columns => one live dispatch per vehicle/driver, enforced by DB.
CREATE TABLE dispatch_request (
  request_id        INT AUTO_INCREMENT PRIMARY KEY,
  call_id           INT NOT NULL,
  vehicle_id        INT NOT NULL,
  driver_id         INT NOT NULL,
  hospital_id       INT NOT NULL,
  dispatch_time     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status            ENUM('Dispatched','En_Route','Arrived','Completed','Cancelled') NOT NULL DEFAULT 'Dispatched',
  active_vehicle_id INT GENERATED ALWAYS AS (IF(status IN ('Dispatched','En_Route','Arrived'), vehicle_id, NULL)) STORED,
  active_driver_id  INT GENERATED ALWAYS AS (IF(status IN ('Dispatched','En_Route','Arrived'), driver_id,  NULL)) STORED,
  CONSTRAINT fk_dr_call     FOREIGN KEY (call_id)     REFERENCES emergency_call(call_id) ON DELETE RESTRICT,
  CONSTRAINT fk_dr_vehicle  FOREIGN KEY (vehicle_id)  REFERENCES vehicle(vehicle_id)     ON DELETE RESTRICT,
  CONSTRAINT fk_dr_driver   FOREIGN KEY (driver_id)   REFERENCES driver(driver_id)       ON DELETE RESTRICT,
  CONSTRAINT fk_dr_hospital FOREIGN KEY (hospital_id) REFERENCES hospital(hospital_id)   ON DELETE RESTRICT,
  CONSTRAINT uq_one_active_per_vehicle UNIQUE (active_vehicle_id),
  CONSTRAINT uq_one_active_per_driver  UNIQUE (active_driver_id)
) ENGINE=InnoDB;

-- APP_USER (not in the ER image: needed for backend authentication / RBAC)
CREATE TABLE app_user (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('admin','dispatcher','hospital_staff') NOT NULL,
  hospital_id   INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_username UNIQUE (username),
  CONSTRAINT fk_user_hospital FOREIGN KEY (hospital_id) REFERENCES hospital(hospital_id) ON DELETE RESTRICT,
  CONSTRAINT chk_staff_has_hospital CHECK (role <> 'hospital_staff' OR hospital_id IS NOT NULL)
) ENGINE=InnoDB;

-- ============================ INDEXES ================================
CREATE INDEX idx_bed_ward_status      ON bed (ward_id, status);
CREATE INDEX idx_patient_sev_time     ON patient (severity, admission_time);
CREATE INDEX idx_alloc_discharge      ON bed_allocation (discharge_time);
CREATE INDEX idx_vehicle_avail        ON vehicle (status, vehicle_type, hospital_id);
CREATE INDEX idx_driver_status        ON driver (status);
CREATE INDEX idx_call_time            ON emergency_call (call_time);
CREATE INDEX idx_dispatch_status_time ON dispatch_request (status, dispatch_time);

-- ======================= ALTER / DROP demos ==========================
ALTER TABLE emergency_call
  ADD COLUMN pickup_lat DECIMAL(9,6) NULL,
  ADD COLUMN pickup_lng DECIMAL(9,6) NULL,
  ADD CONSTRAINT chk_call_lat CHECK (pickup_lat IS NULL OR pickup_lat BETWEEN -90  AND 90),
  ADD CONSTRAINT chk_call_lng CHECK (pickup_lng IS NULL OR pickup_lng BETWEEN -180 AND 180);

ALTER TABLE hospital
  ADD COLUMN latitude  DECIMAL(9,6) NULL,
  ADD COLUMN longitude DECIMAL(9,6) NULL;

ALTER TABLE patient ADD COLUMN chief_complaint VARCHAR(255) NULL;

-- Full-text search on pickup address (used by GET /api/calls?q=)
ALTER TABLE emergency_call ADD FULLTEXT INDEX ft_call_location (pickup_location);

-- [merge] Full-text search on patient name (used by the Patients page search box)
ALTER TABLE patient ADD FULLTEXT INDEX ft_patient_name (name);

-- DROP demos
ALTER TABLE hospital ADD COLUMN email VARCHAR(100) NULL;
ALTER TABLE hospital DROP COLUMN email;
CREATE INDEX idx_tmp_demo ON driver (full_name);
DROP INDEX idx_tmp_demo ON driver;
CREATE TABLE tmp_demo (id INT PRIMARY KEY);
DROP TABLE tmp_demo;
