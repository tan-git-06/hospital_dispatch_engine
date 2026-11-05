// node --env-file=.env.local scripts/seed-users.mjs
// Creates demo users with bcrypt-hashed passwords. CHANGE these passwords for any real deployment.
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
});
const users = [
  ['admin',       'Admin@123',    'admin',          null],
  ['dispatcher1', 'Dispatch@123', 'dispatcher',     null],
  ['staff1',      'Staff@123',    'hospital_staff', 1],   // staff of hospital_id 1
];
for (const [username, pw, role, hospitalId] of users) {
  const hash = await bcrypt.hash(pw, 10);
  await conn.execute(
    `INSERT INTO app_user (username, password_hash, role, hospital_id) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), hospital_id = VALUES(hospital_id)`,
    [username, hash, role, hospitalId]);
  console.log('seeded', username, role);
}
await conn.end();
