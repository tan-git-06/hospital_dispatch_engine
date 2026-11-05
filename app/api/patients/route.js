import { pool } from '@/lib/mysql';
import { ROLES, withAuth, scopedHospital, ok } from '@/lib/auth';

// GET /api/patients?q=   -> currently admitted patients (staff: own hospital only)
// Search: FULLTEXT index ft_patient_name (BOOLEAN MODE, "ram*" = prefix match). InnoDB ignores words < 3 chars,
// so short queries fall back to LIKE.
export const GET = withAuth([ROLES.ADMIN, ROLES.STAFF], async (request, _ctx, user) => {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  const where = ['ba.discharge_time IS NULL'], params = [];
  const hid = scopedHospital(user);
  if (hid) { where.push('h.hospital_id = ?'); params.push(hid); }
  if (q.length >= 3) {
    where.push('MATCH(p.name) AGAINST (? IN BOOLEAN MODE)');
    params.push(q.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean).map((w) => w + '*').join(' ') || q);
  } else if (q) {
    where.push('p.name LIKE ?'); params.push(`%${q}%`);
  }
  const [admitted] = await pool.query(
    `SELECT ba.allocation_id, ba.allocated_time, p.patient_id, p.name, p.age, p.gender, p.severity, p.chief_complaint,
            b.bed_id, b.bed_number, w.ward_type, h.hospital_id, h.name AS hospital_name
     FROM bed_allocation ba
     JOIN patient p  ON p.patient_id = ba.patient_id
     JOIN bed b      ON b.bed_id = ba.bed_id
     JOIN ward w     ON w.ward_id = b.ward_id
     JOIN hospital h ON h.hospital_id = w.hospital_id
     WHERE ${where.join(' AND ')}
     ORDER BY FIELD(p.severity,'Critical','High','Medium','Low'), ba.allocated_time`, params);
  return ok({ admitted });
});
