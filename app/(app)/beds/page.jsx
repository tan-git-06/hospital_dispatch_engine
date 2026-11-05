'use client';
import { useMemo, useState } from 'react';
import { api, useData } from '@/lib/client';
import { Badge, Card, Empty, Loading, Notice, PageHead, useAction } from '@/components/ui';

const WARDS = ['ICU', 'Emergency', 'General', 'Trauma', 'Pediatric'];

export default function BedsPage() {
  const [f, setF] = useState({ hospital: '', ward_type: '', status: '' });
  // Build the query string from the filters → useData refetches when it changes
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const beds = useData(`/api/beds${qs ? '?' + qs : ''}`);
  const hospitals = useData('/api/hospitals');
  const me = useData('/api/auth/me');
  const canEdit = ['admin', 'hospital_staff'].includes(me.data?.role);
  const { busy, msg, run } = useAction();

  // Group the flat row list into hospital → ward → beds for the bed map
  const groups = useMemo(() => {
    const out = new Map();
    for (const b of beds.data || []) {
      const key = `${b.hospital_name}|${b.ward_id}`;
      if (!out.has(key)) out.set(key, { hospital: b.hospital_name, ward: b.ward_type, beds: [] });
      out.get(key).beds.push(b);
    }
    return [...out.values()];
  }, [beds.data]);

  const counts = (beds.data || []).reduce((a, b) => ({ ...a, [b.status]: (a[b.status] || 0) + 1 }), {});

  async function toggle(b) {
    const status = b.status === 'Maintenance' ? 'Available' : 'Maintenance';
    await run(() => api(`/api/beds/${b.bed_id}`, { method: 'PATCH', body: { status } }), `Bed ${b.bed_number} → ${status.toLowerCase()}`);
    beds.reload();
  }

  return (
    <>
      <PageHead title="Beds" sub="Live bed map. Occupied beds are set by triggers, not by hand.">
        <div className="filters">
          <select value={f.hospital} onChange={(e) => setF({ ...f, hospital: e.target.value })}
            style={hospitals.data?.hospitals.length === 1 ? { display: 'none' } : undefined}>
            <option value="">All hospitals</option>
            {hospitals.data?.hospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.hospital_name}</option>)}
          </select>
          <select value={f.ward_type} onChange={(e) => setF({ ...f, ward_type: e.target.value })}>
            <option value="">All wards</option>
            {WARDS.map((w) => <option key={w}>{w}</option>)}
          </select>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Any status</option>
            <option>Available</option><option>Occupied</option><option>Maintenance</option>
          </select>
        </div>
      </PageHead>
      <Notice msg={msg} />

      <div className="row" style={{ marginBottom: 14 }}>
        <Badge value="Available" /> <span className="mono">{counts.Available || 0}</span>
        <Badge value="Occupied" /> <span className="mono">{counts.Occupied || 0}</span>
        <Badge value="Maintenance" /> <span className="mono">{counts.Maintenance || 0}</span>
      </div>

      <Card>
        {!beds.data ? <Loading error={beds.error} /> : groups.length ? groups.map((g) => (
          <div className="ward-block" key={g.hospital + g.ward + g.beds[0].ward_id}>
            <h3>{g.hospital} <span className="muted">·</span> <Badge value={g.ward} /></h3>
            <div className="bedmap">
              {g.beds.map((b) => (
                <div key={b.bed_id} className={`bed ${b.status}`} title={b.patient ? `${b.patient} (${b.severity})` : b.status}>
                  {b.bed_number}
                  {b.patient && <div className="who">{b.patient}</div>}
                  {canEdit && b.status !== 'Occupied' && (
                    <div><button className="ghost small" disabled={busy} onClick={() => toggle(b)}>
                      {b.status === 'Maintenance' ? 'Restore' : 'Maint.'}
                    </button></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )) : <Empty>No beds match these filters.</Empty>}
      </Card>
    </>
  );
}
