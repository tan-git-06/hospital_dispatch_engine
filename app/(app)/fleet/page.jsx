'use client';
import { api, formData, useData } from '@/lib/client';
import { Badge, Card, Empty, Loading, Notice, PageHead, useAction } from '@/components/ui';

export default function FleetPage() {
  const fleet = useData('/api/fleet');
  const hospitals = useData('/api/hospitals');
  const me = useData('/api/auth/me');
  const isAdmin = me.data?.role === 'admin';
  const { busy, msg, run } = useAction();

  const patch = async (url, body, text) => { await run(() => api(url, { method: 'PATCH', body }), text); fleet.reload(); };

  async function add(e, url, text) {
    e.preventDefault();
    const form = e.currentTarget;
    const out = await run(() => api(url, { method: 'POST', body: formData(form) }), text);
    if (out) { form.reset(); fleet.reload(); }
  }

  if (!fleet.data) return <Loading error={fleet.error} />;
  const { vehicles, drivers } = fleet.data;

  return (
    <>
      <PageHead title="Fleet" sub="Vehicles and drivers. Dispatched / On duty are set by the dispatch triggers." />
      <Notice msg={msg} />

      <div className="grid two">
        <Card title={`Vehicles (${vehicles.length})`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Reg. no</th><th>Type</th><th>Base</th><th>Status</th><th /></tr></thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.vehicle_id}>
                    <td className="mono">{v.registration_no}</td>
                    <td>{v.vehicle_type}</td>
                    <td>{v.hospital_name}</td>
                    <td><Badge value={v.status} /></td>
                    <td className="num">
                      {v.status !== 'Dispatched' && (
                        <button className="small ghost" disabled={busy}
                          onClick={() => patch(`/api/fleet/vehicles/${v.vehicle_id}`,
                            { status: v.status === 'Maintenance' ? 'Available' : 'Maintenance' }, `${v.registration_no} updated`)}>
                          {v.status === 'Maintenance' ? 'Back in service' : 'Maintenance'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!vehicles.length && <Empty>No vehicles.</Empty>}
          </div>
        </Card>

        <Card title={`Drivers (${drivers.length})`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>License</th><th className="num">Trips</th><th>Status</th><th /></tr></thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.driver_id}>
                    <td><strong>{d.full_name}</strong><br /><small className="muted mono">{d.phone_number}</small></td>
                    <td className="mono">{d.license_number}</td>
                    <td className="num">{d.trips}</td>
                    <td><Badge value={d.status} /></td>
                    <td className="num">
                      {d.status !== 'On_Duty' && (
                        <button className="small ghost" disabled={busy}
                          onClick={() => patch(`/api/fleet/drivers/${d.driver_id}`,
                            { status: d.status === 'Off_Duty' ? 'Available' : 'Off_Duty' }, `${d.full_name} updated`)}>
                          {d.status === 'Off_Duty' ? 'Clock in' : 'Clock out'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {isAdmin && (
        <div className="grid two" style={{ marginTop: 16 }}>
          <Card title="Add vehicle">
            <form className="stack" onSubmit={(e) => add(e, '/api/fleet/vehicles', 'Vehicle added')}>
              <div className="fields">
                <label>Registration no<input name="registration_no" placeholder="KA01AB1234" required maxLength={15} /></label>
                <label>Type
                  <select name="vehicle_type">
                    <option value="BLS">BLS — basic life support</option>
                    <option value="ALS">ALS — advanced life support</option>
                    <option value="ICU">ICU ambulance</option>
                    <option value="Neonatal">Neonatal</option>
                  </select>
                </label>
              </div>
              <label>Base hospital
                <select name="hospital_id" required>
                  {hospitals.data?.hospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.hospital_name}</option>)}
                </select>
              </label>
              <button disabled={busy}>Add vehicle</button>
            </form>
          </Card>
          <Card title="Add driver">
            <form className="stack" onSubmit={(e) => add(e, '/api/fleet/drivers', 'Driver added')}>
              <label>Full name<input name="full_name" required maxLength={100} /></label>
              <div className="fields">
                <label>License no<input name="license_number" required maxLength={20} /></label>
                <label>Phone<input name="phone_number" required placeholder="9845012345" /></label>
              </div>
              <button disabled={busy}>Add driver</button>
              <small className="muted">Try a duplicate license or a phone with letters — MySQL's UNIQUE and CHECK constraints reject it (phone: 10–15 digits).</small>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
