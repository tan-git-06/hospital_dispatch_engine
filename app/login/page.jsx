'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

const DEMO = [
  ['admin', 'Admin@123'],
  ['dispatcher1', 'Dispatch@123'],
  ['staff1', 'Staff@123'],
];

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // The server sets the httpOnly cookie in its response; we just navigate.
      await api('/api/auth/login', { method: 'POST', body: form });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-art">
        <div className="brand">
          <span className="brand-mark" aria-hidden>+</span>
          <div><strong>BedLink</strong><small>Bed &amp; Fleet Dispatch</small></div>
        </div>
        <div>
          <h1>Every call routed to a hospital that has a bed.</h1>
          <p>Emergency calls are matched to the nearest suitable ambulance at the hospital with the most free capacity — in one database transaction.</p>
        </div>
        <small className="muted">DBMS Level 3 Project · PES University</small>
      </div>

      <div className="login-pane">
        <form className="login-box stack" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted" style={{ margin: 0 }}>Use your hospital or control-room account.</p>
          {error && <div className="notice err">{error}</div>}
          <label>Username
            <input autoComplete="username" value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </label>
          <label>Password
            <input type="password" autoComplete="current-password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
          <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="demo-users">
            Demo accounts (created by <code>npm run seed:users</code>):<br />
            {DEMO.map(([u, p]) => (
              <button type="button" key={u} className="ghost small"
                onClick={() => setForm({ username: u, password: p })}>{u}</button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
