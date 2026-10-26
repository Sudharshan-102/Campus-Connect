import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Badge, ErrorBox, Field } from '../components.jsx';

const cell = (v) => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  if (typeof v === 'boolean') return v ? '✔' : '–';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export default function QueryLab() {
  const { students, me } = useApp();
  const [list, setList] = useState([]);
  const [sel, setSel] = useState('direct-friends');
  const [p, setP] = useState({ student: '', other: '', interest: 'AI', depth: 2 });
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.queries().then(setList).catch(setErr); }, []);
  useEffect(() => {
    if (!students.length) return;
    setP((x) => ({ ...x, student: x.student || me || students[0].id, other: x.other || students[1]?.id || students[0].id }));
  }, [students, me]);

  const q = useMemo(() => list.find((x) => x.id === sel), [list, sel]);

  const run = async () => {
    if (!q) return;
    setBusy(true); setErr(null);
    try { setRes(await api.runQuery(q.id, Object.fromEntries(q.needs.map((n) => [n, p[n]])))); } catch (e) { setErr(e); setRes(null); } finally { setBusy(false); }
  };
  useEffect(() => { if (q && p.student) run(); }, [sel, p.student]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = res?.rows?.length ? Object.keys(res.rows[0]).filter((c) => c !== 'id' || res.rows.length) : [];
  const pending = sel === 'pending-requests';

  return (
    <div className="page">
      <div className="page-head"><div><h1>Query Lab</h1><p>The ten graph questions from the case study: the exact SurrealQL that ran, and its live result.</p></div></div>
      <div className="grid" style={{ gridTemplateColumns: '300px 1fr' }}>
        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="list">
            {list.map((x) => (
              <button key={x.id} className={`item ${sel === x.id ? 'flash' : ''}`} onClick={() => setSel(x.id)}
                style={{ cursor: 'pointer', textAlign: 'left', borderColor: sel === x.id ? 'var(--purple)' : undefined, background: sel === x.id ? 'rgba(139,92,246,.18)' : undefined }}>
                <span style={{ fontSize: '.88rem' }}>{x.title}</span>
              </button>))}
          </div>
        </div>
        <div className="list">
          {q && (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{q.title}</h2><Badge kind={q.kind === 'multi-hop' ? 'multi-hop' : 'direct'}>{q.kind}</Badge></div>
              <p style={{ color: 'var(--muted)', marginTop: 8 }}>{q.explain}</p>
              <div className="two-col">
                {q.needs.includes('student') && (
                  <Field label={pending ? 'Mentor' : 'Student'}><select value={p.student} onChange={(e) => setP({ ...p, student: e.target.value })}>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>)}
                {q.needs.includes('other') && (
                  <Field label="Compare with"><select value={p.other} onChange={(e) => setP({ ...p, other: e.target.value })}>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>)}
                {q.needs.includes('interest') && <Field label="Interest / skill word"><input value={p.interest} onChange={(e) => setP({ ...p, interest: e.target.value })} /></Field>}
                {q.needs.includes('depth') && <Field label={`Depth: ${p.depth} hop${p.depth > 1 ? 's' : ''}`}><input type="range" min="1" max="4" value={p.depth} onChange={(e) => setP({ ...p, depth: Number(e.target.value) })} /></Field>}
              </div>
              <button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Running…' : '▶ Run query'}</button>
            </div>)}
          <ErrorBox error={err} />
          {res && (
            <>
              <div className="card"><h3>SurrealQL executed</h3><pre className="code">{res.surql}</pre></div>
              <div className="card">
                <h3>Result: {res.rows.length} row{res.rows.length === 1 ? '' : 's'}</h3>
                {res.rows.length === 0 ? <div className="empty">No rows.</div> : (
                  <div className="table-wrap"><table>
                    <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>{res.rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{c === 'reach' ? <Badge kind={r[c]}>{r[c]}</Badge> : cell(r[c])}</td>)}</tr>)}</tbody>
                  </table></div>)}
              </div>
            </>)}
        </div>
      </div>
    </div>
  );
}
