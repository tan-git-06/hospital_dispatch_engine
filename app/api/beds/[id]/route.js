import { pool } from '@/lib/mysql';
import { ROLES, withAuth, scopedHospital, ok, idFrom, HttpError } from '@/lib/auth';

// PATCH /api/beds/:id { status: 'Available' | 'Maintenance' }
// 'Occupied' is never set by hand -- only the allocation triggers set it.
export const PATCH = withAuth([ROLES.ADMIN, ROLES.STAFF], async (request, ctx, user) => {
  const id = await idFrom(ctx);
  const { status } = await request.json();
  if (!['Available', 'Maintenance'].includes(status)) throw new HttpError(400, "Status must be 'Available' or 'Maintenance'");

  const [[bed]] = await pool.query(
    'SELECT b.status, w.hospital_id FROM bed b JOIN ward w ON w.ward_id = b.ward_id WHERE b.bed_id = ?', [id]);
  if (!bed) throw new HttpError(404, 'Bed not found');
  const hid = scopedHospital(user);
  if (hid && bed.hospital_id !== hid) throw new HttpError(403, 'That bed belongs to another hospital');

  // The `status <> 'Occupied'` guard is part of the UPDATE itself, so there is no gap between check and write.
  await pool.execute("UPDATE bed SET status = ? WHERE bed_id = ? AND status <> 'Occupied'", [status, id]);
  const [[after]] = await pool.query('SELECT status FROM bed WHERE bed_id = ?', [id]);
  if (after.status !== status) throw new HttpError(409, 'Bed is occupied — discharge the patient first');
  return ok({ bed_id: id, status });
});
