import { NextResponse } from 'next/server';
import { pool } from '@/lib/mysql';
import { getDb } from '@/lib/mongo';
import { withAuth, ROLES } from '@/lib/auth';

// GET /api/analytics  (admin dashboard: MySQL aggregates + MongoDB aggregations)
export const GET = withAuth([ROLES.ADMIN], async () => {
  const [occupancy] = await pool.query(
    `SELECT hospital_name, SUM(total_beds) AS beds, SUM(available) AS free_beds,
            ROUND(100 * SUM(occupied) / NULLIF(SUM(total_beds), 0), 1) AS occupancy_pct
     FROM v_hospital_bed_availability GROUP BY hospital_id, hospital_name ORDER BY occupancy_pct DESC`);

  const [response] = await pool.query(
    `SELECT c.severity, COUNT(*) AS dispatches,
            ROUND(AVG(TIMESTAMPDIFF(SECOND, c.call_time, d.dispatch_time)) / 60, 1) AS avg_response_min
     FROM dispatch_request d JOIN emergency_call c ON c.call_id = d.call_id
     WHERE d.status <> 'Cancelled' GROUP BY c.severity`);

  const [fleet] = await pool.query('SELECT * FROM v_fleet_status');

  const db = await getDb();
  const events = await db.collection('dispatch_events').aggregate([
    { $match: { created_at: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } } },
    { $group: { _id: '$event_type', count: { $sum: 1 } } }, { $sort: { count: -1 } },
  ]).toArray();
  const speeds = await db.collection('vehicle_telemetry').aggregate([
    { $match: { recorded_at: { $gte: new Date(Date.now() - 3600 * 1000) } } },
    { $group: { _id: '$vehicle_id', avg_speed: { $avg: '$speed_kmph' }, pings: { $sum: 1 } } },
    { $project: { vehicle_id: '$_id', _id: 0, avg_speed: { $round: ['$avg_speed', 1] }, pings: 1 } },
    { $sort: { avg_speed: -1 } },
  ]).toArray();

  return NextResponse.json({ occupancy, response, fleet, events_24h: events, vehicle_speed_1h: speeds });
});
