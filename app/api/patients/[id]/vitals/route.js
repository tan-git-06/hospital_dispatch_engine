import { pool } from '@/lib/mysql';
import { getDb } from '@/lib/mongo';
import { ROLES, withAuth, idFrom, HttpError, ok } from '@/lib/auth';

const ALL = [ROLES.ADMIN, ROLES.STAFF];

// staff may only touch vitals of patients whose latest bed is in their own hospital
async function assertAccess(user, patientId) {
  if (user.role !== ROLES.STAFF) return;
  const [r] = await pool.execute(
    `SELECT w.hospital_id FROM bed_allocation ba JOIN bed b ON b.bed_id = ba.bed_id JOIN ward w ON w.ward_id = b.ward_id
     WHERE ba.patient_id = ? ORDER BY ba.allocation_id DESC LIMIT 1`, [patientId]);
  if (!r[0]) throw new HttpError(404, 'Patient not found');
  if (r[0].hospital_id !== user.hospital_id) throw new HttpError(403, 'That patient belongs to another hospital');
}

// GET /api/patients/:id/vitals  -> readings + aggregated trend (MongoDB aggregation)
export const GET = withAuth(ALL, async (_req, ctx, user) => {
  const patientId = await idFrom(ctx);
  await assertAccess(user, patientId);
  const col = (await getDb()).collection('patient_vitals');
  const readings = await col.find({ patient_id: patientId }, { projection: { _id: 0 } }).sort({ recorded_at: -1 }).limit(50).toArray();
  const [trend] = await col.aggregate([
    { $match: { patient_id: patientId } },
    { $sort: { recorded_at: 1 } },
    { $group: { _id: '$patient_id', readings: { $sum: 1 }, avg_hr: { $avg: '$vitals.heart_rate' },
                min_spo2: { $min: '$vitals.spo2' }, latest_spo2: { $last: '$vitals.spo2' } } },
  ]).toArray();
  return ok({ readings, trend: trend ?? null });
});

// POST /api/patients/:id/vitals  { vitals:{...}, symptoms:[...], notes:"" }
export const POST = withAuth(ALL, async (request, ctx, user) => {
  const patientId = await idFrom(ctx);
  await assertAccess(user, patientId);
  const b = await request.json();
  const col = (await getDb()).collection('patient_vitals');
  await col.insertOne({ patient_id: patientId, vitals: b.vitals ?? {}, symptoms: b.symptoms ?? [],
                        notes: b.notes ?? '', recorded_at: new Date() });   // $jsonSchema validator rejects bad ranges
  return ok({ ok: true }, 201);
});
