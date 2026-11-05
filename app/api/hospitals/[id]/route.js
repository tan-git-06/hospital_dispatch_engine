import { pool } from '@/lib/mysql';
import { ROLES, withAuth, ok, idFrom, HttpError } from '@/lib/auth';

// DELETE /api/hospitals/:id (admin). Wards and beds cascade, but vehicles, users, dispatches and patient
// history are ON DELETE RESTRICT -> MySQL refuses (409) while any of them still references the hospital.
export const DELETE = withAuth([ROLES.ADMIN], async (_req, ctx) => {
  const id = await idFrom(ctx);
  const [r] = await pool.execute('DELETE FROM hospital WHERE hospital_id = ?', [id]);
  if (!r.affectedRows) throw new HttpError(404, 'Hospital not found');
  return ok({ deleted: id });
});
