'use client';
import { useEffect, useState } from 'react';
import { api, formData, timeAgo, useData } from '@/lib/client';
import { Badge, Card, Empty, Loading, Notice, PageHead, useAction } from '@/components/ui';

// Debounce: wait until typing pauses 300 ms before searching, instead of firing a query on every keystroke.
function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// '' -> skipped, otherwise Number  (Mongo's $jsonSchema wants real numbers, not strings)
const numbers = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)]));

export default function PatientsPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const patients = useData(`/api/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const hospitals = useData('/api/hospitals');
  const me = useData('/api/auth/me');
  const isStaff = me.data?.role === 'hospital_staff';
  const [vitalsFor, setVitalsFor] = useState(null);           // the admitted row whose vitals are open
  const vitals = useData(vitalsFor ? `/api/patients/${vitalsFor.patient_id}/vitals` : null);
  const { busy, msg, run } = useAction();

  async function admit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = formData(form);
    const body = {
      name: f.name, age: Number(f.age), gender: f.gender, severity: f.severity, complaint: f.complaint || null,
      hospital_id: f.hospital_id ? Number(f.hospital_id) : undefined,   // staff: ignored, the server uses their own hospital
      vitals: numbers({ heart_rate: f.heart_rate, spo2: f.spo2 }),
    };
    const out = await run(() => api('/api/patients/admit', { method: 'POST', body }),
      (o) => `Admitted — ${o.ward_type} bed ${o.bed_number} allocated`);
    if (out) { form.reset(); patients.reload(); }
  }

  async function discharge(a) {
    if (!confirm(`Discharge ${a.name} from bed ${a.bed_number}?`)) return;
    await run(() => api(`/api/patients/${a.patient_id}/discharge`, { method: 'POST' }), `${a.name} discharged — bed ${a.bed_number} is free`);
    if (vitalsFor?.patient_id === a.patient_id) setVitalsFor(null);
    patients.reload();
  }

  async function addReading(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = formData(form);
    const out = await run(() => api(`/api/patients/${vitalsFor.patient_id}/vitals`, { method: 'POST', body: {
      vitals: numbers({ heart_rate: f.heart_rate, spo2: f.spo2, bp_systolic: f.bp_systolic, bp_diastolic: f.bp_diastolic, temp_c: f.temp_c }),
      notes: f.notes || '' } }), 'Reading saved');
    if (out) { form.reset(); vitals.reload(); }
  }

  return (
    <>
      <PageHead title="Patients" sub="Admit, review vitals and discharge">
        <input placeholder="Search name (full-text)…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
      </PageHead>
      <Notice msg={msg} />

      <div className="grid three">
        <Card title="Currently admitted" aside={<span className="muted mono">bed_allocation · discharge_time IS NULL</span>}>
          {!patients.data ? <Loading error={patients.error} /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Patient</th><th>Sev.</th><th>Bed</th><th>Hospital</th><th>Since</th><th /></tr></thead>
                <tbody>
                  {patients.data.admitted.map((a) => (
                    <tr key={a.allocation_id} className={vitalsFor?.patient_id === a.patient_id ? 'selected' : ''}
                      onClick={() => setVitalsFor(a)} style={{ cursor: 'pointer' }}>
                      <td><strong>{a.name}</strong><br /><small className="muted">{a.age} · {a.gender}{a.chief_complaint ? ` · ${a.chief_complaint}` : ''}</small></td>
                      <td><Badge value={a.severity} /></td>
                      <td><span className="mono">{a.bed_number}</span> <small className="muted">{a.ward_type}</small></td>
                      <td>{a.hospital_name}</td>
                      <td className="muted">{timeAgo(a.allocated_time)}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <button className="small ghost" disabled={busy} onClick={() => discharge(a)}>Discharge</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!patients.data.admitted.length && <Empty>{q ? 'No matches.' : 'No one admitted.'}</Empty>}
            </div>
          )}
        </Card>

        <Card title="Admit patient">
          <form className="stack" onSubmit={admit}>
            <label>Full name<input name="name" required maxLength={100} /></label>
            <div className="fields">
              <label>Age<input name="age" type="number" min="0" max="120" required /></label>
              <label>Gender
                <select name="gender"><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select>
              </label>
            </div>
            <label>Severity
              <select name="severity" defaultValue="Medium">
                <option value="Critical">Critical → ICU first</option><option value="High">High → ICU first</option>
                <option value="Medium">Medium</option><option value="Low">Low</option>
              </select>
            </label>
            {!isStaff && (
              <label>Hospital
                <select name="hospital_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {hospitals.data?.hospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.hospital_name} ({h.available_beds} free)</option>)}
                </select>
              </label>
            )}
            <label>Chief complaint<input name="complaint" maxLength={255} /></label>
            <div className="fields">
              <label>Heart rate (optional)<input name="heart_rate" type="number" min="0" max="300" /></label>
              <label>SpO₂ % (optional)<input name="spo2" type="number" min="0" max="100" /></label>
            </div>
            <button className="primary" disabled={busy}>{busy ? 'Admitting…' : 'Admit & allocate bed'}</button>
            <small className="muted">
              Runs <span className="mono">sp_register_and_allocate</span> in one transaction: picks the best free bed
              (ICU first for Critical/High). No free bed → everything rolls back. Vitals go to MongoDB.
              {isStaff && ' You can only admit to your own hospital.'}
            </small>
          </form>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title={vitalsFor ? `Vitals · ${vitalsFor.name}` : 'Vitals'} aside={<span className="muted mono">MongoDB patient_vitals</span>}>
          {!vitalsFor ? <Empty>Click an admitted patient to see and record vitals.</Empty>
            : !vitals.data ? <Loading error={vitals.error} /> : (
              <div className="grid two">
                <div>
                  {vitals.data.trend && (
                    <p className="muted" style={{ marginTop: 0 }}>
                      {vitals.data.trend.readings} readings · avg HR {vitals.data.trend.avg_hr != null ? Math.round(vitals.data.trend.avg_hr) : '—'}
                      {' '}· min SpO₂ {vitals.data.trend.min_spo2 ?? '—'} · latest SpO₂ {vitals.data.trend.latest_spo2 ?? '—'}
                    </p>
                  )}
                  {vitals.data.readings.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>When</th><th className="num">HR</th><th className="num">SpO₂</th><th className="num">BP</th><th className="num">Temp</th><th>Notes</th></tr></thead>
                        <tbody>
                          {vitals.data.readings.map((r, i) => (
                            <tr key={i}>
                              <td className="muted">{timeAgo(r.recorded_at)}</td>
                              <td className="num">{r.vitals?.heart_rate ?? '—'}</td>
                              <td className="num">{r.vitals?.spo2 ?? '—'}</td>
                              <td className="num">{r.vitals?.bp_systolic ? `${r.vitals.bp_systolic}/${r.vitals.bp_diastolic ?? '?'}` : '—'}</td>
                              <td className="num">{r.vitals?.temp_c ?? '—'}</td>
                              <td>{r.notes || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <Empty>No readings yet.</Empty>}
                </div>
                <form className="stack" onSubmit={addReading}>
                  <div className="fields">
                    <label>Heart rate<input name="heart_rate" type="number" min="0" max="300" /></label>
                    <label>SpO₂ %<input name="spo2" type="number" min="0" max="100" /></label>
                  </div>
                  <div className="fields">
                    <label>BP systolic<input name="bp_systolic" type="number" /></label>
                    <label>BP diastolic<input name="bp_diastolic" type="number" /></label>
                  </div>
                  <label>Temp °C<input name="temp_c" type="number" step="0.1" min="25" max="45" /></label>
                  <label>Notes<textarea name="notes" rows={2} /></label>
                  <button disabled={busy}>Save reading</button>
                  <small className="muted">Out-of-range values are rejected by MongoDB's <span className="mono">$jsonSchema</span> validator.</small>
                </form>
              </div>
            )}
        </Card>
      </div>
    </>
  );
}
