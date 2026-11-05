import { pool } from '@/lib/mysql';
import { logEvent } from '@/lib/mongo';
import { ROLES, withAuth, HttpError, ok, numOrNull } from '@/lib/auth';

const DISPATCH_ROLES = [ROLES.ADMIN, ROLES.DISPATCHER];

// GET /api/calls?q=road&pending=1
//   q        -> MySQL FULLTEXT search on pickup_location (ordered by relevance)
//   pending  -> only calls that have no live/completed dispatch ("Waiting for a unit" queue, most severe first)
//   neither  -> latest 50 calls
export const GET = withAuth(DISPATCH_ROLES, async (request) => {
  const sp = new URL(request.url).searchParams;
  const q = sp.get('q')?.trim();
  const pending = sp.get('pending') === '1';
  const selectParams = [], whereParams = [], where = [];
  let relevance = '', order = 'c.call_time DESC';

  if (q) {
    relevance = ', MATCH(c.pickup_location) AGAINST (? IN NATURAL LANGUAGE MODE) AS relevance';
    selectParams.push(q);
    where.push('MATCH(c.pickup_location) AGAINST (? IN NATURAL LANGUAGE MODE)');
    whereParams.push(q);
    order = 'relevance DESC';
  }
  if (pending) {
    where.push("NOT EXISTS (SELECT 1 FROM dispatch_request d WHERE d.call_id = c.call_id AND d.status <> 'Cancelled')");
    if (!q) order = "FIELD(c.severity,'Critical','High','Medium','Low'), c.call_time";
  }
  const [rows] = await pool.query(
    `SELECT c.call_id, c.caller_phone, c.pickup_location, c.call_time, c.severity, c.pickup_lat, c.pickup_lng${relevance}
     FROM emergency_call c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${order} LIMIT 50`, [...selectParams, ...whereParams]);
  return ok(rows);
});

// POST /api/calls { caller_phone, pickup_location, severity, pickup_lat?, pickup_lng? }
// Only logs the call. Dispatching is a separate step (POST /api/dispatch), so a call that cannot be served
// yet stays in the pending queue and can be retried.
export const POST = withAuth(DISPATCH_ROLES, async (request, _ctx, user) => {
  const b = await request.json();
  if (!b.caller_phone || !b.pickup_location) throw new HttpError(400, 'caller_phone and pickup_location are required');
  const [res] = await pool.execute(
    `INSERT INTO emergency_call (caller_phone, pickup_location, severity, pickup_lat, pickup_lng) VALUES (?,?,?,?,?)`,
    [String(b.caller_phone).replace(/[\s-]/g, ''), b.pickup_location, b.severity ?? null,
     numOrNull(b.pickup_lat, 'pickup_lat'), numOrNull(b.pickup_lng, 'pickup_lng')]);
  await logEvent('CALL_RECEIVED', user.username, { call_id: res.insertId,
    payload: { severity: b.severity, pickup: b.pickup_location } });
  return ok({ call_id: res.insertId }, 201);
});
