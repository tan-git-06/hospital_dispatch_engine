'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, useData } from '@/lib/client';
import { Badge } from './ui';

// Nav items carry the roles that may see them. Hiding a link is only UX —
// middleware.js and requireRole() are what actually enforce access.
const NAV = [
  { href: '/', label: 'Overview', roles: ['admin', 'dispatcher', 'hospital_staff'] },
  { href: '/dispatch', label: 'Dispatch', roles: ['admin', 'dispatcher'] },
  { href: '/beds', label: 'Beds', roles: ['admin', 'dispatcher', 'hospital_staff'] },
  { href: '/patients', label: 'Patients', roles: ['admin', 'hospital_staff'] },
  { href: '/fleet', label: 'Fleet', roles: ['admin', 'dispatcher'] },
  { href: '/hospitals', label: 'Hospitals', roles: ['admin'] },
  { href: '/reports', label: 'Reports', roles: ['admin', 'dispatcher'] },
];

export default function Shell({ children }) {
  const path = usePathname();
  const router = useRouter();
  const { data: me } = useData('/api/auth/me');

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark" aria-hidden>+</span>
          <div>
            <strong>BedLink</strong>
            <small>Bed &amp; Fleet Dispatch</small>
          </div>
        </div>
        <nav>
          {NAV.filter((n) => !me || n.roles.includes(me.role)).map((n) => {
            const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={active ? 'active' : ''}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        {me && (
          <div className="me">
            <div>
              <div className="me-name">{me.username}</div>
              <Badge value={me.role} />
            </div>
            <button className="ghost small" onClick={logout}>Log out</button>
          </div>
        )}
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
