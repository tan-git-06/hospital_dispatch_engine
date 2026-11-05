import { pool } from '@/lib/mysql';
import { getDb } from '@/lib/mongo';
import { withAuth, scopedHospital, ok } from '@/lib/auth';

// GET /api/dashboard  (any role; hospital_staff only see their own hospital's beds)
export const GET = withAuth(null, async (_req, _ctx, user) => {
  const hid = scopedHospital(user);
  const [[hospitals], [[fleet]], [recentCalls]] = await Promise.all([
    // LEFT JOINs so a brand-new hospital with no wards still shows; stored function in the SELECT list
    pool.query(
      `SELECT h.hospital_id, h.name AS hospital_name, h.city,
              COUNT(b.bed_id) AS total_beds,
              fn_available_beds(h.hospital_id) AS available_beds,
              CAST(COALESCE(SUM(b.status = 'Occupied'), 0)    AS SIGNED) AS occupied_beds,
              CAST(COALESCE(SUM(b.status = 'Maintenance'), 0) AS SIGNED) AS maintenance_beds,
              COALESCE(ROUND(100 * SUM(b.status = 'Occupied') / NULLIF(COUNT(b.bed_id), 0), 1), 0) AS occupancy_pct
       FROM hospital h
       LEFT JOIN ward w ON w.hospital_id = h.hospital_id
       LEFT JOIN bed  b ON b.ward_id = w.ward_id
       ${hid ? 'WHERE h.hospital_id = ?' : ''}
       GROUP BY h.hospital_id, h.name, h.city
       ORDER BY occupancy_pct DESC, h.name`, hid ? [hid] : []),
    // conditional aggregation + two scalar subqueries
    pool.query(
      `SELECT CAST(COALESCE(SUM(status = 'Available'), 0) AS SIGNED) AS vehicles_free,
              (SELECT COUNT(*) FROM v_active_dispatches) AS active_dispatches,
              (SELECT COUNT(*) FROM driver WHERE status = 'Available') AS drivers_free
       FROM vehicle`),
    // correlated subquery: latest dispatch status per call (NULL = nobody sent yet)
    pool.query(
      `SELECT c.call_id, c.pickup_location, c.severity, c.call_time,
              (SELECT d.status FROM dispatch_request d WHERE d.call_id = c.call_id
               ORDER BY d.request_id DESC LIMIT 1) AS status
       FROM emergency_call c ORDER BY c.call_time DESC LIMIT 6`),
  ]);

  const sum = (k) => hospitals.reduce((a, h) => a + Number(h[k] || 0), 0);
  const totals = { total: sum('total_beds'), available: sum('available_beds'),
                   occupied: sum('occupied_beds'), maintenance: sum('maintenance_beds') };

  // MongoDB activity feed. Wrapped so the dashboard still loads when MongoDB is down.
  let feed = [], feedError = null;
  try {
    feed = await (await getDb()).collection('dispatch_events')
      .find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(8).toArray();
  } catch (e) { feedError = 'MongoDB unreachable'; }

  return ok({ totals, hospitals, fleet, recentCalls, feed, feedError });
});
