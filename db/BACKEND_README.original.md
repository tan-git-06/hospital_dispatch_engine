# Hospital Emergency Bed Allocation & Fleet Dispatch Engine — Backend

Databases: **MySQL 8 (SQL, mandatory)** + **MongoDB (NoSQL)** · API: **Next.js Route Handlers** · Auth: JWT (httpOnly cookie) + 3 roles

## Folder map
| Path | Purpose |
|---|---|
| `mysql/01_schema.sql` | CREATE / ALTER / DROP, PK, FK, CHECK, UNIQUE, indexes, FULLTEXT |
| `mysql/02_advanced.sql` | 3 views, 1 function, 4 stored procedures (transactions), 9 triggers |
| `mysql/03_seed.sql` | Sample data (3 hospitals, 130 beds, 10 vehicles, 10 drivers, calls, dispatches) |
| `mysql/04_queries.sql` | DML + 11 important queries (JOIN, GROUP BY/HAVING, subqueries, window fn, FULLTEXT) |
| `mysql/05_test_cases.sql` | 13 integrity / rollback test cases |
| `mongodb/mongo_setup.js` | 4 collections with `$jsonSchema` validators, 2dsphere/TTL/text indexes, seed, 5 aggregations |
| `nextjs/` | `lib/` (db pools, auth), `app/api/**` (route handlers), `scripts/seed-users.mjs`, `.env.example` |

## Setup
```bash
# 1. MySQL (8.0.16+)
mysql -u root -p < mysql/01_schema.sql
mysql -u root -p < mysql/02_advanced.sql
mysql -u root -p < mysql/03_seed.sql
mysql -u root -p -e "CREATE USER 'dispatch_app'@'localhost' IDENTIFIED BY 'choose_a_password'; GRANT ALL ON hospital_dispatch.* TO 'dispatch_app'@'localhost';"
# 2. MongoDB
mongosh "mongodb://localhost:27017" --file mongodb/mongo_setup.js
# 3. Next.js backend
cd nextjs && cp .env.example .env.local      # fill in credentials + JWT_SECRET
npm install && npm run seed:users && npm run dev
# 4. Tests (fresh DB, before 04): mysql -u root -p --force hospital_dispatch < mysql/05_test_cases.sql
```
Demo logins (from `seed-users.mjs`, change for real use): `admin / Admin@123`, `dispatcher1 / Dispatch@123`, `staff1 / Staff@123`.

## Why each database (justification required by the rubric)
| Data | Store | Reason |
|---|---|---|
| Hospitals, wards, beds, patients, allocations, vehicles, drivers, calls, dispatches, users | **MySQL** | Strongly relational, needs ACID transactions, FKs, constraints. Double-booking a bed or ambulance is a correctness bug -> must be prevented by the DB. |
| Live vehicle position, GPS history | **MongoDB** (`vehicle_live`, `vehicle_telemetry`) | High-frequency writes, 2dsphere `$geoNear` for "nearest available ambulance", TTL index auto-expires history. |
| Dispatch audit trail | **MongoDB** (`dispatch_events`) | Append-only; payload shape differs per event type. |
| Patient vitals / clinical notes | **MongoDB** (`patient_vitals`) | Variable measurements per reading, free text with text index. |

**Rule: MySQL is the source of truth.** Mongo failures never roll back or block committed SQL work (see `logEvent`).

## Rubric coverage
* **ER -> relational schema:** 9 tables from the ER image + `app_user` (auth). Lat/long columns added with `ALTER`.
* **SQL advanced features (need 4):** transactions (`sp_*`, `SKIP LOCKED` row locks), views, stored procedures/functions, triggers, indexing, full-text search.
* **NoSQL advanced feature (need 1):** aggregation pipelines, geospatial `$geoNear`, TTL, text index, schema validation.
* **Integrity at DB level:** CHECK/ENUM/UNIQUE/FK + generated-column UNIQUE (one active bed per patient, one active dispatch per vehicle/driver) + capacity triggers.
* **Auth / RBAC:** bcrypt + JWT; roles `admin`, `dispatcher`, `hospital_staff` (staff scoped to own hospital).
* **No hard-coded secrets:** everything via `.env.local`.

## API summary
| Method & path | Roles | Notes |
|---|---|---|
| `POST /api/auth/login` | public | sets httpOnly JWT cookie |
| `GET /api/hospitals/availability` | all | view; staff see own hospital |
| `POST /api/patients/admit` | admin, staff | `sp_register_and_allocate` (+ optional vitals -> Mongo) |
| `POST /api/patients/:id/discharge` | admin, staff | `sp_discharge_patient` |
| `GET/POST /api/patients/:id/vitals` | admin, staff | Mongo + aggregation |
| `GET/POST /api/calls` | admin, dispatcher | POST creates call; `GET ?q=` FULLTEXT search |
| `GET/POST /api/dispatch` | GET all / POST admin, dispatcher | Mongo `$geoNear` -> `sp_dispatch_ambulance` |
| `PATCH /api/dispatch/:id/status` | admin, dispatcher | validated state machine |
| `GET/POST /api/vehicles/telemetry` | admin, dispatcher | upsert live position / nearest vehicles |
| `GET /api/analytics` | admin | MySQL + Mongo aggregates |
