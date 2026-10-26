import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp, useLiveData } from '../store.jsx';
import { Badge, ErrorBox, Field, Loading, Person, ago } from '../components.jsx';

const TABLES = ['mentorship_request', 'mentors', 'student'];

const STEPS = [
  { t: 'BEGIN TRANSACTION', d: 'Everything below is one all-or-nothing unit.', kind: '' },
  { t: 'Read the request and check it is still “pending”', d: 'Not found, already processed, or not addressed to you: stop with an error.', kind: '' },
  { t: 'Check the participants and the rule', d: 'Both students exist, no self-mentoring, mentor is senior, no active mentorship already.', kind: '' },
  { t: 'WRITE 1: set request.status = “accepted”', d: 'A write inside the transaction (not visible to anyone else yet).', kind: 'write' },
  { t: 'WRITE 2: RELATE mentor → mentors → mentee', d: 'The new mentorship edge, also still uncommitted.', kind: 'write' },
  { t: 'COMMIT TRANSACTION', d: 'Both writes become visible together. If anything above failed, SurrealDB discards both.', kind: 'ok' },
];

function RequestForm({ me, students, onDone }) {
  const { toast } = useApp();
  const mine = students.find((s) => s.id === me);
  const seniors = students.filter((s) => mine && s.year > mine.year && s.id !== me);
  const [mentor, setMentor] = useState('');
  const [expertise, setExpertise] = useState('');
  const [message, setMessage] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => { setMentor(''); }, [me]);
  const pickedMentor = students.find((s) => s.id === mentor);

  const send = async (e) => {
    e.preventDefault();
    try {
      await api.requestMentorship({ mentorId: mentor, expertise: expertise || pickedMentor?.skills?.[0] || '', message });
      toast(`Request sent to ${pickedMentor?.name}`, 'success');
      setErr(null); setMessage(''); onDone();
    } catch (x) { setErr(x); }
  };

  return (
    <form onSubmit={send}>
      <ErrorBox error={err} />
      <Field label="Ask this senior student">
        <select value={mentor} onChange={(e) => { setMentor(e.target.value); setExpertise(''); }} required>
          <option value="">Choose a mentor…</option>
          {seniors.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.department} Y{s.year}</option>)}
        </select>
      </Field>
      <Field label="Topic" hint={pickedMentor ? `Their skills: ${pickedMentor.skills.join(', ')}` : ''}>
        <input value={expertise} onChange={(e) => setExpertise(e.target.value)} placeholder={pickedMentor?.skills?.[0] ?? 'e.g. Machine Learning'} maxLength={60} />
      </Field>
      <Field label="Message"><textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} style={{ minHeight: 60 }} /></Field>
      <button className="btn primary" disabled={!mentor}>Send request</button>
    </form>
  );
}

