import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useLiveData, useApp } from '../store.jsx';
import { Avatar, Chips, ErrorBox, Field, Loading, Modal, DEPARTMENTS } from '../components.jsx';

function StudentForm({ initial, onClose, onSaved }) {
  const editing = !!initial;
  const [f, setF] = useState({
    name: initial?.name ?? '', email: initial?.email ?? '', department: initial?.department ?? 'CSE', year: initial?.year ?? 1,
    skills: (initial?.skills ?? []).join(', '), interests: (initial?.interests ?? []).join(', '), bio: initial?.bio ?? '', avatar: initial?.avatar ?? '',
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const body = { ...f, year: Number(f.year) };
      if (!body.avatar) delete body.avatar;
      const saved = editing ? await api.updateStudent(initial.id, body) : await api.createStudent(body);
      onSaved(saved);
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? `Edit ${initial.name}` : 'Add a student (new graph node)'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <div className="two-col">
          <Field label="Full name"><input value={f.name} onChange={set('name')} required minLength={2} maxLength={60} autoFocus /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={set('email')} required disabled={editing} /></Field>
          <Field label="Department">
            <select value={f.department} onChange={set('department')}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select>
          </Field>
          <Field label="Academic year">
            <select value={f.year} onChange={set('year')}>{[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}</select>
          </Field>
        </div>
        <Field label="Skills" hint="Comma separated, e.g. Python, React, Embedded Systems"><input value={f.skills} onChange={set('skills')} /></Field>
        <Field label="Interests" hint="Comma separated, e.g. AI, Robotics"><input value={f.interests} onChange={set('interests')} /></Field>
        <Field label="Short bio"><textarea value={f.bio} onChange={set('bio')} maxLength={400} /></Field>
        <Field label="Avatar URL (optional)"><input value={f.avatar} onChange={set('avatar')} placeholder="https://…" /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create student'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Directory() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { me, toast, loadStudents } = useApp();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [year, setYear] = useState('');
  const [form, setForm] = useState(null); // null | 'new' | student

  useEffect(() => { if (params.get('new')) { setForm('new'); setParams({}, { replace: true }); } }, [params, setParams]);

  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 220); return () => clearTimeout(t); }, [q]);

  const list = useLiveData(() => api.students({ q: debounced, dept, year }), ['student', 'friends_with', 'mentors', 'collaborates_with'], [debounced, dept, year]);
  const students = list.data ?? [];

  const remove = async (s) => {
    if (!me) return toast('Choose a demo identity first (top bar).', 'error');
    if (!window.confirm(`Delete ${s.name}? Their ${s.friend_count + s.mentorship_count + s.collab_count} connection(s) and requests will be removed too.`)) return;
    try {
      const r = await api.deleteStudent(s.id);
      const e = r.edges_removed;
      toast(`${s.name} removed with ${e.friendships + e.requests + e.mentorships + e.collaborations} edge(s), in one transaction`, 'success');
      loadStudents(); list.refresh();
    } catch (x) { toast(x.message, 'error'); }
  };

  const saved = (s) => { setForm(null); toast(`Saved ${s.name}`, 'success'); loadStudents(); list.refresh(); };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Students</h1><p>Each student is a node in the graph. Search by name, department, skill or interest.</p></div>
        <button className="btn primary" onClick={() => setForm('new')}>＋ Add student</button>
      </div>

      <div className="toolbar">
        <input placeholder="Search name, department, skills, interests…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select>
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year"><option value="">All years</option>{[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}</select>
        <span className="hint" style={{ alignSelf: 'center' }}>{students.length} found</span>
      </div>

      <ErrorBox error={list.error} />
      {!list.data ? <Loading /> : students.length === 0 ? <div className="empty">No students match.</div> : (
        <div className="grid cols-3">
          {students.map((s) => (
            <div key={s.id} className="card hover" onClick={() => nav(`/students/${s.id}`)} role="link" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && nav(`/students/${s.id}`)}>
              <div className="person" style={{ marginBottom: 10 }}>
                <Avatar s={s} />
                <div className="meta"><div className="nm">{s.name}</div><div className="sub">{s.department} · Year {s.year}</div></div>
              </div>
              <Chips items={s.skills.slice(0, 4)} />
              <Chips items={s.interests.slice(0, 3)} alt />
              <div className="sub" style={{ margin: '4px 0 10px' }}>{s.friend_count} friends · {s.mentorship_count} mentorships · {s.collab_count} collabs</div>
              <div className="row" onClick={(e) => e.stopPropagation()}>
                <Link className="btn sm" to={`/students/${s.id}`}>Profile</Link>
                <button className="btn sm" onClick={() => setForm(s)}>Edit</button>
                <button className="btn sm danger" onClick={() => remove(s)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {form && <StudentForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={saved} />}
    </div>
  );
}
