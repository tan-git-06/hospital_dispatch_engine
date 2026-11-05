import { pool } from '@/lib/mysql';
import { getDb } from '@/lib/mongo';
import { ROLES, withAuth, ok } from '@/lib/auth';

// The "important queries" for the demo / report. Each one returns its SQL text too, so the Reports page can
// show the query next to its result. (Same queries as db/mysql/04_queries.sql, tuned for the seed data.)
const REPORTS = [
  { key: 'occupancy', title: 'Bed occupancy by hospital', concept: 'View + GROUP BY + aggregate',
    sql: `SELECT hospital_name, SUM(total_beds) AS beds, SUM(available) AS free_beds,
       ROUND(100 * SUM(occupied) / SUM(total_beds), 1) AS occupancy_pct
FROM v_hospital_bed_availability
GROUP BY hospital_id, hospital_name
ORDER BY occupancy_pct DESC` },
  { key: 'tight_wards', title: 'Wards busier than average', concept: 'Scalar subquery over a view',
    sql: `SELECT hospital_name, ward_type, occupied, total_beds, occupancy_pct
FROM v_hospital_bed_availability
WHERE occupancy_pct > (SELECT AVG(occupancy_pct) FROM v_hospital_bed_availability)
ORDER BY occupancy_pct DESC` },
  { key: 'no_icu', title: 'Hospitals with no free ICU bed', concept: 'NOT EXISTS subquery',
    sql: `SELECT h.hospital_id, h.name
FROM hospital h
WHERE NOT EXISTS (
  SELECT 1 FROM ward w JOIN bed b ON b.ward_id = w.ward_id
  WHERE w.hospital_id = h.hospital_id AND w.ward_type = 'ICU' AND b.status = 'Available')` },
  { key: 'response', title: 'Call → dispatch time by severity', concept: 'JOIN + AVG + date functions',
    sql: `SELECT c.severity, COUNT(*) AS dispatches,
       ROUND(AVG(TIMESTAMPDIFF(SECOND, c.call_time, d.dispatch_time)) / 60, 1) AS avg_response_min
FROM dispatch_request d JOIN emergency_call c ON c.call_id = d.call_id
WHERE d.status <> 'Cancelled'
GROUP BY c.severity
ORDER BY avg_response_min` },
  { key: 'drivers', title: 'Busiest drivers (completed runs)', concept: 'Window function RANK()',
    sql: `SELECT dr.full_name, COUNT(*) AS runs,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS busy_rank
FROM dispatch_request d JOIN driver dr ON dr.driver_id = d.driver_id
WHERE d.status = 'Completed'
GROUP BY dr.driver_id, dr.full_name` },
  { key: 'stay', title: 'Average length of stay by ward type', concept: 'Multi-table JOIN + GROUP BY',
    sql: `SELECT w.ward_type, ROUND(AVG(TIMESTAMPDIFF(HOUR, ba.allocated_time, ba.discharge_time)), 1) AS avg_stay_hours
FROM bed_allocation ba JOIN bed b ON b.bed_id = ba.bed_id JOIN ward w ON w.ward_id = b.ward_id
WHERE ba.discharge_time IS NOT NULL
GROUP BY w.ward_type` },
  { key: 'vehicles', title: 'Vehicles above average dispatch count', concept: 'GROUP BY + HAVING + subquery',
    sql: `SELECT v.registration_no, COUNT(*) AS runs
FROM dispatch_request d JOIN vehicle v ON v.vehicle_id = d.vehicle_id
GROUP BY v.vehicle_id, v.registration_no
HAVING COUNT(*) > (SELECT COUNT(*) / COUNT(DISTINCT vehicle_id) FROM dispatch_request)` },
];

// MongoDB pipeline: average minutes from VEHICLE_ASSIGNED to STATUS_CHANGED(to Completed), per hospital.
//  1 $match  keep only the two event types we need
//  2 $group  fold each request's events into one doc with a start and an end time
//            ($cond turns the other event into null; $min/$max skip nulls)
//  3 $match  drop dispatches that have not completed
//  4 $group  average the durations per hospital
const RESPONSE_PIPELINE = [
  { $match: { event_type: { $in: ['VEHICLE_ASSIGNED', 'STATUS_CHANGED'] }, request_id: { $ne: null } } },
  { $group: {
      _id: '$request_id',
      hospital_id: { $max: '$payload.hospital_id' },
      start: { $min: { $cond: [{ $eq: ['$event_type', 'VEHICLE_ASSIGNED'] }, '$created_at', null] } },
      end: { $max: { $cond: [{ $and: [{ $eq: ['$event_type', 'STATUS_CHANGED'] }, { $eq: ['$payload.to', 'Completed'] }] }, '$created_at', null] } },
  } },
  { $match: { start: { $ne: null }, end: { $ne: null } } },
  { $group: { _id: '$hospital_id', trips: { $sum: 1 },
              avgMinutes: { $avg: { $divide: [{ $subtract: ['$end', '$start'] }, 60000] } } } },
  { $sort: { avgMinutes: 1 } },
];

// GET /api/reports  (admin, dispatcher)
export const GET = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async () => {
  const sql = [];
  for (const r of REPORTS) { const [rows] = await pool.query(r.sql); sql.push({ ...r, rows }); }

  const mongo = { pipeline: RESPONSE_PIPELINE, rows: [], byType: [], speeds: [], error: null };
  try {
    const db = await getDb();
    const agg = await db.collection('dispatch_events').aggregate(RESPONSE_PIPELINE).toArray();
    // Cross-database "join": Mongo has hospital ids, MySQL has names -> merge in JS.
    const [names] = await pool.query('SELECT hospital_id, name FROM hospital');
    const byId = Object.fromEntries(names.map((n) => [n.hospital_id, n.name]));
    mongo.rows = agg.map((a) => ({ hospital: byId[a._id] ?? `#${a._id}`, trips: a.trips, avg_minutes: Math.round(a.avgMinutes * 10) / 10 }));
    mongo.byType = (await db.collection('dispatch_events').aggregate(
      [{ $group: { _id: '$event_type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray())
      .map((t) => ({ event_type: t._id, count: t.count }));
    mongo.speeds = await db.collection('vehicle_telemetry').aggregate([
      { $match: { recorded_at: { $gte: new Date(Date.now() - 3600 * 1000) } } },
      { $group: { _id: '$vehicle_id', avg_speed: { $avg: '$speed_kmph' }, max_speed: { $max: '$speed_kmph' }, pings: { $sum: 1 } } },
      { $project: { _id: 0, vehicle_id: '$_id', avg_speed: { $round: ['$avg_speed', 1] }, max_speed: 1, pings: 1 } },
      { $sort: { avg_speed: -1 } }, { $limit: 5 },
    ]).toArray();
  } catch (e) { mongo.error = 'MongoDB unreachable: ' + e.message; }

  return ok({ sql, mongo });
});
