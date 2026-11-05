// Turns a MongoDB `dispatch_events` document into a readable line. Each event_type carries a different
// `payload`, so the switch reads only what that type has -- the flexible document shape that justified using Mongo.
export function eventTone(e) {
  const p = e.payload || {};
  switch (e.event_type) {
    case 'CALL_RECEIVED': return 'amber';
    case 'VEHICLE_ASSIGNED': return 'amber';
    case 'STATUS_CHANGED': return p.to === 'Completed' ? 'green' : p.to === 'Cancelled' ? 'grey' : 'blue';
    case 'DISPATCH_FAILED': return 'red';
    case 'PATIENT_ADMITTED': return 'blue';
    case 'PATIENT_DISCHARGED': return 'green';
    default: return '';
  }
}

export function describe(e) {
  const p = e.payload || {};
  switch (e.event_type) {
    case 'CALL_RECEIVED':
      return `Call #${e.call_id} — ${p.severity?.toLowerCase() ?? 'unknown'} at ${p.pickup ?? '?'}`;
    case 'VEHICLE_ASSIGNED':
      return `Dispatch #${e.request_id}: ${p.vehicle ?? `vehicle #${p.vehicle_id}`} sent${p.driver ? ` with ${p.driver}` : ''}`
        + `${p.hospital ? ` → ${p.hospital}` : ''}`
        + `${p.distance_m != null ? ` · ${(p.distance_m / 1000).toFixed(1)} km away (geo-selected)` : ''}`;
    case 'STATUS_CHANGED':
      return `Dispatch #${e.request_id}: ${String(p.from).replace(/_/g, ' ')} → ${String(p.to).replace(/_/g, ' ')}${p.reason ? ` — ${p.reason}` : ''}`;
    case 'DISPATCH_FAILED':
      return `Call #${e.call_id} not dispatched — ${p.reason ?? 'no reason recorded'}`;
    case 'PATIENT_ADMITTED':
      return `Patient #${p.patient_id} admitted to ${p.ward ?? 'ward'}${p.bed_number ? ` bed ${p.bed_number}` : ''}`;
    case 'PATIENT_DISCHARGED':
      return `Patient #${p.patient_id} discharged`;
    default: return e.event_type;
  }
}
