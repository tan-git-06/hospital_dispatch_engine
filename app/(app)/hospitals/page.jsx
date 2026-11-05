'use client';
import { useState } from 'react';
import { api, formData, useData } from '@/lib/client';
import { Badge, Card, Empty, Loading, Notice, PageHead, useAction } from '@/components/ui';

export default function HospitalsPage() {
  const { data, error, reload } = useData('/api/hospitals');
  const [wardFor, setWardFor] = useState('');
  const { busy, msg, run } = useAction();

  async function addHospital(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const out = await run(() => api('/api/hospitals', { method: 'POST', body: formData(form) }), 'Hospital added — now add wards');
    if (out) { form.reset(); setWardFor(String(out.hospital_id)); reload(); }
  }

  async function addWard(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = formData(form);
    const out = await run(() => api(`/api/hospitals/${body.hospital_id}/wards`, { method: 'POST', body }),
      `Ward created with ${body.total_beds} beds`);
    if (out) { form.reset(); reload(); }
  }

  async function remove(h) {
    if (!confirm(`Delete ${h.hospital_name}? Wards and beds are removed with it, but MySQL refuses if vehicles, users, patients or dispatches still reference it.`)) return;
    await run(() => api(`/api/hospitals/${h.hospital_id}`, { method: 'DELETE' }), `${h.hospital_name} deleted`);
    reload();
  }

  if (!data) return <Loading error={error} />;

  return (
    <>
      <PageHead title="Hospitals" sub="Admin only" />
      <Notice msg={msg} />

      <Card title="Network">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Hospital</th><th>Contact</th><th>Wards</th><th className="num">Beds free</th><th className="num">Vehicles</th><th /></tr></thead>
            <tbody>
              {data.hospitals.map((h) => (
                <tr key={h.hospital_id}>
                  <td><strong>{h.hospital_name}</strong><br /><span className="muted">{h.city} · capacity {h.total_capacity}</span></td>
                  <td className="mono">{h.contact_number}</td>
                  <td>
                    <div className="row">
                      {data.wards.filter((w) => w.hospital_id === h.hospital_id).map((w) => (
                        <span key={w.ward_id} title={`${w.available_beds}/${w.total_beds} free`}>
                          <Badge value={w.ward_type} /> <small className="mono muted">{w.available_beds}/{w.total_beds}</small>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num">{h.available_beds} / {h.beds}</td>
                  <td className="num">{h.vehicles}</td>
                  <td className="num"><button className="small danger" disabled={busy} onClick={() => remove(h)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.hospitals.length && <Empty>No hospitals.</Empty>}
        </div>
      </Card>

      <div className="grid two" style={{ marginTop: 16 }}>
        <Card title="Add hospital">
          <form className="stack" onSubmit={addHospital}>
            <label>Name<input name="hospital_name" required maxLength={100} /></label>
            <div className="fields">
              <label>City<input name="city" required maxLength={50} /></label>
              <label>Contact number<input name="contact_number" required placeholder="08012345678" /></label>
            </div>
            <label>Total capacity (beds)<input name="total_capacity" type="number" required /></label>
            <div className="fields">
              <label>Latitude (optional)<input name="latitude" type="number" step="any" min="-90" max="90" /></label>
              <label>Longitude (optional)<input name="longitude" type="number" step="any" min="-180" max="180" /></label>
            </div>
            <button disabled={busy}>Add hospital</button>
            <small className="muted">Enter capacity 0 to see the <span className="mono">CHECK (capacity &gt; 0)</span> constraint reject it. Contact: 10–15 digits, unique.</small>
          </form>
        </Card>
        <Card title="Add ward">
          <form className="stack" onSubmit={addWard}>
            <label>Hospital
              <select name="hospital_id" value={wardFor} onChange={(e) => setWardFor(e.target.value)} required>
                <option value="" disabled>Choose…</option>
                {data.hospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.hospital_name}</option>)}
              </select>
            </label>
            <div className="fields">
              <label>Ward type
                <select name="ward_type">{['ICU', 'Emergency', 'General', 'Trauma', 'Pediatric'].map((w) => <option key={w}>{w}</option>)}</select>
              </label>
              <label>Number of beds<input name="total_beds" type="number" min="1" max="99" required /></label>
            </div>
            <button disabled={busy}>Create ward + beds</button>
            <small className="muted"><span className="mono">sp_add_ward</span> inserts the ward and its beds in one transaction; a trigger rejects wards that exceed the hospital's capacity. One ward per type per hospital.</small>
          </form>
        </Card>
      </div>
    </>
  );
}
