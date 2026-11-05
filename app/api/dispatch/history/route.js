import { pool } from '@/lib/mysql';
import { ROLES, withAuth, ok } from '@/lib/auth';

// GET /api/dispatch/history -> the 15 most recently closed dispatches
export const GET = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async () => {
  const [rows] = await pool.query(
    `SELECT d.request_id, d.status, d.dispatch_time, c.pickup_location, c.severity, v.registration_no, h.name AS hospital_name
     FROM dispatch_request d
     JOIN emergency_call c ON c.call_id = d.call_id
     JOIN vehicle v        ON v.vehicle_id = d.vehicle_id
     JOIN hospital h       ON h.hospital_id = d.hospital_id
     WHERE d.status IN ('Completed','Cancelled')
     ORDER BY d.dispatch_time DESC LIMIT 15`);
  return ok(rows);
});
