import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useLiveData } from '../store.jsx';
import { ErrorBox, Loading, ago, fmtDate } from '../components.jsx';
import { kindIcon } from './Dashboard.jsx';

const FILTERS = [['', 'Everything'], ['student', 'Students'], ['friendship', 'Friendships'], ['mentorship', 'Mentorship'], ['collaboration', 'Collaborations']];

export default function Activity() {
  const [filter, setFilter] = useState('');
  const { data, error } = useLiveData(() => api.activity(60), ['activity']);
  const [fresh, setFresh] = useState(new Set());
  const prev = useRef(null);

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.map((a) => a.id));
    if (prev.current) {
      const f = [...ids].filter((i) => !prev.current.has(i));
      if (f.length) { setFresh(new Set(f)); setTimeout(() => setFresh(new Set()), 2500); }
    }
    prev.current = ids;
  }, [data]);

  const rows = (data ?? []).filter((a) => !filter || a.kind.startsWith(filter));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Activity</h1><p>Each event is a node in the graph, linked to the students it involves. New events appear here live.</p></div></div>
      <div className="tabs">{FILTERS.map(([k, label]) => <button key={k} className={`tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>)}</div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : rows.length === 0 ? <div className="empty">Nothing here yet.</div> : (
        <div className="card"><div className="list timeline">
          {rows.map((a) => (
            <div className={`item ${fresh.has(a.id) ? 'flash' : ''}`} key={a.id}>
              <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <div className="kind">{kindIcon(a.kind)}</div>
                <div>
                  <div>{a.message}</div>
                  <div className="sub" title={fmtDate(a.created_at)}>{ago(a.created_at)} · {a.kind.replace(/_/g, ' ')}</div>
                  <div style={{ marginTop: 4 }}>{(a.people ?? []).map((p) => <Link key={p.id} to={`/students/${p.id}`} className="chip">{p.name}</Link>)}</div>
                </div>
              </div>
            </div>))}
        </div></div>)}
    </div>
  );
}
