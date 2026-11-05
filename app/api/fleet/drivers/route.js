import { pool } from '@/lib/mysql';
import { ROLES, withAuth, ok, need } from '@/lib/auth';

// POST /api/fleet/drivers { full_name, license_number, phone_number }  (admin)
export const POST = withAuth([ROLES.ADMIN], async (request) => {
  const b = await request.json();
  need(b, 'full_name', 'license_number', 'phone_number');
  const [r] = await pool.execute(
    'INSERT INTO driver (full_name, license_number, phone_number) VALUES (?,?,?)',
    [b.full_name, String(b.license_number).toUpperCase(), String(b.phone_number).replace(/[\s-]/g, '')]);
  return ok({ driver_id: r.insertId }, 201);
});
