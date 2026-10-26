import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useLiveData, useApp } from '../store.jsx';
import { ErrorBox, Loading, ago } from '../components.jsx';

const ICON = {
  student_added: '🎓', student_removed: '👋', friendship_created: '🤝', friendship_removed: '💔',
  mentorship_requested: '✉️', mentorship_accepted: '✅', mentorship_rejected: '🚫', mentorship_cancelled: '↩️',
  mentorship_ended: '🏁', collaboration_added: '🧪', collaboration_ended: '📦', collaboration_completed: '🎉',
};
export const kindIcon = (k) => ICON[k] || '•';

const TABLES = ['student', 'friends_with', 'mentors', 'mentorship_request', 'collaborates_with', 'activity'];

export default function Dashboard() {
  const nav = useNavigate();
  const { me, toast, loadStudents } = useApp();
  const stats = useLiveData(() => api.stats(), TABLES);
  const act = useLiveData(() => api.activity(8), ['activity']);

  const s = stats.data;
  const cards = s && [
    ['Students', s.students, '#8b5cf6'],
    ['Friendships', s.friendships, '#a78bfa'],
    ['Active mentorships', s.mentorships, '#34d399'],
    ['Pending requests', s.pendingRequests, '#fbbf24'],
    ['Collaborations', s.collaborations, '#22d3ee'],
  ];
  const max = Math.max(1, ...(s?.byDepartment ?? []).map((d) => d.students));

  const reset = async () => {
    if (!window.confirm('Reset the whole demo graph to its starting data? All changes will be lost.')) return;
    try { await api.reseed(); await loadStudents(); toast('Demo data restored', 'success'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Campus network at a glance</h1>
          <p>Every number below is counted live from SurrealDB nodes and edges.</p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => nav('/students?new=1')}>＋ Add student</button>
          <button className="btn" onClick={() => nav('/graph')}>🕸️ Explore connections</button>
          <button className="btn" onClick={() => nav('/mentorship')}>🤝 Mentorship Center</button>
        </div>
      </div>

      <ErrorBox error={stats.error} />
      {!s ? <Loading /> : (
        <div className="grid cols-5">
          {cards.map(([label, value, glow]) => (
            <div className="card stat" key={label} style={{ '--glow': glow }}>
              <div className="num">{value}</div><div className="lbl">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="spacer" />
      <div className="grid two">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Recent network activity</h2><Link to="/activity">See all →</Link>
          </div>
          {!act.data ? <Loading /> : act.data.length === 0 ? <div className="empty">No activity yet.</div> : (
            <div className="list timeline">
              {act.data.map((a) => (
                <div className="item" key={a.id}>
                  <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <div className="kind">{kindIcon(a.kind)}</div>
                    <div>{a.message}<div className="sub">{ago(a.created_at)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h2>Students by department</h2>
          {(s?.byDepartment ?? []).map((d) => (
            <div key={d.department} style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>{d.department}</span><b>{d.students}</b></div>
              <div className="bar"><i style={{ width: `${(d.students / max) * 100}%` }} /></div>
            </div>
          ))}
          <div className="spacer" />
          <p className="hint">Acting as: <b>{me ? me.split(':')[1] : 'nobody yet'}</b>. Pick a student in the top bar to send requests and make changes.</p>
          <button className="btn sm danger" onClick={reset}>Reset demo data</button>
        </div>
      </div>
    </div>
  );
}
