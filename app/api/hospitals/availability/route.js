import { NextResponse } from 'next/server';
import { pool } from '@/lib/mysql';
import { withAuth, ROLES } from '@/lib/auth';

// GET /api/hospitals/availability   (view: v_hospital_bed_availability)
// hospital_staff only see their own hospital.
export const GET = withAuth([ROLES.ADMIN, ROLES.DISPATCHER, ROLES.STAFF], async (_req, _ctx, user) => {
  const scoped = user.role === ROLES.STAFF;
  const [rows] = await pool.execute(
    `SELECT * FROM v_hospital_bed_availability ${scoped ? 'WHERE hospital_id = ?' : ''} ORDER BY hospital_id, ward_id`,
    scoped ? [user.hospital_id] : []);
  return NextResponse.json(rows);
});
