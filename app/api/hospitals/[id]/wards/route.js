import { callProc } from '@/lib/mysql';
import { ROLES, withAuth, ok, need, idFrom, HttpError } from '@/lib/auth';

// POST /api/hospitals/:id/wards { ward_type, total_beds }  (admin)
// sp_add_ward creates the ward AND its beds in one transaction (capacity triggers still apply).
export const POST = withAuth([ROLES.ADMIN], async (request, ctx) => {
  const hospitalId = await idFrom(ctx);
  const b = await request.json();
  need(b, 'ward_type', 'total_beds');
  const n = Number(b.total_beds);
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new HttpError(400, 'total_beds must be a whole number from 1 to 99');
  const [row] = await callProc('CALL sp_add_ward(?,?,?)', [hospitalId, b.ward_type, n]);
  return ok(row, 201);
});
