import { run, runLast, runTx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { cleanList, slugify, toRid, ridStr } from '../util.js';
import { BRIEF, ENDS, other } from './shared.js';

export const DEPARTMENTS = ['CSE', 'ECE', 'EEE', 'IT', 'MECH', 'CIVIL'];

const str = (v, field, { min = 0, max = 400, required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw badRequest(`${field} must be text`);
  const t = v.trim();
  if (required && t.length < Math.max(min, 1)) throw badRequest(`${field} is required`);
  if (t.length < min) throw badRequest(`${field} must be at least ${min} characters`);
  if (t.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return t;
};

/** Validate and normalise a student payload. `partial` = update (all fields optional). */
export function parseStudent(body = {}, { partial = false } = {}) {
  const data = {};
  const name = str(body.name, 'Name', { min: 2, max: 60, required: !partial });
  if (name !== undefined) data.name = name;

  if (!partial) {
    const email = str(body.email, 'Email', { max: 120, required: true });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Email is not valid');
    data.email = email.toLowerCase();
  }

  if (body.department !== undefined || !partial) {
    if (!DEPARTMENTS.includes(body.department)) throw badRequest(`Department must be one of ${DEPARTMENTS.join(', ')}`);
    data.department = body.department;
  }
  if (body.year !== undefined || !partial) {
    const y = Number(body.year);
    if (!Number.isInteger(y) || y < 1 || y > 4) throw badRequest('Academic year must be 1, 2, 3 or 4');
    data.year = y;
  }
  if (body.skills !== undefined || !partial) data.skills = cleanList(body.skills);
  if (body.interests !== undefined || !partial) data.interests = cleanList(body.interests);
  const bio = str(body.bio, 'Bio', { max: 400 });
  if (bio !== undefined || !partial) data.bio = bio ?? '';
  if (body.avatar !== undefined) {
    const a = str(body.avatar, 'Avatar URL', { max: 300 }) ?? '';
    if (a && !/^https?:\/\//i.test(a)) throw badRequest('Avatar must be an http(s) URL');
    data.avatar = a;
  }
  if (partial && Object.keys(data).length === 0) throw badRequest('Nothing to update');
  return data;
}

export async function listStudents({ q, dept, year, skill } = {}) {
  const where = [];
  const vars = {};
  if (q) {
    vars.q = String(q).toLowerCase().slice(0, 60);
    where.push(`(string::lowercase(name) CONTAINS $q OR string::lowercase(department) CONTAINS $q
      OR skills.any(|$x| string::lowercase($x) CONTAINS $q)
      OR interests.any(|$x| string::lowercase($x) CONTAINS $q))`);
  }
  if (dept) { vars.dept = String(dept); where.push('department = $dept'); }
  if (year) { vars.year = Number(year); where.push('year = $year'); }
  if (skill) { vars.skill = String(skill).toLowerCase(); where.push('skills.any(|$x| string::lowercase($x) = $skill)'); }

  return runLast(
    `SELECT id, name, email, department, year, skills, interests, bio, avatar, created_at,
            count(<->friends_with) AS friend_count,
            count(<->(mentors WHERE status = 'active')) AS mentorship_count,
            count(<->collaborates_with) AS collab_count
     FROM student ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY name;`,
    vars,
  );
}

export async function getStudentRow(id) {
  const rid = toRid('student', id);
  const row = await runLast('SELECT * FROM ONLY $id;', { id: rid });
  if (!row) throw notFound(`Student ${ridStr(rid)} not found`);
  return row;
}

/** Student + all of their direct relationships, grouped by type. */
export async function getStudentProfile(id) {
  const rid = toRid('student', id);
  const me = ridStr(rid);
  const res = await run(
    `SELECT * FROM ONLY $id;
     SELECT id, level, created_at, ${ENDS} FROM friends_with WHERE in = $id OR out = $id ORDER BY created_at DESC;
     SELECT id, expertise, status, started_at, ended_at, ${ENDS} FROM mentors WHERE (in = $id OR out = $id) ORDER BY started_at DESC;
     SELECT id, project_title, type, status, created_at, ended_at, ${ENDS} FROM collaborates_with WHERE in = $id OR out = $id ORDER BY created_at DESC;
     SELECT id, status, expertise, message, created_at, responded_at, ${ENDS} FROM mentorship_request WHERE in = $id OR out = $id ORDER BY created_at DESC LIMIT 30;`,
    { id: rid },
  );
  const [student, friendEdges, mentorEdges, collabEdges, requestEdges] = res;
  if (!student) throw notFound(`Student ${me} not found`);

  return {
    student,
    friends: friendEdges.map((e) => ({ edge: e.id, level: e.level, since: e.created_at, student: other(e, me) })),
    // students who mentor this student
    mentors: mentorEdges
      .filter((e) => e.b.id === me)
      .map((e) => ({ edge: e.id, expertise: e.expertise, status: e.status, since: e.started_at, endedAt: e.ended_at, student: e.a })),
    // students this student mentors
    mentees: mentorEdges
      .filter((e) => e.a.id === me)
      .map((e) => ({ edge: e.id, expertise: e.expertise, status: e.status, since: e.started_at, endedAt: e.ended_at, student: e.b })),
    collaborators: collabEdges.map((e) => ({
      edge: e.id, project: e.project_title, type: e.type, status: e.status, since: e.created_at, student: other(e, me),
    })),
    incomingRequests: requestEdges.filter((e) => e.b.id === me).map((e) => ({ edge: e.id, status: e.status, expertise: e.expertise, message: e.message, createdAt: e.created_at, respondedAt: e.responded_at, student: e.a })),
    outgoingRequests: requestEdges.filter((e) => e.a.id === me).map((e) => ({ edge: e.id, status: e.status, expertise: e.expertise, message: e.message, createdAt: e.created_at, respondedAt: e.responded_at, student: e.b })),
  };
}

async function uniqueKey(name) {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const key = i === 0 ? base : `${base}_${i + 1}`;
    const rows = await runLast('SELECT id FROM student WHERE id = type::record(\'student\', $k);', { k: key });
    if (rows.length === 0) return key;
  }
  throw badRequest('Could not allocate an id for that name');
}

export async function createStudent(body) {
  const data = parseStudent(body);
  const key = await uniqueKey(data.name);
  const student = await runTx(
    `LET $s = (CREATE ONLY type::record('student', $key) CONTENT $data);
     fn::log_activity('student_added', string::concat($s.name, ' (', $s.department, ', year ', <string>$s.year, ') joined Campus Connect'), [$s.id]);
     RETURN $s;`,
    { key, data },
  );
  return student;
}

export async function updateStudent(id, body) {
  const rid = toRid('student', id);
  const patch = parseStudent(body, { partial: true });
  return runTx(
    `LET $exists = (SELECT VALUE id FROM ONLY $id);
     IF $exists = NONE { THROW "E_NOT_FOUND: Student not found." };
     RETURN (UPDATE ONLY $id MERGE $patch);`,
    { id: rid, patch },
  );
}

/**
 * Delete a student and every edge attached to them as ONE transaction, so the
 * graph can never contain an edge pointing at a missing student.
 */
export async function deleteStudent(id) {
  const rid = toRid('student', id);
  return runTx(
    `LET $s = (SELECT * FROM ONLY $id);
     IF $s = NONE { THROW "E_NOT_FOUND: Student not found." };
     LET $f = (DELETE friends_with WHERE in = $id OR out = $id RETURN BEFORE);
     LET $r = (DELETE mentorship_request WHERE in = $id OR out = $id RETURN BEFORE);
     LET $m = (DELETE mentors WHERE in = $id OR out = $id RETURN BEFORE);
     LET $c = (DELETE collaborates_with WHERE in = $id OR out = $id RETURN BEFORE);
     DELETE involves WHERE out = $id;
     DELETE $id;
     fn::log_activity('student_removed', string::concat($s.name, ' left Campus Connect (their connections were removed)'), []);
     RETURN {
       removed: $id,
       name: $s.name,
       edges_removed: {
         friendships: array::len($f), requests: array::len($r),
         mentorships: array::len($m), collaborations: array::len($c)
       }
     };`,
    { id: rid },
  );
}

export { BRIEF };
