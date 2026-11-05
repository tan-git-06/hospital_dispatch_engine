# Hospital Emergency Bed Allocation & Fleet Dispatch Engine
Merged project: one Next.js 15 app (UI + API) on MySQL 8 (state) + MongoDB (events, GPS, vitals).

## Structure
- `app/` pages (login, overview, dispatch, beds, patients, fleet, hospitals, reports) and `app/api/**` routes
- `components/` Shell, ui, events (Mongo event to text)
- `lib/` mysql.js, mongo.js, jwt.js (jose, Edge-safe), auth.js (withAuth/RBAC/errors), client.js
- `middleware.js` JWT gate + role-based page access
- `db/mysql/` 01_schema, 02_advanced, 03_seed, 04_queries, 05_test_cases
- `db/mongodb/mongo_setup.js`
- `scripts/` setup-db.mjs, seed-users.mjs

## Run
Needs Node 20.6+, MySQL 8.0.16+ (not MariaDB/XAMPP), MongoDB 6+, `mysql` client and `mongosh` on PATH.

    copy .env.example .env.local     (cp on macOS/Linux) then fill MYSQL_PASSWORD and JWT_SECRET
    npm install
    npm run db:setup                 (db:mysql + seed:users + db:mongo; drops and recreates the DBs)
    npm run dev                      (http://localhost:3000)

Logins: admin / Admin@123, dispatcher1 / Dispatch@123, staff1 / Staff@123 (staff belongs to hospital 1).
`npm run db:test` runs the integrity tests on a freshly seeded DB.
MongoDB is optional at runtime: without it the feed, timeline, vitals, geo-dispatch and Mongo reports are unavailable.
