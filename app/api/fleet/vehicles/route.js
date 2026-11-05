import { pool } from '@/lib/mysql';
import { getDb } from '@/lib/mongo';
import { ROLES, withAuth, ok, need } from '@/lib/auth';

// POST /api/fleet/vehicles { hospital_id, registration_no, vehicle_type }  (admin)
// UNIQUE(registration_no) -> duplicate gives a 409 via dbError.
export const POST = withAuth([ROLES.ADMIN], async (request) => {
  const b = await request.json();
  need(b, 'hospital_id', 'registration_no', 'vehicle_type');
  const reg = String(b.registration_no).toUpperCase().replace(/\s/g, '');
  const [r] = await pool.execute(
    'INSERT INTO vehicle (hospital_id, registration_no, vehicle_type) VALUES (?,?,?)',
    [Number(b.hospital_id), reg, b.vehicle_type]);

  // Best effort: put the new vehicle on the live map at its base hospital so geo-dispatch can pick it.
  try {
    const [[h]] = await pool.query('SELECT latitude, longitude FROM hospital WHERE hospital_id = ?', [Number(b.hospital_id)]);
    if (h?.latitude != null && h?.longitude != null) {
      await (await getDb()).collection('vehicle_live').updateOne({ vehicle_id: r.insertId }, { $set: {
        vehicle_id: r.insertId, registration_no: reg, vehicle_type: b.vehicle_type, status: 'Available',
        location: { type: 'Point', coordinates: [Number(h.longitude), Number(h.latitude)] },
        speed_kmph: 0, heading: 0, updated_at: new Date() } }, { upsert: true });
    }
  } catch (e) { console.error('[mongo] vehicle_live sync failed:', e.message); }
  return ok({ vehicle_id: r.insertId }, 201);
});
