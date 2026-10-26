import { useEffect } from 'react';
import { Link } from 'react-router-dom';

// Avatars are generated locally (initials on a coloured tile), so the demo works offline.
const PALETTE = ['#8b5cf6', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#f472b6', '#a3e635'];
export const avatarUrl = (s) => {
  if (s?.avatar && /^https?:\/\//i.test(s.avatar) && !/dicebear/i.test(s.avatar)) return s.avatar;
  const name = s?.name || '?';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = PALETTE[h % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#1a2347"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-weight="700" font-size="40" fill="#fff">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export function Avatar({ s, size = '' }) {
  return <img className={`avatar ${size}`} src={avatarUrl(s)} alt="" loading="lazy" />;
}

export function Person({ s, extra, to = true }) {
  const body = (
    <div className="person">
      <Avatar s={s} size="sm" />
      <div className="meta">
        <div className="nm">{s.name}</div>
        <div className="sub">{s.department} · Year {s.year}{extra ? ` · ${extra}` : ''}</div>
      </div>
    </div>
  );
  return to ? <Link to={`/students/${s.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link> : body;
}

export const Chips = ({ items = [], alt }) => (
  <div>{items.map((x) => <span key={x} className={`chip ${alt ? 'alt' : ''}`}>{x}</span>)}</div>
);

export const Badge = ({ children, kind }) => <span className={`badge ${kind ?? String(children).toLowerCase()}`}>{children}</span>;

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(760px,100%)' } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="field"><span>{label}</span>{children}{hint && <div className="hint">{hint}</div>}</label>
);

export const ErrorBox = ({ error }) => (error ? <div className="err">{error.message || String(error)}</div> : null);
export const Loading = () => <div className="empty">Loading from SurrealDB…</div>;

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export function ago(iso) {
  if (!iso) return '';
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const DEPARTMENTS = ['CSE', 'ECE', 'EEE', 'IT', 'MECH', 'CIVIL'];
