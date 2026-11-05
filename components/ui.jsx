'use client';
import { useState } from 'react';

// Status → colour. One map, so every table speaks the same visual language.
// Keys are the exact ENUM values stored in MySQL (db/mysql/01_schema.sql).
const TONE = {
  Critical: 'red', High: 'amber', Medium: 'blue', Low: 'green',
  Available: 'green', Occupied: 'red', Maintenance: 'grey',
  Dispatched: 'amber', En_Route: 'blue', Arrived: 'blue', Completed: 'green', Cancelled: 'grey',
  On_Duty: 'blue', Off_Duty: 'grey',
  admin: 'blue', dispatcher: 'amber', hospital_staff: 'green',
};
const LABEL = { admin: 'Admin', dispatcher: 'Dispatcher', hospital_staff: 'Hospital staff' };

export function Badge({ value }) {
  if (!value) return <span className="muted">—</span>;
  return <span className={`badge ${TONE[value] || 'grey'}`}>{LABEL[value] ?? String(value).replace(/_/g, ' ')}</span>;
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="row">{children}</div>
    </header>
  );
}

export function Card({ title, aside, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && (
        <div className="card-head">
          <h2>{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Notice({ msg }) {
  if (!msg) return null;
  return <div className={`notice ${msg.type}`}>{msg.text}</div>;
}

// Runs an async action, tracks busy state, and returns a message for <Notice/>.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function run(fn, success) {
    setBusy(true);
    setMsg(null);
    try {
      const out = await fn();
      if (out?.warning) setMsg({ type: 'warn', text: out.warning });
      else if (success) setMsg({ type: 'ok', text: typeof success === 'function' ? success(out) : success });
      return out;
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, setMsg, run };
}

export function Loading({ error }) {
  if (error) return <div className="notice err">{error}</div>;
  return <div className="loading">Loading…</div>;
}
