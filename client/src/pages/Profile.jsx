import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useLiveData, useApp } from '../store.jsx';
import { Avatar, Badge, Chips, ErrorBox, Field, Loading, Modal, Person, ago } from '../components.jsx';

const COLLAB_TYPES = ['project', 'research', 'hackathon', 'study_group'];

function RequestModal({ target, onClose, onDone }) {
  const { toast } = useApp();
  const [expertise, setExpertise] = useState(target.skills?.[0] ?? '');
  const [message, setMessage] = useState('');
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.requestMentorship({ mentorId: target.id, expertise, message });
      toast(`Request sent to ${target.name}`, 'success'); onDone();
    } catch (x) { setErr(x); }
  };
  return (
    <Modal title={`Ask ${target.name} to mentor you`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <Field label="What do you want help with?" hint={`Their skills: ${target.skills?.join(', ')}`}><input value={expertise} onChange={(e) => setExpertise(e.target.value)} required minLength={2} maxLength={60} /></Field>
        <Field label="Message (optional)"><textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} /></Field>
        <p className="hint">This creates a <b>mentorship_request</b> edge with status “pending”. Nothing becomes a mentorship until the mentor accepts.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Send request</button></div>
      </form>
    </Modal>
  );
}

function CollabModal({ target, onClose, onDone }) {
  const { toast } = useApp();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('project');
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try { await api.addCollab(target.id, title, type); toast('Collaboration added', 'success'); onDone(); } catch (x) { setErr(x); }
  };
  return (
    <Modal title={`Collaborate with ${target.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <Field label="Project title"><input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={80} autoFocus /></Field>
        <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value)}>{COLLAB_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Add collaboration</button></div>
      </form>
    </Modal>
  );
}

export default function Profile() {
  const { id: raw } = useParams();
  const id = raw.includes(':') ? raw : `student:${raw}`;
  const { me, toast } = useApp();
  const { data: p, error, refresh } = useLiveData(() => api.student(id), ['student', 'friends_with', 'mentors', 'mentorship_request', 'collaborates_with'], [id]);
  const [modal, setModal] = useState(null);

  const act = (fn, okMsg) => async (...a) => {
    try { await fn(...a); if (okMsg) toast(okMsg, 'success'); refresh(); } catch (e) { toast(e.message, 'error'); }
  };

  if (error && !p) return <div className="page"><ErrorBox error={error} /><Link to="/students">← Back to students</Link></div>;
  if (!p) return <div className="page"><Loading /></div>;

  const s = p.student;
  const isMe = me === s.id;
  const iAmFriend = p.friends.some((f) => f.student.id === me);
  const myYear = null; // resolved server-side; button shown when plausible
  const activeMentorWithMe = p.mentees.some((m) => m.student.id === me && m.status === 'active');
  const pendingFromMe = p.incomingRequests.some((r) => r.student.id === me && r.status === 'pending');
  const senior = (s.year ?? 0) >= 2;

  return (
    <div className="page">
      <p><Link to="/students">← Students</Link></p>
      <div className="card">
        <div className="hero">
          <Avatar s={s} size="lg" />
          <div className="grow">
            <h1>{s.name}</h1>
            <div className="kv"><span>Department</span><b>{s.department}</b><span>Year</span><b>Year {s.year}</b><span>Email</span><b>{s.email}</b></div>
            {s.bio && <p style={{ marginTop: 10 }}>{s.bio}</p>}
            <Chips items={s.skills} /><Chips items={s.interests} alt />
          </div>
          <div className="list" style={{ minWidth: 220 }}>
            {!isMe && me && !iAmFriend && <button className="btn primary" onClick={act(() => api.addFriend(s.id), `You and ${s.name} are now friends`)}>＋ Add friend</button>}
            {!isMe && me && senior && !activeMentorWithMe && !pendingFromMe && <button className="btn" onClick={() => setModal('request')}>🤝 Request mentorship</button>}
            {!isMe && me && <button className="btn" onClick={() => setModal('collab')}>🧪 Add collaboration</button>}
            <Link className="btn" to={`/graph?focus=${s.id}`}>🕸️ Show in graph</Link>
            {!me && <span className="hint">Choose “Acting as” in the top bar to make connections.</span>}
          </div>
        </div>
      </div>

      <div className="spacer" />
      <div className="grid two">
        <div className="list">
          <div className="card">
            <h2>Friends ({p.friends.length})</h2>
            {p.friends.length === 0 ? <div className="empty">No friends yet.</div> : (
              <div className="list">{p.friends.map((f) => (
                <div className="item" key={f.edge}>
                  <Person s={f.student} extra={f.level === 'close' ? '★ close friend' : ''} />
                  {(isMe || f.student.id === me) && (
                    <div className="row">
                      <button className="btn sm" onClick={act(() => api.updateFriendship(f.edge, f.level === 'close' ? 'friend' : 'close'))}>{f.level === 'close' ? 'Make regular' : '★ Close'}</button>
                      <button className="btn sm danger" onClick={act(() => api.removeFriendship(f.edge), 'Friendship removed')}>Remove</button>
                    </div>
                  )}
                </div>))}
              </div>)}
          </div>

          <div className="card">
            <h2>Collaborators ({p.collaborators.length})</h2>
            {p.collaborators.length === 0 ? <div className="empty">No collaborations yet.</div> : (
              <div className="list">{p.collaborators.map((c) => (
                <div className="item" key={c.edge}>
                  <div><Person s={c.student} extra={`“${c.project}”`} /><div className="sub" style={{ marginLeft: 44 }}>{c.type.replace('_', ' ')} · <Badge>{c.status}</Badge></div></div>
                  {(isMe || c.student.id === me) && c.status === 'active' && (
                    <button className="btn sm" onClick={act(() => api.updateCollab(c.edge, { status: 'ended' }), 'Collaboration ended')}>End</button>
                  )}
                </div>))}
              </div>)}
          </div>
        </div>

        <div className="list">
          <div className="card">
            <h2>Mentors</h2>
            {p.mentors.length === 0 ? <div className="empty">No mentors yet.</div> : (
              <div className="list">{p.mentors.map((m) => (
                <div className="item" key={m.edge}><div><Person s={m.student} extra={m.expertise} /><div className="sub" style={{ marginLeft: 44 }}><Badge>{m.status}</Badge></div></div>
                  {m.status === 'active' && (isMe || m.student.id === me) && <button className="btn sm danger" onClick={act(() => api.endMentorship(m.edge), 'Mentorship ended')}>End</button>}
                </div>))}
              </div>)}
            <h2 style={{ marginTop: 18 }}>Mentees</h2>
            {p.mentees.length === 0 ? <div className="empty">Not mentoring anyone yet.</div> : (
              <div className="list">{p.mentees.map((m) => (
                <div className="item" key={m.edge}><div><Person s={m.student} extra={m.expertise} /><div className="sub" style={{ marginLeft: 44 }}><Badge>{m.status}</Badge></div></div>
                  {m.status === 'active' && (isMe || m.student.id === me) && <button className="btn sm danger" onClick={act(() => api.endMentorship(m.edge), 'Mentorship ended')}>End</button>}
                </div>))}
              </div>)}
          </div>

          <div className="card">
            <h2>Mentorship requests</h2>
            <div className="sub" style={{ marginBottom: 8 }}>Incoming (asking {s.name.split(' ')[0]} to mentor)</div>
            {p.incomingRequests.length === 0 ? <div className="empty">None.</div> : (
              <div className="list">{p.incomingRequests.slice(0, 6).map((r) => (
                <div className="item" key={r.edge}><div><Person s={r.student} extra={r.expertise} /><div className="sub" style={{ marginLeft: 44 }}><Badge>{r.status}</Badge> {ago(r.createdAt)}</div></div>
                  {isMe && r.status === 'pending' && <div className="row">
                    <button className="btn sm success" onClick={act(() => api.accept(r.edge), 'Accepted: mentorship edge created')}>Accept</button>
                    <button className="btn sm danger" onClick={act(() => api.reject(r.edge), 'Request declined')}>Reject</button></div>}
                </div>))}
              </div>)}
            <div className="sub" style={{ margin: '14px 0 8px' }}>Outgoing (asked by {s.name.split(' ')[0]})</div>
            {p.outgoingRequests.length === 0 ? <div className="empty">None.</div> : (
              <div className="list">{p.outgoingRequests.slice(0, 6).map((r) => (
                <div className="item" key={r.edge}><div><Person s={r.student} extra={r.expertise} /><div className="sub" style={{ marginLeft: 44 }}><Badge>{r.status}</Badge> {ago(r.createdAt)}</div></div>
                  {isMe && r.status === 'pending' && <button className="btn sm" onClick={act(() => api.cancel(r.edge), 'Request withdrawn')}>Cancel</button>}
                </div>))}
              </div>)}
          </div>
        </div>
      </div>

      {modal === 'request' && <RequestModal target={s} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'collab' && <CollabModal target={s} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </div>
  );
}