export default function Mentorship() {
  const { me, students, toast } = useApp();
  const [result, setResult] = useState(null); // last commit
  const [demo, setDemo] = useState(null); // rollback demo result
  const [sql, setSql] = useState('');
  const [showSql, setShowSql] = useState(false);
  const [busy, setBusy] = useState('');
  const [flashIds, setFlashIds] = useState(new Set());

  const reqs = useLiveData(() => api.requests(), TABLES);
  const ments = useLiveData(() => api.mentorships(), TABLES);
  useEffect(() => { api.transactionSql().then((d) => setSql(d.surql)).catch(() => {}); }, []);

  // highlight rows that just arrived through the live connection
  const prevIds = useMemo(() => ({ current: new Set() }), []);
  useEffect(() => {
    const ids = new Set((reqs.data ?? []).map((r) => r.id));
    if (prevIds.current.size) {
      const fresh = [...ids].filter((i) => !prevIds.current.has(i));
      if (fresh.length) { setFlashIds(new Set(fresh)); setTimeout(() => setFlashIds(new Set()), 2500); }
    }
    prevIds.current = ids;
  }, [reqs.data, prevIds]);

  const all = reqs.data ?? [];
  const incoming = all.filter((r) => r.mentor.id === me);
  const outgoing = all.filter((r) => r.mentee.id === me);
  const pendingIn = incoming.filter((r) => r.status === 'pending');
  const active = (ments.data ?? []).filter((m) => m.status === 'active' && (m.mentor.id === me || m.mentee.id === me));
  const allPending = all.filter((r) => r.status === 'pending');
  const [pickDemo, setPickDemo] = useState('');
  const demoTarget = pickDemo || pendingIn[0]?.id || '';

  const run = (label, fn) => async (...a) => {
    setBusy(label);
    try { return await fn(...a); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const accept = (r) => run('accept', async () => {
    const out = await api.accept(r.id);
    setDemo(null);
    setResult({ ok: true, request: out.request, mentorship: out.mentorship, mentor: r.mentor.name, mentee: r.mentee.name });
    toast(`Committed: ${r.mentee.name} is now mentored by ${r.mentor.name}`, 'success');
    reqs.refresh(); ments.refresh();
  })();
  const reject = (r) => run('reject', async () => { await api.reject(r.id); toast('Request declined', 'info'); reqs.refresh(); })();
  const cancel = (r) => run('cancel', async () => { await api.cancel(r.id); toast('Request withdrawn', 'info'); reqs.refresh(); })();
  const end = (m) => run('end', async () => { await api.endMentorship(m.id); toast('Mentorship ended (history kept)', 'info'); ments.refresh(); })();
  const rollback = () => run('rollback', async () => {
    const d = await api.rollbackDemo(demoTarget);
    setResult(null); setDemo(d); reqs.refresh();
  })();

  if (!me) {
    return (
      <div className="page"><div className="page-head"><div><h1>Mentorship Center</h1><p>Choose who you are acting as in the top bar to see your requests.</p></div></div>
        <div className="grid two">
          <div className="empty">Pick a student under “Acting as” (top right). Tip: pick a final-year student to receive requests, and a first-year in a second window to send them.</div>
          <div className="card"><h2>All pending requests right now</h2>
            {allPending.length === 0 ? <div className="empty">None</div> : <div className="list">{allPending.map((r) => (
              <div className="item" key={r.id}><span>{r.mentee.name} → {r.mentor.name}</span><Badge>{r.status}</Badge></div>))}</div>}
          </div>
        </div>
      </div>
    );
  }

  const history = incoming.concat(outgoing).filter((r) => r.status !== 'pending').slice(0, 6);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Mentorship Center</h1><p>Requests are edges <code>mentee → mentor</code>. Accepting one runs a single atomic transaction.</p></div>
      </div>

      <div className="grid two">
        <div className="list">
          <div className="card">
            <h2>Incoming requests (you are the mentor) <Badge kind="pending">{pendingIn.length} pending</Badge></h2>
            {!reqs.data ? <Loading /> : incoming.length === 0 ? <div className="empty">Nobody has asked you yet. Open another window as a junior student and send a request. It will appear here instantly.</div> : (
              <div className="list">{incoming.filter((r) => r.status === 'pending').map((r) => (
                <div className={`item ${flashIds.has(r.id) ? 'flash' : ''}`} key={r.id}>
                  <div><Person s={r.mentee} extra={r.expertise} />{r.message && <div className="sub" style={{ marginLeft: 44 }}>“{r.message}”</div>}<div className="sub" style={{ marginLeft: 44 }}>{ago(r.created_at)}</div></div>
                  <div className="row">
                    <button className="btn success sm" disabled={!!busy} onClick={() => accept(r)}>Accept</button>
                    <button className="btn danger sm" disabled={!!busy} onClick={() => reject(r)}>Reject</button>
                  </div>
                </div>))}
                {pendingIn.length === 0 && <div className="empty">No pending requests.</div>}
              </div>)}
          </div>

          <div className="card">
            <h2>Your outgoing requests (you are the mentee)</h2>
            {outgoing.length === 0 ? <div className="empty">You have not asked anyone yet.</div> : (
              <div className="list">{outgoing.map((r) => (
                <div className={`item ${flashIds.has(r.id) ? 'flash' : ''}`} key={r.id}>
                  <div><Person s={r.mentor} extra={r.expertise} /><div className="sub" style={{ marginLeft: 44 }}><Badge>{r.status}</Badge> {ago(r.created_at)}</div></div>
                  {r.status === 'pending' && <button className="btn sm" disabled={!!busy} onClick={() => cancel(r)}>Cancel</button>}
                </div>))}
              </div>)}
            <h3 style={{ marginTop: 18 }}>Send a new request</h3>
            <RequestForm me={me} students={students} onDone={() => reqs.refresh()} />
          </div>

          <div className="card">
            <h2>Active mentorships</h2>
            {active.length === 0 ? <div className="empty">No active mentorships for this student yet.</div> : (
              <div className="list">{active.map((m) => (
                <div className="item" key={m.id}>
                  <div className="row"><Person s={m.mentor} extra="mentor" /><span>→</span><Person s={m.mentee} extra="mentee" /></div>
                  <div className="row"><Badge>{m.status}</Badge><span className="chip">{m.expertise}</span><button className="btn sm danger" onClick={() => end(m)}>End</button></div>
                </div>))}
              </div>)}
            {history.length > 0 && (<><h3 style={{ marginTop: 18 }}>Recently resolved</h3>
              <div className="list">{history.map((r) => <div className="item" key={r.id}><span>{r.mentee.name} → {r.mentor.name} ({r.expertise})</span><Badge>{r.status}</Badge></div>)}</div></>)}
          </div>
        </div>

        <div className="list">
          <div className="card">
            <h2>What happens when you press Accept</h2>
            <div className="atomic">
              <div className="tag">One atomic transaction</div>
              <div className="flow">
                {STEPS.map((s, i) => (
                  <div key={i} className={`step ${s.kind} ${demo && i >= 3 && i <= 4 ? 'fail' : ''}`}>
                    <div className="n">{i + 1}</div><div><b>{s.t}</b><small>{s.d}</small></div>
                  </div>))}
              </div>
            </div>
            <p className="hint">If steps 4 and 5 ran but something fails before the commit, SurrealDB cancels the transaction and neither write survives. You can never see “accepted” without a mentorship edge, or the reverse.</p>
            <button className="btn sm" onClick={() => setShowSql(!showSql)}>{showSql ? 'Hide' : 'Show'} the real SurrealQL</button>
            {showSql && <pre className="code" style={{ marginTop: 10 }}>{sql || 'Loading…'}</pre>}
          </div>

          {result && (
            <div className="card" style={{ borderColor: 'var(--green)' }}>
              <h2>✅ COMMITTED</h2>
              <div className="verdict good">
                <div>Request <code>{result.request.id}</code> → <b>{result.request.status}</b></div>
                <div>New edge <code>{result.mentorship.id}</code>: {result.mentor} <b>→ mentors →</b> {result.mentee}</div>
                <div className="sub">Both changes were committed together.</div>
              </div>
            </div>)}

          <div className="card">
            <h2>Prove the rollback</h2>
            <p className="hint">Runs the same transaction, but forces a failure after both writes and before COMMIT. Then it compares the database before and after.</p>
            {allPending.length === 0 ? <div className="empty">Needs a pending request addressed to you.</div> : (
              <>
                <Field label="Pick one of your pending incoming requests">
                  <select value={demoTarget} onChange={(e) => setPickDemo(e.target.value)} disabled={pendingIn.length === 0}>
                    {pendingIn.length === 0 && <option value="">No pending request addressed to you</option>}
                    {pendingIn.map((r) => <option key={r.id} value={r.id}>{r.mentee.name} wants {r.expertise}</option>)}
                  </select>
                </Field>
                <button className="btn" disabled={!demoTarget || !!busy} onClick={rollback}>💥 Run failing transaction</button>
              </>)}
            {demo && (
              <div style={{ marginTop: 14 }}>
                <div className="flow">{demo.steps.map((s, i) => (
                  <div key={i} className={`step ${i === 4 ? 'fail' : i === 5 ? 'ok' : i >= 2 && i <= 3 ? 'write' : ''}`}><div className="n">{i + 1}</div><div>{s}</div></div>))}
                </div>
                <div className="compare">
                  <div className="box"><b>BEFORE</b><br />request: {demo.before.request_status}<br />mentorship edges: {demo.before.mentorship_edges}<br />activity nodes: {demo.before.activity_nodes}</div>
                  <div className="box"><b>AFTER the failure</b><br />request: {demo.after.request_status}<br />mentorship edges: {demo.after.mentorship_edges}<br />activity nodes: {demo.after.activity_nodes}</div>
                </div>
                <div className="verdict good">{demo.rolledBack ? '✔ Rolled back: the graph is exactly as it was. The request is still pending.' : 'Unexpected: state changed'}</div>
                <div className="sub" style={{ marginTop: 6 }}>Error raised: {demo.error?.code}: {demo.error?.message}</div>
              </div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
