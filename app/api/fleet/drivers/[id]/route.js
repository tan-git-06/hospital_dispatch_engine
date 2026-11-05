import { pool } from '@/lib/mysql';
import { ROLES, withAuth, ok, idFrom, HttpError } from '@/lib/auth';

// PATCH { status: 'Available' | 'Off_Duty' } -- clock a driver on/off duty. 'On_Duty' is only ever set by the dispatch trigger.
export const PATCH = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async (request, ctx) => {
  const id = await idFrom(ctx);
  const { status } = await request.json();
  if (!['Available', 'Off_Duty'].includes(status)) throw new HttpError(400, "Status must be 'Available' or 'Off_Duty'");
  const [[d]] = await pool.query('SELECT status FROM driver WHERE driver_id = ?', [id]);
  if (!d) throw new HttpError(404, 'Driver not found');
  await pool.execute("UPDATE driver SET status = ? WHERE driver_id = ? AND status <> 'On_Duty'", [status, id]);
  const [[after]] = await pool.query('SELECT status FROM driver WHERE driver_id = ?', [id]);
  if (after.status !== status) throw new HttpError(409, 'Driver is on a trip');
  return ok({ driver_id: id, status });
});
