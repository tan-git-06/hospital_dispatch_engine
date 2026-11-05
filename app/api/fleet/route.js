import { pool } from '@/lib/mysql';
import { ROLES, withAuth, ok } from '@/lib/auth';

// GET /api/fleet -> { vehicles, drivers }
export const GET = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async () => {
  const [[vehicles], [drivers]] = await Promise.all([
    pool.query(`SELECT v.vehicle_id, v.registration_no, v.vehicle_type, v.status, v.hospital_id, h.name AS hospital_name
                FROM vehicle v JOIN hospital h ON h.hospital_id = v.hospital_id
                ORDER BY h.name, v.vehicle_type, v.registration_no`),
    // correlated subquery: completed-trip count per driver
    pool.query(`SELECT d.driver_id, d.full_name, d.phone_number, d.license_number, d.status,
                       (SELECT COUNT(*) FROM dispatch_request r WHERE r.driver_id = d.driver_id AND r.status = 'Completed') AS trips
                FROM driver d ORDER BY d.full_name`),
  ]);
  return ok({ vehicles, drivers });
});
