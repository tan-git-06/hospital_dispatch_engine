import { pool } from '@/lib/mysql';
import { getDb } from '@/lib/mongo';
import { ROLES, withAuth, ok, idFrom, HttpError } from '@/lib/auth';

// PATCH { status: 'Available' | 'Maintenance' } -- cannot touch a vehicle that is out on a call.
export const PATCH = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async (request, ctx) => {
  const id = await idFrom(ctx);
  const { status } = await request.json();
  if (!['Available', 'Maintenance'].includes(status)) throw new HttpError(400, "Status must be 'Available' or 'Maintenance'");
  const [[v]] = await pool.query('SELECT status FROM vehicle WHERE vehicle_id = ?', [id]);
  if (!v) throw new HttpError(404, 'Vehicle not found');
  await pool.execute("UPDATE vehicle SET status = ? WHERE vehicle_id = ? AND status <> 'Dispatched'", [status, id]);
  const [[after]] = await pool.query('SELECT status FROM vehicle WHERE vehicle_id = ?', [id]);
  if (after.status !== status) throw new HttpError(409, 'Vehicle is on a call');
  try {   // keep the live-position copy in step so geo-dispatch never picks a vehicle in maintenance
    await (await getDb()).collection('vehicle_live').updateOne({ vehicle_id: id }, { $set: { status, updated_at: new Date() } });
  } catch (e) { console.error('[mongo] vehicle_live sync failed:', e.message); }
  return ok({ vehicle_id: id, status });
});

// DELETE (admin) -- refused with 409 while dispatch history references the vehicle (ON DELETE RESTRICT).
export const DELETE = withAuth([ROLES.ADMIN], async (_req, ctx) => {
  const id = await idFrom(ctx);
  const [r] = await pool.execute("DELETE FROM vehicle WHERE vehicle_id = ? AND status <> 'Dispatched'", [id]);
  if (!r.affectedRows) throw new HttpError(409, 'Vehicle is on a call or does not exist');
  try { await (await getDb()).collection('vehicle_live').deleteOne({ vehicle_id: id }); } catch { /* best effort */ }
  return ok({ deleted: id });
});
