import { pool } from '@/lib/mysql';
import { ROLES, withAuth, scopedHospital, ok } from '@/lib/auth';

// GET /api/beds?hospital=&ward_type=&status=   (staff: own hospital only; dispatchers do not see patient names)
// Only fixed SQL fragments are concatenated; every value goes through a `?` placeholder.
export const GET = withAuth(null, async (request, _ctx, user) => {
  const sp = new URL(request.url).searchParams;
  const where = [], params = [];
  const hid = scopedHospital(user) ?? (sp.get('hospital') || null);
  if (hid)                { where.push('h.hospital_id = ?'); params.push(hid); }
  if (sp.get('ward_type')) { where.push('w.ward_type = ?');   params.push(sp.get('ward_type')); }
  if (sp.get('status'))    { where.push('b.status = ?');      params.push(sp.get('status')); }

  const [beds] = await pool.query(
    `SELECT b.bed_id, b.bed_number, b.status, w.ward_id, w.ward_type, h.hospital_id, h.name AS hospital_name,
            p.name AS patient, p.severity
     FROM bed b
     JOIN ward w     ON w.ward_id = b.ward_id
     JOIN hospital h ON h.hospital_id = w.hospital_id
     LEFT JOIN bed_allocation ba ON ba.bed_id = b.bed_id AND ba.discharge_time IS NULL
     LEFT JOIN patient p         ON p.patient_id = ba.patient_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY h.name, w.ward_id, b.bed_id`, params);

  if (user.role === ROLES.DISPATCHER) beds.forEach((b) => { b.patient = null; b.severity = null; });
  return ok(beds);
});
