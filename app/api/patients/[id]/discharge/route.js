import { pool, callProc } from '@/lib/mysql';
import { logEvent } from '@/lib/mongo';
import { ROLES, withAuth, idFrom, HttpError, ok } from '@/lib/auth';

// POST /api/patients/:id/discharge
export const POST = withAuth([ROLES.ADMIN, ROLES.STAFF], async (_req, ctx, user) => {
  const patientId = await idFrom(ctx);

  if (user.role === ROLES.STAFF) {               // staff may only discharge patients of their own hospital
    const [r] = await pool.execute(
      `SELECT w.hospital_id FROM bed_allocation ba JOIN bed b ON b.bed_id = ba.bed_id JOIN ward w ON w.ward_id = b.ward_id
       WHERE ba.patient_id = ? AND ba.discharge_time IS NULL`, [patientId]);
    if (r[0] && r[0].hospital_id !== user.hospital_id) throw new HttpError(403, 'That patient belongs to another hospital');
  }
  const [row] = await callProc('CALL sp_discharge_patient(?)', [patientId]);
  await logEvent('PATIENT_DISCHARGED', user.username, { payload: { patient_id: patientId } });
  return ok(row);
});
