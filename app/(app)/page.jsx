'use client';
import { useData, timeAgo } from '@/lib/client';
import { Badge, Card, Empty, Loading, PageHead, Stat } from '@/components/ui';
import { describe, eventTone } from '@/components/events';

export default function Dashboard() {
  const { data, error } = useData('/api/dashboard');
  const me = useData('/api/auth/me');
  if (!data) return <Loading error={error} />;
  const { totals, hospitals, fleet, recentCalls, feed } = data;
  const staffView = hospitals.length === 1 && me.data?.role === 'hospital_staff';
  const occPct = totals.total ? Math.round((100 * totals.occupied) / totals.total) : 0;

  return (
    <>
      <PageHead title="Overview" sub={staffView ? `Live capacity — ${hospitals[0].hospital_name}` : 'Live capacity across the network'} />

      <div className="stats">
        <Stat label="Free beds" value={totals.available} sub={`of ${totals.total ?? 0} total`} tone="green" />
        <Stat label="Occupancy" value={`${occPct}%`} sub={`${totals.occupied ?? 0} occupied · ${totals.maintenance ?? 0} maint.`} tone={occPct > 80 ? 'red' : 'amber'} />
        <Stat label="Active dispatches" value={fleet.active_dispatches} tone="blue" />
        <Stat label="Units ready" value={fleet.vehicles_free} sub={`${fleet.drivers_free ?? 0} drivers free`} tone="green" />
      </div>

      <div className="grid three">
        <Card title="Hospitals by occupancy" aside={<span className="muted mono">fn_available_beds()</span>}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Hospital</th><th className="num">Free</th><th className="num">Total</th><th style={{ width: '35%' }}>Occupancy</th></tr>
              </thead>
              <tbody>
                {hospitals.map((h) => {
                  const p = Number(h.occupancy_pct);
                  return (
                    <tr key={h.hospital_id}>
                      <td><strong>{h.hospital_name}</strong><br /><span className="muted">{h.city}</span></td>
                      <td className="num">{h.available_beds}</td>
                      <td className="num">{h.total_beds}</td>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <div className={`bar ${p > 85 ? 'hot' : p > 60 ? 'warn' : ''}`} style={{ flex: 1 }}>
                            <span style={{ width: `${p}%` }} />
                          </div>
                          <span className="mono">{p.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!hospitals.length && <Empty>No hospitals yet.</Empty>}
          </div>
        </Card>

        <Card title="Activity" aside={<span className="muted mono">MongoDB</span>}>
          {feed.length ? (
            <ul className="feed">
              {feed.map((e, i) => (
                <li key={i}>
                  <span className={`dot ${eventTone(e)}`} />
                  <div>{describe(e)}<br /><small>{timeAgo(e.created_at)}{e.actor ? ` · ${e.actor}` : ''}</small></div>
                </li>
              ))}
            </ul>
          ) : <Empty>{data.feedError ?? 'No events logged yet.'}</Empty>}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Latest emergency calls">
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Pickup</th><th>Severity</th><th>Dispatch</th><th>Received</th></tr></thead>
              <tbody>
                {recentCalls.map((c) => (
                  <tr key={c.call_id}>
                    <td className="mono">{c.call_id}</td>
                    <td>{c.pickup_location}</td>
                    <td><Badge value={c.severity} /></td>
                    <td>{c.status ? <Badge value={c.status} /> : <span className="badge red">UNSERVED</span>}</td>
                    <td className="muted">{timeAgo(c.call_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!recentCalls.length && <Empty>No calls yet.</Empty>}
          </div>
        </Card>
      </div>
    </>
  );
}
