// Graph reads: the whole graph for the explorer, multi-hop networks, and the
// "Query Lab" (the ten graph questions from the case study, with the exact SurrealQL).
import { run, runLast } from '../db.js';
import { badRequest } from '../errors.js';
import { toRid, ridStr } from '../util.js';

const EDGE_TABLES = ['friends_with', 'mentors', 'collaborates_with'];

/* -------------------------------------------------------------------------- */
/* Whole graph (Cytoscape Explorer)                                           */
/* -------------------------------------------------------------------------- */

export async function getGraph({ includeEnded = false } = {}) {
  const [students, friends, mentors, collabs, requests] = await run(
    `SELECT id, name, department, year, avatar, skills, interests FROM student;
     SELECT id, level, in, out FROM friends_with;
     SELECT id, expertise, status, in, out FROM mentors ${includeEnded ? '' : "WHERE status = 'active'"};
     SELECT id, project_title, type, status, in, out FROM collaborates_with ${includeEnded ? '' : "WHERE status != 'ended'"};
     SELECT id, expertise, status, in, out FROM mentorship_request WHERE status = 'pending';`,
  );

  const nodes = students.map((s) => ({ ...s, degree: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  const add = (e, type, extra = {}) => {
    edges.push({ id: e.id, type, source: e.in, target: e.out, status: e.status ?? 'active', ...extra });
    byId.get(e.in) && (byId.get(e.in).degree += 1);
    byId.get(e.out) && (byId.get(e.out).degree += 1);
  };
  friends.forEach((e) => add(e, 'friendship', { label: e.level === 'close' ? 'close friends' : 'friends', level: e.level }));
  // mentors: in = mentor, out = mentee (directional)
  mentors.forEach((e) => add(e, 'mentorship', { label: `mentors: ${e.expertise}`, expertise: e.expertise }));
  collabs.forEach((e) => add(e, 'collaboration', { label: e.project_title, project: e.project_title, collabType: e.type }));
  // request: in = mentee, out = mentor (directional, shown dashed)
  requests.forEach((e) => add(e, 'request', { label: `asks: ${e.expertise}`, expertise: e.expertise }));

  return { nodes, edges };
}

/* -------------------------------------------------------------------------- */
/* Network around one student, within N hops                                  */
/* -------------------------------------------------------------------------- */

const NEIGHBOURS = '<->(friends_with, mentors, collaborates_with)<->student';

/** Ids reachable within `depth` hops (undirected, over friend/mentor/collab edges). */
async function reachable(meRid, depth) {
  const d = Math.floor(depth);
  const rows = await runLast(`RETURN $me.{..${d}+collect}${NEIGHBOURS};`, { me: meRid });
  return (rows ?? []).filter((id) => id !== ridStr(meRid));
}

/**
 * Students within `depth` hops, each tagged with `hops` (1 = direct connection,
 * 2 = friend-of-a-connection, ...), plus the edges among them.
 */
export async function getNetwork(studentId, depth = 2) {
  const me = toRid('student', studentId);
  const d = Number(depth);
  if (!Number.isInteger(d) || d < 1 || d > 4) throw badRequest('depth must be a whole number from 1 to 4');

  const hopOf = new Map();
  for (let k = 1; k <= d; k++) {
    for (const id of await reachable(me, k)) if (!hopOf.has(id)) hopOf.set(id, k);
  }
  const ids = [ridStr(me), ...hopOf.keys()];
  const rids = ids.map((s) => toRid('student', s));

  const [students, friends, mentors, collabs] = await run(
    `SELECT id, name, department, year, avatar, skills, interests FROM student WHERE id IN $ids;
     SELECT id, level, in, out FROM friends_with WHERE in IN $ids AND out IN $ids;
     SELECT id, expertise, status, in, out FROM mentors WHERE status = 'active' AND in IN $ids AND out IN $ids;
     SELECT id, project_title, type, status, in, out FROM collaborates_with WHERE status != 'ended' AND in IN $ids AND out IN $ids;`,
    { ids: rids },
  );
  const nodes = students.map((s) => ({ ...s, hops: s.id === ridStr(me) ? 0 : hopOf.get(s.id) }));
  const edges = [
    ...friends.map((e) => ({ id: e.id, type: 'friendship', source: e.in, target: e.out, label: 'friends' })),
    ...mentors.map((e) => ({ id: e.id, type: 'mentorship', source: e.in, target: e.out, label: `mentors: ${e.expertise}` })),
    ...collabs.map((e) => ({ id: e.id, type: 'collaboration', source: e.in, target: e.out, label: e.project_title })),
  ];
  return { center: ridStr(me), depth: d, nodes, edges };
}

/* -------------------------------------------------------------------------- */
/* Simple lists used by profile / API                                         */
/* -------------------------------------------------------------------------- */

export async function listConnections({ type, status, student } = {}) {
  const tables = type ? [{ friendship: 'friends_with', mentorship: 'mentors', collaboration: 'collaborates_with', request: 'mentorship_request' }[type]] : [...EDGE_TABLES, 'mentorship_request'];
  if (tables.some((t) => !t)) throw badRequest('type must be friendship, mentorship, collaboration or request');
  const out = [];
  const vars = {};
  const cond = [];
  if (status) { vars.status = status; cond.push('status = $status'); }
  if (student) { vars.s = toRid('student', student, 'student'); cond.push('(in = $s OR out = $s)'); }
  for (const t of tables) {
    // friends_with has no `status` field, so skip the filter for it
    const c = t === 'friends_with' ? cond.filter((x) => !x.startsWith('status')) : cond;
    const rows = await runLast(
      `SELECT id, in, out, in.name AS from_name, out.name AS to_name FROM ${t} ${c.length ? 'WHERE ' + c.join(' AND ') : ''};`,
      vars,
    );
    rows.forEach((r) => out.push({ ...r, type: t }));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* QUERY LAB: the ten graph questions                                         */
/* -------------------------------------------------------------------------- */

const brief = 'id, name, department, year, skills';

/**
 * Each query: the SurrealQL text exactly as executed, which inputs it needs,
 * and a plain-English explanation for the viva.
 */
export const QUERIES = [
  {
    id: 'direct-friends',
    title: '1. Direct friends of a student',
    kind: 'direct',
    needs: ['student'],
    explain:
      'A friendship is stored as one edge, so a student may be on either end of it. The <-> operator walks the edge in both directions; we drop the student themself from the result.',
    surql: `SELECT ${brief} FROM student
WHERE id IN $student<->friends_with<->student
  AND id != $student
ORDER BY name;`,
  },
  {
    id: 'mentors-mentees',
    title: '2. Mentors and mentees of a student',
    kind: 'direct',
    needs: ['student'],
    explain:
      'Mentorship is directional: (mentor)->mentors->(mentee). <- walks backwards to find my mentors, -> walks forwards to find my mentees. The WHERE inside the path keeps only active mentorships.',
    surql: `RETURN array::concat(
  (SELECT 'mentor' AS role, ${brief} FROM student
   WHERE id IN $student<-(mentors WHERE status = 'active')<-student),
  (SELECT 'mentee' AS role, ${brief} FROM student
   WHERE id IN $student->(mentors WHERE status = 'active')->student)
);`,
  },
  {
    id: 'two-hops',
    title: '3. Students connected through two relationship hops',
    kind: 'multi-hop',
    needs: ['student'],
    explain:
      'Chaining the traversal twice goes friend -> friend-of-friend. We remove the student and their direct friends so only genuinely new people remain: "people you may know".',
    surql: `SELECT ${brief} FROM student
WHERE id IN $student<->friends_with<->student<->friends_with<->student
  AND id != $student
  AND id NOT IN $student<->friends_with<->student
ORDER BY name;`,
  },
  {
    id: 'common-friends',
    title: '4. Friends two students have in common',
    kind: 'multi-hop',
    needs: ['student', 'other'],
    explain:
      'The intersection of two traversals: students who are in the friend list of BOTH people. No JOIN is needed, because each friend list is just a walk along edges.',
    surql: `SELECT ${brief} FROM student
WHERE id IN $student<->friends_with<->student
  AND id IN $other<->friends_with<->student
  AND id NOT IN [$student, $other]
ORDER BY name;`,
  },
  {
    id: 'skill-match',
    title: '5. Students whose skills match an interest',
    kind: 'direct',
    needs: ['interest'],
    explain:
      'A plain filter on node properties (no traversal): any student with a skill containing the search word, or listing it as an interest. skills.any(|$s| ...) tests each item of the array.',
    surql: `SELECT ${brief}, interests FROM student
WHERE skills.any(|$s| string::lowercase($s) CONTAINS string::lowercase($interest))
   OR interests.any(|$i| string::lowercase($i) CONTAINS string::lowercase($interest))
ORDER BY name;`,
  },
  {
    id: 'potential-mentors',
    title: '6. Potential mentors (skills + relationship path)',
    kind: 'multi-hop',
    needs: ['student'],
    explain:
      'Candidates are more senior students who share skills/interests with me and are not already my mentor. The two boolean columns show HOW I am connected: directly (friend) or through a friend (friend-of-a-friend), so a warm introduction is possible.',
    surql: `LET $my = (SELECT * FROM ONLY $student);
SELECT ${brief},
       array::intersect(skills, array::concat($my.skills, $my.interests)) AS shared,
       array::len(array::intersect(skills, array::concat($my.skills, $my.interests))) AS shared_count,
       id IN $student<->friends_with<->student AS is_friend,
       id IN $student<->friends_with<->student<->friends_with<->student AS via_friend_of_friend
FROM student
WHERE year > $my.year
  AND id != $student
  AND id NOT IN $student<-(mentors WHERE status = 'active')<-student
  AND array::len(array::intersect(skills, array::concat($my.skills, $my.interests))) > 0
ORDER BY shared_count DESC, name;`,
  },
  {
    id: 'most-connected',
    title: '7. Students with the most connections',
    kind: 'aggregate',
    needs: [],
    explain:
      'count(<->edge) counts the edges touching each student, for every edge type. Adding them gives the "degree" of the node, a classic graph measure of how central someone is.',
    surql: `SELECT name, department,
       count(<->friends_with)      AS friendships,
       count(<->mentors)           AS mentorships,
       count(<->collaborates_with) AS collaborations,
       count(<->friends_with) + count(<->mentors) + count(<->collaborates_with) AS total
FROM student
ORDER BY total DESC, name
LIMIT 8;`,
  },
  {
    id: 'cross-department',
    title: '8. Collaboration network across departments',
    kind: 'aggregate',
    needs: [],
    explain:
      'Each collaboration edge knows both its endpoints, so in.department and out.department can be read straight off the edge. Grouping shows which departments work together.',
    surql: `SELECT in.department AS from_dept, out.department AS to_dept,
       count() AS projects, array::group(project_title) AS titles
FROM collaborates_with
WHERE in.department != out.department AND status != 'ended'
GROUP BY from_dept, to_dept
ORDER BY projects DESC;`,
  },
  {
    id: 'pending-requests',
    title: '9. Pending mentorship requests for a mentor',
    kind: 'direct',
    needs: ['student'],
    explain:
      'Requests are edges (mentee)->(mentor). Reading the edge table with out = this mentor lists everyone waiting for an answer, and in.name follows the edge back to the requester.',
    surql: `SELECT id, in.name AS mentee, in.department AS department, expertise, message, created_at
FROM mentorship_request
WHERE out = $student AND status = 'pending'
ORDER BY created_at DESC;`,
  },
  {
    id: 'network-depth',
    title: '10. Network within N hops (configurable depth)',
    kind: 'multi-hop',
    needs: ['student', 'depth'],
    explain:
      'The recursive path {..N+collect} repeats the traversal up to N times and gathers every student reached, across friendship, mentorship and collaboration edges. The "hops" column (computed by running depth 1, 2, ... N) separates direct connections from multi-hop ones.',
    surql: `SELECT ${brief}
FROM student
WHERE id IN $student.{..{DEPTH}+collect}<->(friends_with, mentors, collaborates_with)<->student
  AND id != $student
ORDER BY name;`,
  },
];

export const listQueries = () => QUERIES.map(({ id, title, kind, needs, explain }) => ({ id, title, kind, needs, explain }));

export async function runQuery(queryId, params = {}) {
  const q = QUERIES.find((x) => x.id === queryId);
  if (!q) throw badRequest(`Unknown query "${queryId}"`);

  const vars = {};
  for (const need of q.needs) {
    if (need === 'student' || need === 'other') {
      if (!params[need]) throw badRequest(`This query needs "${need}" (a student id)`);
      vars[need] = toRid('student', params[need], need);
    } else if (need === 'interest') {
      if (!params.interest || String(params.interest).trim().length < 1) throw badRequest('This query needs an "interest" word');
      vars.interest = String(params.interest).trim().slice(0, 40);
    } else if (need === 'depth') {
      const d = Number(params.depth ?? 2);
      if (!Number.isInteger(d) || d < 1 || d > 4) throw badRequest('depth must be a whole number from 1 to 4');
      vars.depth = d;
    }
  }

  let surql = q.surql;
  if (q.needs.includes('depth')) surql = surql.replace('{DEPTH}', String(vars.depth));
  const shown = surql;
  const { depth, ...bound } = vars; // depth is written into the text, not bound

  const res = await run(surql, bound);
  let rows = res[res.length - 1];
  if (!Array.isArray(rows)) rows = rows == null ? [] : [rows];

  if (q.id === 'network-depth') {
    const net = await getNetwork(params.student, vars.depth);
    const hops = new Map(net.nodes.map((n) => [n.id, n.hops]));
    rows = rows.map((r) => ({ ...r, hops: hops.get(r.id), reach: hops.get(r.id) === 1 ? 'direct' : 'multi-hop' }));
    rows.sort((a, b) => a.hops - b.hops || a.name.localeCompare(b.name));
  }
  return { id: q.id, title: q.title, kind: q.kind, explain: q.explain, surql: shown, params: { ...params }, rows };
}
