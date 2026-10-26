// Integration tests: real SurrealDB engine (embedded), real Express app, real HTTP.
//   npm test
process.env.SURREAL_URL = 'mem://';
process.env.SURREAL_NS = 'test';
process.env.SURREAL_DB = 'campus';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { connectDb, closeDb, run } = await import('../src/db.js');
const { seedDemoData } = await import('../src/seed.js');
const { startLive, stopLive, hub } = await import('../src/live.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

before(async () => {
  await connectDb();
  await seedDemoData();
  await startLive();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await stopLive();
  await closeDb();
});

async function api(method, path, { as, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { 'X-Demo-User': as } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, ...json };
}
const pendingId = async (mentee, mentor) =>
  (await api('GET', `/mentorship-requests?status=pending&mentee=${mentee}&mentor=${mentor}`)).data[0]?.id;
const count = async (table, where = '') => (await run(`RETURN array::len((SELECT id FROM ${table} ${where}));`))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ student CRUD ------------------------------ */
test('students: create, read, search, update, delete', async () => {
  const bad = await api('POST', '/students', { body: { name: 'X', email: 'nope', department: 'ZZ', year: 9 } });
  assert.equal(bad.status, 400);

  const created = await api('POST', '/students', {
    body: { name: 'Zoya Khan', email: 'Zoya@campus.edu', department: 'CSE', year: 2, skills: 'Rust, Go', interests: ['AI'] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 'student:zoya_khan');
  assert.equal(created.data.email, 'zoya@campus.edu'); // normalised by the schema

  const dup = await api('POST', '/students', { body: { name: 'Zoya Two', email: 'zoya@campus.edu', department: 'CSE', year: 2 } });
  assert.equal(dup.status, 409);

  const found = await api('GET', '/students?q=rust');
  assert.deepEqual(found.data.map((s) => s.id), ['student:zoya_khan']);

  const upd = await api('PUT', '/students/student:zoya_khan', { as: 'student:arun', body: { bio: 'Hello there', year: 3 } });
  assert.equal(upd.data.bio, 'Hello there');
  assert.equal(upd.data.year, 3);

  const profile = await api('GET', '/students/student:zoya_khan');
  assert.equal(profile.data.student.name, 'Zoya Khan');

  assert.equal((await api('GET', '/students/student:nobody')).status, 404);
  assert.equal((await api('GET', '/students/student:bad%20id')).status, 400);

  // destructive action needs identity AND confirmation
  assert.equal((await api('DELETE', '/students/student:zoya_khan')).status, 401);
  assert.equal((await api('DELETE', '/students/student:zoya_khan', { as: 'student:arun' })).status, 400);
  const del = await api('DELETE', '/students/student:zoya_khan', { as: 'student:arun', headers: { 'X-Confirm': 'DELETE' } });
  assert.equal(del.status, 200);
  assert.equal((await api('GET', '/students/student:zoya_khan')).status, 404);
});

test('deleting a student removes every edge in one transaction (no orphans)', async () => {
  const before = await count('friends_with');
  const r = await api('DELETE', '/students/student:priya', { as: 'student:arun', headers: { 'X-Confirm': 'DELETE' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.edges_removed.friendships >= 3);
  assert.ok((await count('friends_with')) < before);
  for (const t of ['friends_with', 'mentors', 'collaborates_with', 'mentorship_request']) {
    assert.equal(await count(t, 'WHERE in = student:priya OR out = student:priya'), 0, `${t} still points at the deleted student`);
  }
  assert.equal(await count('involves', 'WHERE out = student:priya'), 0);
});

/* ------------------------------ friendships ------------------------------ */
test('friendships: mutual, no duplicates in either direction, no self-friendship', async () => {
  const a = await api('POST', '/friendships', { as: 'student:neha', body: { friendId: 'student:rahul' } });
  assert.equal(a.status, 201);
  // same pair, opposite direction -> still a duplicate
  const b = await api('POST', '/friendships', { as: 'student:rahul', body: { friendId: 'student:neha' } });
  assert.equal(b.status, 409);
  assert.equal((await api('POST', '/friendships', { as: 'student:neha', body: { friendId: 'student:neha' } })).status, 400);
  assert.equal((await api('POST', '/friendships', { as: 'student:neha', body: { friendId: 'student:ghost' } })).status, 404);

  const u = await api('PUT', `/friendships/${a.data.id}`, { as: 'student:rahul', body: { level: 'close' } });
  assert.equal(u.data.level, 'close');
  assert.equal((await api('PUT', `/friendships/${a.data.id}`, { as: 'student:arun', body: { level: 'friend' } })).status, 403);

  assert.equal((await api('DELETE', `/friendships/${a.data.id}`, { as: 'student:arun' })).status, 403);
  assert.equal((await api('DELETE', `/friendships/${a.data.id}`, { as: 'student:neha' })).status, 200);
});

/* ------------------------------ collaborations ---------------------------- */
test('collaborations: create, update, end, delete', async () => {
  const c = await api('POST', '/collaborations', { as: 'student:isha', body: { partnerId: 'student:sneha', projectTitle: 'Air Quality Logger', type: 'project' } });
  assert.equal(c.status, 201);
  assert.equal((await api('POST', '/collaborations', { as: 'student:sneha', body: { partnerId: 'student:isha', projectTitle: 'Air Quality Logger' } })).status, 409);
  const u = await api('PUT', `/collaborations/${c.data.id}`, { as: 'student:sneha', body: { status: 'ended' } });
  assert.equal(u.data.status, 'ended');
  assert.ok(u.data.ended_at);
  assert.equal((await api('PUT', `/collaborations/${c.data.id}`, { as: 'student:arun', body: { status: 'active' } })).status, 403);
  assert.equal((await api('DELETE', `/collaborations/${c.data.id}`, { as: 'student:isha' })).status, 200);
});

/* ------------------------------ mentorship -------------------------------- */
test('mentorship request rules', async () => {
  const mk = (as, mentorId) => api('POST', '/mentorship-requests', { as, body: { mentorId, expertise: 'Testing' } });
  assert.equal((await mk('student:arun', 'student:arun')).status, 400); // self
  assert.equal((await mk('student:meera', 'student:rahul')).status, 422); // mentor must be senior
  assert.equal((await mk('student:rahul', 'student:meera')).status, 409); // already mentoring
  assert.equal((await mk('student:arun', 'student:meera')).status, 409); // already pending (seed)
  assert.equal((await api('POST', '/mentorship-requests', { body: { mentorId: 'student:meera', expertise: 'x' } })).status, 401);
});

test('ATOMIC ACCEPT: request updated AND mentorship edge created together', async () => {
  const rid = await pendingId('student:isha', 'student:meera');
  assert.ok(rid);
  const mentorsBefore = await count('mentors');

  assert.equal((await api('POST', `/mentorship-requests/${rid}/accept`, { as: 'student:karthik' })).status, 403); // not the mentor
  assert.equal(await count('mentors'), mentorsBefore);

  const ok = await api('POST', `/mentorship-requests/${rid}/accept`, { as: 'student:meera' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.request.status, 'accepted');
  assert.equal(ok.data.mentorship.in, 'student:meera');
  assert.equal(ok.data.mentorship.out, 'student:isha');
  assert.equal(await count('mentors'), mentorsBefore + 1);

  // processed requests cannot be accepted or rejected again
  assert.equal((await api('POST', `/mentorship-requests/${rid}/accept`, { as: 'student:meera' })).status, 409);
  assert.equal((await api('POST', `/mentorship-requests/${rid}/reject`, { as: 'student:meera' })).status, 409);
  assert.equal((await api('POST', '/mentorship-requests/mentorship_request:missing/accept', { as: 'student:meera' })).status, 404);
});

test('ROLLBACK: a failure after both writes leaves the graph exactly as it was', async () => {
  const rid = await pendingId('student:neha', 'student:vikram');
  assert.ok(rid);
  const res = await api('POST', `/mentorship-requests/${rid}/rollback-demo`, { as: 'student:vikram' });
  assert.equal(res.status, 200);
  assert.equal(res.data.rolledBack, true);
  assert.equal(res.data.error.code, 'E_SIMULATED');
  assert.deepEqual(res.data.before, res.data.after);
  assert.equal(res.data.after.request_status, 'pending'); // NOT 'accepted'
  // and the request is still perfectly acceptable afterwards
  assert.equal((await api('POST', `/mentorship-requests/${rid}/accept`, { as: 'student:vikram' })).status, 200);
});

test('database itself blocks duplicate active mentorships and bad status moves', async () => {
  // (we bypass the API on purpose: the DATABASE must refuse by itself)
  await assert.rejects(run(`RELATE student:meera->mentors->student:rahul SET expertise = 'again';`), { code: 'E_DUPLICATE' });
  const r = await api('POST', '/mentorship-requests', { as: 'student:sneha', body: { mentorId: 'student:karthik', expertise: 'Linux' } });
  await api('POST', `/mentorship-requests/${r.data.id}/reject`, { as: 'student:karthik' });
  await assert.rejects(run(`UPDATE type::record('mentorship_request', $k) SET status = 'accepted';`, { k: r.data.id.split(':')[1] }), { code: 'E_VALIDATION' });
});

test('simultaneous accepts create exactly one mentorship', async () => {
  const r = await api('POST', '/mentorship-requests', { as: 'student:sanjay', body: { mentorId: 'student:vikram', expertise: 'Cloud' } });
  const results = await Promise.all([1, 2, 3, 4].map(() => api('POST', `/mentorship-requests/${r.data.id}/accept`, { as: 'student:vikram' })));
  assert.equal(results.filter((x) => x.status === 200).length, 1);
  assert.equal(await count('mentors', "WHERE in = student:vikram AND out = student:sanjay AND status = 'active'"), 1);
});

test('cancel a pending request; end and delete a mentorship', async () => {
  const r = await api('POST', '/mentorship-requests', { as: 'student:sneha', body: { mentorId: 'student:vikram', expertise: 'DevOps' } });
  assert.equal((await api('DELETE', `/mentorship-requests/${r.data.id}`, { as: 'student:vikram' })).status, 403);
  assert.equal((await api('DELETE', `/mentorship-requests/${r.data.id}`, { as: 'student:sneha' })).status, 200);

  const ms = (await api('GET', '/mentorships?status=active')).data.find((m) => m.mentor.id === 'student:aditya' && m.mentee.id === 'student:sanjay');
  assert.equal((await api('DELETE', `/mentorships/${ms.id}`, { as: 'student:aditya' })).status, 422); // must end first
  const ended = await api('PUT', `/mentorships/${ms.id}/end`, { as: 'student:aditya' });
  assert.equal(ended.data.status, 'ended');
  assert.equal((await api('DELETE', `/mentorships/${ms.id}`, { as: 'student:sanjay' })).status, 200);
});

/* ------------------------------ graph queries ----------------------------- */
test('all ten Query Lab queries run and return sensible rows', async () => {
  const list = (await api('GET', '/queries')).data;
  assert.equal(list.length, 10);
  const params = 'student=student:arun&other=student:ananya&interest=ai&depth=2';
  for (const q of list) {
    const p = q.id === 'pending-requests' ? 'student=student:meera' : params;
    const r = await api('GET', `/queries/${q.id}?${p}`);
    assert.equal(r.status, 200, `${q.id}: ${JSON.stringify(r.error)}`);
    assert.ok(Array.isArray(r.data.rows), q.id);
    assert.ok(r.data.surql.length > 20);
  }
  const hop = (await api('GET', '/queries/network-depth?student=student:rahul&depth=3')).data.rows;
  assert.ok(hop.some((x) => x.reach === 'direct') && hop.some((x) => x.reach === 'multi-hop'));
  assert.equal((await api('GET', '/queries/network-depth?student=student:rahul&depth=99')).status, 400);
  assert.equal((await api('GET', '/queries/two-hops')).status, 400);
});

test('graph + network endpoints', async () => {
  const g = (await api('GET', '/graph')).data;
  assert.ok(g.nodes.length >= 10);
  assert.ok(['friendship', 'mentorship', 'collaboration', 'request'].every((t) => g.edges.some((e) => e.type === t)));
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.ok(g.edges.every((e) => ids.has(e.source) && ids.has(e.target)), 'edge with a missing endpoint');

  const n1 = (await api('GET', '/students/student:arun/network?depth=1')).data;
  const n3 = (await api('GET', '/students/student:arun/network?depth=3')).data;
  assert.ok(n3.nodes.length > n1.nodes.length);
  assert.equal(n1.nodes.find((n) => n.id === 'student:arun').hops, 0);
});

test('dashboard stats and activity come from real records', async () => {
  const s = (await api('GET', '/dashboard/stats')).data;
  assert.equal(s.friendships, await count('friends_with'));
  assert.equal(s.students, await count('student'));
  const act = (await api('GET', '/activity?limit=5')).data;
  assert.ok(act.length > 0 && act[0].message);
  assert.ok(Array.isArray(act[0].people));
});

/* -------------------------------- real time ------------------------------- */
test('LIVE SELECT: database changes reach SSE subscribers; failed attempts emit nothing', async () => {
  const events = [];
  const fakeRes = {
    write: (chunk) => { const m = /data: (\{.*"table".*\})/.exec(chunk); if (m) events.push(JSON.parse(m[1])); },
    writeHead() {}, end() {},
  };
  const fakeReq = { get: () => undefined, query: {}, on() {} };
  hub.addClient(fakeReq, fakeRes);

  const r = await api('POST', '/mentorship-requests', { as: 'student:rahul', body: { mentorId: 'student:vikram', expertise: 'Live demo' } });
  assert.equal(r.status, 201);
  await sleep(300);
  assert.ok(events.some((e) => e.table === 'mentorship_request' && e.action === 'CREATE' && e.value.status === 'pending'));

  const mark = events.length;
  await api('POST', `/mentorship-requests/${r.data.id}/accept`, { as: 'student:aditya' }); // forbidden -> nothing may change
  await sleep(300);
  assert.equal(events.length, mark, 'a rejected action must not produce live events');

  await api('POST', `/mentorship-requests/${r.data.id}/accept`, { as: 'student:vikram' });
  await sleep(300);
  const after = events.slice(mark);
  assert.ok(after.some((e) => e.table === 'mentorship_request' && e.action === 'UPDATE' && e.value.status === 'accepted'));
  assert.ok(after.some((e) => e.table === 'mentors' && e.action === 'CREATE'));
  const seqs = events.map((e) => e.seq);
  assert.equal(new Set(seqs).size, seqs.length, 'duplicate event sequence numbers');
});

test('admin reseed needs explicit confirmation and restores the demo data', async () => {
  assert.equal((await api('POST', '/admin/reseed')).status, 400);
  const r = await api('POST', '/admin/reseed', { headers: { 'X-Confirm': 'RESET' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.students, 14);
  assert.equal(r.data.pending, 4);
});
