'use client';
import { useState } from 'react';
import { api, formData, timeAgo, useData } from '@/lib/client';
import { Badge, Card, Empty, Loading, Notice, PageHead, useAction } from '@/components/ui';
import { describe, eventTone } from '@/components/events';

// Next status a dispatcher can move to from each state (mirrors sp_update_dispatch_status)
const NEXT = { Dispatched: 'En_Route', En_Route: 'Arrived', Arrived: 'Completed' };
const NEXT_LABEL = { En_Route: 'En route', Arrived: 'Arrived', Completed: 'Complete' };

export default function DispatchPage() {
  const dispatches = useData('/api/dispatch');
  const history = useData('/api/dispatch/history');
  const pending = useData('/api/calls?pending=1');
  const [selected, setSelected] = useState(null);
  const timeline = useData(selected ? `/api/events?request_id=${selected}` : null);
  const { busy, msg, run } = useAction();

  const refresh = () => { dispatches.reload(); history.reload(); pending.reload(); if (selected) timeline.reload(); };

  const summary = (o) => `Dispatched ${o.registration_no} (${o.vehicle_type}) with ${o.driver_name} → ${o.hospital_name}`
    + (o.distance_m != null ? ` · ${(o.distance_m / 1000).toFixed(1)} km away (MongoDB $geoNear)` : '');

  // Two steps on purpose: (1) log the call, (2) ask the engine to dispatch it. If (2) fails (no free unit),
  // the call is already saved and waits in the "Waiting for a unit" queue.
  async function newCall(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = formData(form);
    const out = await run(async () => {
      const call = await api('/api/calls', { method: 'POST', body: {
        caller_phone: f.caller_phone, pickup_location: f.pickup_location, severity: f.severity,
        pickup_lat: f.pickup_lat || null, pickup_lng: f.pickup_lng || null } });
      try {
        return await api('/api/dispatch', { method: 'POST', body: { call_id: call.call_id } });
      } catch (err) {
        return { warning: `Call #${call.call_id} logged but not dispatched yet: ${err.message}. It is in the waiting queue.` };
      }
    }, summary);
    if (out) { form.reset(); refresh(); if (out.request_id) setSelected(out.request_id); }
  }

  async function advance(d, status) {
    const reason = status === 'Cancelled' ? prompt('Reason for cancelling?') ?? undefined : undefined;
    if (status === 'Cancelled' && reason === undefined) return;
    await run(() => api(`/api/dispatch/${d.request_id}/status`, { method: 'PATCH', body: { status, reason } }),
      `Dispatch #${d.request_id} → ${status.replace('_', ' ').toLowerCase()}`);
    refresh();
  }

  async function retry(c) {
    await run(() => api('/api/dispatch', { method: 'POST', body: { call_id: c.call_id } }), summary);
    refresh();
  }

  return (
    <>
      <PageHead title="Dispatch" sub="Log a call — the engine picks vehicle, driver and destination hospital" />
      <Notice msg={msg} />

      <div className="grid three">
        <Card title="Active dispatches" aside={<span className="muted mono">v_active_dispatches</span>}>
          {!dispatches.data ? <Loading error={dispatches.error} /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Pickup</th><th>Sev.</th><th>Unit / driver</th><th>To</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {dispatches.data.map((d) => (
                    <tr key={d.request_id} className={selected === d.request_id ? 'selected' : ''}
                      onClick={() => setSelected(d.request_id)} style={{ cursor: 'pointer' }}>
                      <td className="mono">{d.request_id}</td>
                      <td>{d.pickup_location}<br /><small className="muted">{timeAgo(d.dispatch_time)}</small></td>
                      <td><Badge value={d.severity} /></td>
                      <td><span className="mono">{d.registration_no}</span> <small className="muted">{d.vehicle_type}</small><br /><small className="muted">{d.driver_name}</small></td>
                      <td>{d.dest_hospital}</td>
                      <td><Badge value={d.status} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <button className="small" disabled={busy} onClick={() => advance(d, NEXT[d.status])}>{NEXT_LABEL[NEXT[d.status]]}</button>
                          <button className="small danger" disabled={busy} onClick={() => advance(d, 'Cancelled')}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!dispatches.data.length && <Empty>No units out right now.</Empty>}
            </div>
          )}
        </Card>

        <Card title="New emergency call">
          <form className="stack" onSubmit={newCall}>
            <label>Caller phone<input name="caller_phone" placeholder="9876543210" required /></label>
            <label>Pickup location<input name="pickup_location" placeholder="Street, area, landmark" required /></label>
            <label>Severity
              <select name="severity" defaultValue="Medium">
                <option value="Critical">Critical → ICU / ALS first</option>
                <option value="High">High → ICU / ALS first</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>
            <div className="fields">
              <label>Latitude (optional)<input name="pickup_lat" type="number" step="any" min="-90" max="90" placeholder="12.9784" /></label>
              <label>Longitude (optional)<input name="pickup_lng" type="number" step="any" min="-180" max="180" placeholder="77.6408" /></label>
            </div>
            <button className="primary" disabled={busy}>{busy ? 'Dispatching…' : 'Log call & dispatch'}</button>
            <small className="muted">
              With coordinates, MongoDB <span className="mono">$geoNear</span> picks the closest suitable vehicle; then
              <span className="mono"> sp_dispatch_ambulance</span> locks vehicle + driver and picks the hospital with most free beds.
            </small>
          </form>
        </Card>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <Card title="Waiting for a unit" aside={<span className="muted">calls with no live dispatch</span>}>
          {!pending.data ? <Loading error={pending.error} /> : pending.data.length ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  {pending.data.map((c) => (
                    <tr key={c.call_id}>
                      <td className="mono">#{c.call_id}</td>
                      <td>{c.pickup_location}<br /><small className="muted">{timeAgo(c.call_time)}</small></td>
                      <td><Badge value={c.severity} /></td>
                      <td className="num"><button className="small" disabled={busy} onClick={() => retry(c)}>Dispatch</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Queue is clear.</Empty>}
        </Card>

        <Card title={selected ? `Timeline · dispatch #${selected}` : 'Timeline'} aside={<span className="muted mono">MongoDB dispatch_events</span>}>
          {!selected ? <Empty>Click a dispatch to see its event history.</Empty>
            : timeline.data?.length ? (
              <ul className="feed">
                {timeline.data.map((e, i) => (
                  <li key={i}><span className={`dot ${eventTone(e) || 'blue'}`} />
                    <div>{describe(e)}<br /><small>{new Date(e.created_at).toLocaleString()}{e.actor ? ` · ${e.actor}` : ''}</small></div>
                  </li>
                ))}
              </ul>
            ) : <Empty>{timeline.error || 'No events for this dispatch.'}</Empty>}
        </Card>
      </div>

      {history.data?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Recently closed">
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Pickup</th><th>Unit</th><th>Hospital</th><th>Status</th></tr></thead>
                <tbody>
                  {history.data.map((d) => (
                    <tr key={d.request_id} onClick={() => setSelected(d.request_id)} style={{ cursor: 'pointer' }}>
                      <td className="mono">{d.request_id}</td><td>{d.pickup_location}</td>
                      <td className="mono">{d.registration_no}</td><td>{d.hospital_name}</td><td><Badge value={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
