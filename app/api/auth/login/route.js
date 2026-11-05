import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '@/lib/mysql';
import { signToken, COOKIE_NAME, dbError } from '@/lib/auth';

// POST /api/auth/login  { username, password }
export async function POST(request) {
  try {
    const { username, password } = await request.json();
    if (typeof username !== 'string' || typeof password !== 'string')
      return NextResponse.json({ error: 'username and password required' }, { status: 400 });

    const [rows] = await pool.execute(
      'SELECT user_id, username, password_hash, role, hospital_id FROM app_user WHERE username = ?', [username]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 }); // same msg for both cases

    const res = NextResponse.json({ username: user.username, role: user.role, hospital_id: user.hospital_id });
    res.cookies.set(COOKIE_NAME, await signToken(user), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 3600, path: '/',
    });
    return res;
  } catch (err) { return dbError(err); }
}
