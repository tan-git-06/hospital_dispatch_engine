import { pool, callProc } from '@/lib/mysql';
import { getDb, logEvent } from '@/lib/mongo';
import { ROLES, withAuth, HttpError, ok } from '@/lib/auth';

const DISPATCH_ROLES = [ROLES.ADMIN, ROLES.DISPATCHER];

// GET /api/dispatch  -> live dispatches (view v_active_dispatches), most severe first
export const GET = withAuth([ROLES.ADMIN, ROLES.DISPATCHER, ROLES.STAFF], async () => {
  const [rows] = await pool.query(
    "SELECT * FROM v_active_dispatches ORDER BY FIELD(severity,'Critical','High','Medium','Low'), dispatch_time");
  return ok(rows);
});

// POST /api/dispatch { call_id, hospital_id? }
// 1) MongoDB $geoNear finds the closest suitable available vehicle (only if the call has coordinates)
// 2) MySQL sp_dispatch_ambulance assigns vehicle + driver + hospital in ONE transaction
//    (re-validates availability; falls back to auto-selection if Mongo was stale or down)
export const POST = withAuth(DISPATCH_ROLES, async (request, _ctx, user) => {
  const { call_id, hospital_id = null } = await request.json();
  if (!Number.isInteger(call_id)) throw new HttpError(400, 'call_id must be an integer');

  const [calls] = await pool.execute(
    'SELECT call_id, severity, pickup_lat, pickup_lng FROM emergency_call WHERE call_id = ?', [call_id]);
  if (!calls.length) throw new HttpError(404, 'Emergency call not found');
  const call = calls[0];

  let vehicleId = null, distanceM = null;
  if (call.pickup_lat != null && call.pickup_lng != null) {
    try {
      const col = (await getDb()).collection('vehicle_live');
      const preferred = ['Critical', 'High'].includes(call.severity) ? ['ICU', 'ALS'] : ['BLS', 'ALS'];
      for (const types of [preferred, null]) {          // try suitable types first, then any available vehicle
        const [near] = await col.aggregate([
          { $geoNear: { near: { type: 'Point', coordinates: [Number(call.pickup_lng), Number(call.pickup_lat)] },
                        distanceField: 'distance_m', spherical: true,
                        query: { status: 'Available', ...(types && { vehicle_type: { $in: types } }) } } },
          { $limit: 1 }]).toArray();
        if (near) { vehicleId = near.vehicle_id; distanceM = Math.round(near.distance_m); break; }
      }
    } catch (e) { console.error('[mongo] geo lookup failed, falling back to SQL selection:', e.message); }
  }

  let row;
  try {
    [row] = await callProc('CALL sp_dispatch_ambulance(?,?,?)', [call_id, vehicleId, hospital_id]);
  } catch (err) {
    await logEvent('DISPATCH_FAILED', user.username, { call_id, payload: { reason: err.sqlMessage ?? err.message } });
    throw err;
  }

  try {
    const db = await getDb();
    await db.collection('vehicle_live').updateOne({ vehicle_id: row.vehicle_id },
      { $set: { status: 'Dispatched', updated_at: new Date() } });
  } catch (e) { console.error('[mongo] live status update failed:', e.message); }
  await logEvent('VEHICLE_ASSIGNED', user.username, { request_id: row.request_id, call_id,
    payload: { vehicle_id: row.vehicle_id, vehicle: row.registration_no, driver_id: row.driver_id, driver: row.driver_name,
               hospital_id: row.hospital_id, hospital: row.hospital_name,
               distance_m: distanceM, geo_selected: vehicleId != null && vehicleId === row.vehicle_id } });

  return ok({ ...row, distance_m: distanceM }, 201);
});
