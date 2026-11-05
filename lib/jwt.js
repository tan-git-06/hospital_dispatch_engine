// Pure JWT helpers -- no Next.js server imports, so the Edge middleware can use them.
// `jose` (Web Crypto) replaces the backend's `jsonwebtoken`, which needs Node's crypto and cannot run on the Edge.
import { SignJWT, jwtVerify } from 'jose';

export const COOKIE_NAME = 'hd_token';
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET);

/** user = row from app_user. Payload keeps the backend's shape: { sub, username, role, hospital_id }. */
export async function signToken(user) {
  return new SignJWT({ username: user.username, role: user.role, hospital_id: user.hospital_id ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.user_id))
    .setIssuedAt()
    .setExpirationTime('8h') // one hospital shift
    .sign(secret());
}

export async function verifyToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null; // bad signature, expired, or JWT_SECRET missing
  }
}
