import { pool } from '@/lib/mysql';
import { ROLES, withAuth, scopedHospital, ok, need, numOrNull } from '@/lib/auth';

// GET /api/hospitals -> { hospitals, wards }  (staff: own hospital only)
export const GET = withAuth(null, async (_req, _ctx, user) => {
  const hid = scopedHospital(user);
  const [hospitals] = await pool.query(
    `SELECT h.hospital_id, h.name AS hospital_name, h.city, h.ph_no AS contact_number, h.capacity AS total_capacity,
            (SELECT COUNT(*) FROM bed b JOIN ward w ON w.ward_id = b.ward_id WHERE w.hospital_id = h.hospital_id) AS beds,
            fn_available_beds(h.hospital_id) AS available_beds,
            (SELECT COUNT(*) FROM vehicle v WHERE v.hospital_id = h.hospital_id) AS vehicles
     FROM hospital h ${hid ? 'WHERE h.hospital_id = ?' : ''} ORDER BY h.name`, hid ? [hid] : []);
  const [wards] = await pool.query(
    `SELECT hospital_id, ward_id, ward_type, total_beds, available AS available_beds, occupied, maintenance
     FROM v_hospital_bed_availability ${hid ? 'WHERE hospital_id = ?' : ''} ORDER BY hospital_id, ward_type`, hid ? [hid] : []);
  return ok({ hospitals, wards });
});

// POST /api/hospitals { hospital_name, city, contact_number, total_capacity, latitude?, longitude? }  (admin)
// CHECK (capacity > 0), CHECK (phone format) and UNIQUE (phone) are enforced by MySQL.
export const POST = withAuth([ROLES.ADMIN], async (request) => {
  const b = await request.json();
  need(b, 'hospital_name', 'city', 'contact_number', 'total_capacity');
  const [r] = await pool.execute(
    'INSERT INTO hospital (name, city, ph_no, capacity, latitude, longitude) VALUES (?,?,?,?,?,?)',
    [b.hospital_name, b.city, String(b.contact_number).replace(/[\s-]/g, ''), Number(b.total_capacity),
     numOrNull(b.latitude, 'latitude'), numOrNull(b.longitude, 'longitude')]);
  return ok({ hospital_id: r.insertId }, 201);
});
