import { pool, callProc } from '@/lib/mysql';
import { getDb, logEvent } from '@/lib/mongo';
import { ROLES, withAuth, idFrom, HttpError, ok } from '@/lib/auth';

// PATCH /api/dispatch/:id/status { status: 'En_Route' | 'Arrived' | 'Completed' | 'Cancelled', reason? }
export const PATCH = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async (request, ctx, user) => {
  const requestId = await idFrom(ctx);
  const { status, reason } = await request.json();
  if (typeof status !== 'string') throw new HttpError(400, 'status is required');

  const [row] = await callProc('CALL sp_update_dispatch_status(?,?)', [requestId, status]);  // validates the transition

  if (['Completed', 'Cancelled'].includes(status)) {
    const [r] = await pool.execute('SELECT vehicle_id FROM dispatch_request WHERE request_id = ?', [requestId]);
    try {
      const db = await getDb();
      await db.collection('vehicle_live').updateOne({ vehicle_id: r[0].vehicle_id },
        { $set: { status: 'Available', updated_at: new Date() } });
    } catch (e) { console.error('[mongo] live status update failed:', e.message); }
  }
  const [[ctxRow]] = await pool.query('SELECT call_id FROM dispatch_request WHERE request_id = ?', [requestId]);
  await logEvent('STATUS_CHANGED', user.username, { request_id: requestId, call_id: ctxRow?.call_id ?? null,
    payload: { from: row.old_status, to: row.new_status, ...(reason ? { reason: String(reason).slice(0, 200) } : {}) } });
  return ok(row);
});
