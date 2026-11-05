'use client';
import { useData } from '@/lib/client';
import { Card, Empty, Loading, PageHead } from '@/components/ui';

// Renders any array of row objects as a table — columns come from the keys,
// so each report's SELECT list decides what's shown.
function ResultTable({ rows }) {
  if (!rows?.length) return <Empty>No rows.</Empty>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === 'number' || /^\d+(\.\d+)?$/.test(r[c]) ? 'num' : ''}>{r[c] ?? '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const { data, error } = useData('/api/reports');
  if (!data) return <Loading error={error} />;

  return (
    <>
      <PageHead title="Reports" sub="Analytical queries — each card shows the SQL that produced it" />
      <div className="grid two">
        {data.sql.map((r) => (
          <Card key={r.key} title={r.title} aside={<span className="badge blue">{r.concept}</span>}>
            <details><summary>Show SQL</summary><pre className="sql">{r.sql}</pre></details>
            <ResultTable rows={r.rows} />
          </Card>
        ))}

        <Card title="Avg. dispatch → completion time by hospital" aside={<span className="badge green">MongoDB aggregation</span>}>
          {data.mongo.error ? <div className="notice err">{data.mongo.error}</div> : (
            <>
              <details><summary>Show pipeline</summary><pre className="sql">{JSON.stringify(data.mongo.pipeline, null, 2)}</pre></details>
              <ResultTable rows={data.mongo.rows} />
              <h3 style={{ fontSize: 13, margin: '18px 0 6px' }}>Events by type</h3>
              <ResultTable rows={data.mongo.byType} />
            </>
          )}
        </Card>
        {!data.mongo.error && (
          <Card title="Vehicle speed, last hour" aside={<span className="badge green">MongoDB $group on telemetry</span>}>
            <ResultTable rows={data.mongo.speeds} />
          </Card>
        )}
      </div>
    </>
  );
}
