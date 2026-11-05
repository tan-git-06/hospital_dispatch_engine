import mysql from 'mysql2/promise';

// One pool per server process (survives Next.js hot reload in dev via globalThis).
// All credentials come from environment variables -- nothing is hard-coded.
const g = globalThis;
export const pool =
  g.__mysqlPool ??
  (g.__mysqlPool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true, // DECIMAL (SUM/ROUND results) -> JS numbers, not strings
    dateStrings: false,   // DATETIME -> JS Date -> ISO string in JSON
  }));

/** Parameterised SELECT/UPDATE helper -> rows (or ResultSetHeader for writes). `?` placeholders are escaped by the driver. */
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Run a stored procedure and return its first result set (array of rows). */
export async function callProc(sql, params = []) {
  const [result] = await pool.query(sql, params); // result = [rows, ResultSetHeader]
  return result[0] ?? [];
}
