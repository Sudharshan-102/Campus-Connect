import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useApp } from './store.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Directory from './pages/Directory.jsx';
import Profile from './pages/Profile.jsx';
import GraphExplorer from './pages/GraphExplorer.jsx';
import Mentorship from './pages/Mentorship.jsx';
import Activity from './pages/Activity.jsx';
import QueryLab from './pages/QueryLab.jsx';

const NAV = [
  ['/', '🏠', 'Dashboard'],
  ['/students', '🎓', 'Students'],
  ['/graph', '🕸️', 'Graph Explorer'],
  ['/mentorship', '🤝', 'Mentorship Center'],
  ['/activity', '⚡', 'Activity'],
  ['/queries', '🧮', 'Query Lab'],
];

export default function App() {
  const { me, chooseMe, students, live, toasts } = useApp();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" />
              <path d="M8 8l8-1M7.5 9l3.5 7M16.5 8l-3.5 8" />
            </svg>
          </div>
          Campus Connect
        </div>
        <nav className="nav">
          {NAV.map(([to, ico, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ico">{ico}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">Graph database demo · SurrealDB<br />Nodes: students · Edges: friends, mentors, collaborations</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="who">
            <label htmlFor="actas">Acting as</label>
            <select id="actas" value={me} onChange={(e) => chooseMe(e.target.value)} title="Demo identity (this browser tab only)">
              <option value="">— choose a student —</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.department} Y{s.year}</option>)}
            </select>
            <span className="hint">demo identity, per tab</span>
          </div>
          <span className={`live-pill ${live}`} title="Live updates come from SurrealDB LIVE SELECT">
            <span className="dot" />{live === 'live' ? 'Live' : live === 'offline' ? 'Reconnecting…' : 'Connecting…'}
          </span>
        </header>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/students" element={<Directory />} />
          <Route path="/students/:id" element={<Profile />} />
          <Route path="/graph" element={<GraphExplorer />} />
          <Route path="/mentorship" element={<Mentorship />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/queries" element={<QueryLab />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}
      </div>
    </div>
  );
}
