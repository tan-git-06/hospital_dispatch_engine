import { callProc } from '@/lib/mysql';
import { getDb, logEvent } from '@/lib/mongo';
import { ROLES, withAuth, HttpError, ok } from '@/lib/auth';

// POST /api/patients/admit
// { name, age, gender, severity, hospital_id, complaint?, vitals?, symptoms?, notes? }
// SQL: ONE transaction in sp_register_and_allocate (patient + best bed + allocation). If the hospital has no
//      free bed the whole thing rolls back -> no orphan patient row.
// Mongo: optional first vitals document.
export const POST = withAuth([ROLES.ADMIN, ROLES.STAFF], async (request, _ctx, user) => {
  const b = await request.json();
  const hospitalId = user.role === ROLES.STAFF ? user.hospital_id : Number(b.hospital_id); // staff cannot admit elsewhere
  if (!b.name || !Number.isInteger(hospitalId)) throw new HttpError(400, 'name and hospital_id are required');

  // Range/enum validation happens in the database (CHECK / ENUM); errors map to 400.
  const [row] = await callProc('CALL sp_register_and_allocate(?,?,?,?,?,?)',
    [b.name, Number(b.age), b.gender, b.severity, hospitalId, b.complaint || null]);

  const hasVitals = b.vitals && Object.keys(b.vitals).length;
  if (hasVitals || b.notes || b.symptoms?.length) {
    try {
      const db = await getDb();
      await db.collection('patient_vitals').insertOne({
        patient_id: row.patient_id, vitals: b.vitals ?? {}, symptoms: b.symptoms ?? [],
        notes: b.notes ?? '', recorded_at: new Date() });
    } catch (e) { console.error('[mongo] vitals insert failed:', e.message); }
  }
  await logEvent('PATIENT_ADMITTED', user.username, {
    payload: { patient_id: row.patient_id, bed_id: row.bed_id, bed_number: row.bed_number, ward: row.ward_type, hospital_id: hospitalId } });

  return ok(row, 201);
});
