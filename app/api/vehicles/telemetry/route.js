import { NextResponse } from 'next/server';
import { pool } from '@/lib/mysql';
import { getDb } from '@/lib/mongo';
import { withAuth, ROLES } from '@/lib/auth';

// POST /api/vehicles/telemetry { vehicle_id, lat, lng, speed_kmph?, heading? }
// Upserts the vehicle's latest position (vehicle_live) and appends to history (vehicle_telemetry, TTL 7d).
export const POST = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async (request) => {
  const b = await request.json();
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isInteger(b.vehicle_id) || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return NextResponse.json({ error: 'vehicle_id, lat (-90..90) and lng (-180..180) are required' }, { status: 400 });

  const [rows] = await pool.execute(
    'SELECT registration_no, vehicle_type, status FROM vehicle WHERE vehicle_id = ?', [b.vehicle_id]);
  if (!rows.length) return NextResponse.json({ error: 'Unknown vehicle' }, { status: 404 });

  const db = await getDb();
  const now = new Date();
  const location = { type: 'Point', coordinates: [lng, lat] };
  await db.collection('vehicle_live').updateOne({ vehicle_id: b.vehicle_id }, { $set: {
    vehicle_id: b.vehicle_id, registration_no: rows[0].registration_no, vehicle_type: rows[0].vehicle_type,
    status: rows[0].status, location, speed_kmph: Number(b.speed_kmph ?? 0), heading: Number(b.heading ?? 0),
    updated_at: now } }, { upsert: true });
  await db.collection('vehicle_telemetry').insertOne({
    vehicle_id: b.vehicle_id, location, speed_kmph: Number(b.speed_kmph ?? 0), heading: Number(b.heading ?? 0), recorded_at: now });
  return NextResponse.json({ ok: true }, { status: 201 });
});

// GET /api/vehicles/telemetry?lat=..&lng=..&type=ICU&limit=3  -> nearest available vehicles
export const GET = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async (request) => {
  const sp = new URL(request.url).searchParams;
  const lat = Number(sp.get('lat')), lng = Number(sp.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  const type = sp.get('type');
  const limit = Math.min(Number(sp.get('limit') || 3), 20);
  const rows = await (await getDb()).collection('vehicle_live').aggregate([
    { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distance_m', spherical: true,
                  query: { status: 'Available', ...(type && { vehicle_type: type }) } } },
    { $limit: limit },
    { $project: { _id: 0, vehicle_id: 1, registration_no: 1, vehicle_type: 1, distance_m: { $round: ['$distance_m', 0] } } },
  ]).toArray();
  return NextResponse.json(rows);
});
