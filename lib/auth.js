// Authentication = who you are (JWT in an httpOnly cookie, or `Authorization: Bearer` for API clients).
// Authorization  = what you may do (each route declares its roles via withAuth).
import { NextResponse } from 'next/server';
import { verifyToken, signToken, COOKIE_NAME } from './jwt';

export { signToken, COOKIE_NAME };
export const ROLES = { ADMIN: 'admin', DISPATCHER: 'dispatcher', STAFF: 'hospital_staff' };

/** Throw from a route to return a clean JSON error: throw new HttpError(404, 'Bed not found'). */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function getUser(request) {
  const header = request.headers.get('authorization') || '';
  const token = request.cookies.get(COOKIE_NAME)?.value || header.replace(/^Bearer\s+/i, '');
  return verifyToken(token);
}

/** hospital_staff are scoped to their own hospital; everybody else sees all (returns null). */
export const scopedHospital = (user) => (user.role === ROLES.STAFF ? user.hospital_id : null);

/** Map database errors to clean HTTP responses. Constraint NAMES are shown (useful in the UI), never SQL text. */
export function dbError(err) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });

  // --- MySQL ---
  if (err?.sqlState === '45000' || err?.errno === 1644)   // SIGNAL from a trigger / stored procedure = business rule
    return NextResponse.json({ error: err.sqlMessage }, { status: 409 });
  if (err?.code === 'ER_DUP_ENTRY') {
    const key = /for key '([^']+)'/.exec(err.sqlMessage || '')?.[1];
    return NextResponse.json({ error: `Duplicate or conflicting record${key ? ` (${key})` : ''}` }, { status: 409 });
  }
  if (err?.code === 'ER_ROW_IS_REFERENCED_2')
    return NextResponse.json({ error: 'Cannot delete: other records (vehicles, patients, dispatch history) still reference this row' }, { status: 409 });
  if (err?.code === 'ER_CHECK_CONSTRAINT_VIOLATED')
    return NextResponse.json({ error: `Invalid input — ${err.sqlMessage}` }, { status: 400 });
  if (err?.code === 'ER_NO_REFERENCED_ROW_2')
    return NextResponse.json({ error: 'Referenced record does not exist' }, { status: 400 });
  if (['WARN_DATA_TRUNCATED', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', 'ER_WARN_DATA_OUT_OF_RANGE', 'ER_DATA_TOO_LONG',
       'ER_BAD_NULL_ERROR', 'ER_TRUNCATED_WRONG_VALUE', 'ER_WRONG_VALUE_COUNT_ON_ROW'].includes(err?.code))
    return NextResponse.json({ error: 'Invalid input rejected by database constraints (check required fields, enums and number formats)' }, { status: 400 });

  // --- MongoDB ---
  if (err?.code === 121)  // $jsonSchema validator rejected the document
    return NextResponse.json({ error: 'Rejected by MongoDB schema validation (check value ranges)' }, { status: 400 });
  if (err?.name === 'MongoServerSelectionError' || err?.name === 'MongoNetworkError')
    return NextResponse.json({ error: 'MongoDB is not reachable — this feature needs it running' }, { status: 503 });

  console.error(err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/** Wrap a route handler with authentication + role check + error mapping.
 *  roles = array of allowed roles, or null/[] for "any logged-in user". Handler gets (request, ctx, user). */
export function withAuth(roles, handler) {
  return async (request, ctx) => {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    if (roles?.length && !roles.includes(user.role))
      return NextResponse.json({ error: `Requires role: ${roles.join(' or ')}` }, { status: 403 });
    try { return await handler(request, ctx, user); } catch (err) { return dbError(err); }
  };
}

// ---- tiny input helpers ----
export const ok = (data, status = 200) => NextResponse.json(data, { status });
export function need(body, ...fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw new HttpError(400, `Missing: ${missing.join(', ')}`);
}
/** Next 15: dynamic route params are a Promise. Returns the numeric :id or throws 400. */
export async function idFrom(ctx, name = 'id') {
  const n = Number((await ctx.params)[name]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
}
/** '' / undefined / null -> null, otherwise a finite Number (else 400). */
export function numOrNull(v, label = 'value') {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
  return n;
}
