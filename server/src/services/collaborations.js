import { runLast, runTx } from '../db.js';
import { badRequest } from '../errors.js';
import { toRid, ridStr } from '../util.js';
import { ENDS } from './shared.js';

export const COLLAB_TYPES = ['project', 'research', 'hackathon', 'study_group'];
export const COLLAB_STATUSES = ['active', 'completed', 'ended'];
const canonical = (a, b) => (ridStr(a) < ridStr(b) ? [a, b] : [b, a]);

const title = (v) => {
  if (typeof v !== 'string' || v.trim().length < 2 || v.trim().length > 80) throw badRequest('Project title must be 2 to 80 characters');
  return v.trim();
};

export async function listCollaborations({ student, status, type } = {}) {
  const vars = {};
  const where = [];
  if (student) { vars.s = toRid('student', student, 'student'); where.push('(in = $s OR out = $s)'); }
  if (status) { vars.status = status; where.push('status = $status'); }
  if (type) { vars.type = type; where.push('type = $type'); }
  return runLast(
    `SELECT id, project_title, type, status, created_at, ended_at, ${ENDS} FROM collaborates_with ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC;`,
    vars,
  );
}

export async function createCollaboration(actorRid, partnerId, projectTitle, type = 'project') {
  const partner = toRid('student', partnerId, 'partnerId');
  const t = title(projectTitle);
  if (!COLLAB_TYPES.includes(type)) throw badRequest(`type must be one of ${COLLAB_TYPES.join(', ')}`);
  const [x, y] = canonical(actorRid, partner);
  return runTx(
    `LET $a = (SELECT * FROM ONLY $x);
     LET $b = (SELECT * FROM ONLY $y);
     IF $a = NONE OR $b = NONE { THROW "E_NOT_FOUND: One of the students does not exist." };
     IF $x = $y { THROW "E_SELF: A student cannot collaborate with themselves." };
     LET $dup = (SELECT VALUE id FROM collaborates_with WHERE in = $x AND out = $y AND project_title = $title);
     IF array::len($dup) > 0 { THROW "E_DUPLICATE: These students already have a collaboration with that title." };
     LET $e = (RELATE ONLY ($x)->collaborates_with->($y) SET project_title = $title, type = $type);
     fn::log_activity('collaboration_added', string::concat($a.name, ' and ', $b.name, ' started "', $title, '"'), [$x, $y]);
     RETURN $e;`,
    { x, y, title: t, type },
  );
}

export async function updateCollaboration(id, actorRid, body = {}) {
  const rid = toRid('collaborates_with', id);
  const patch = {};
  if (body.projectTitle !== undefined) patch.project_title = title(body.projectTitle);
  if (body.type !== undefined) {
    if (!COLLAB_TYPES.includes(body.type)) throw badRequest(`type must be one of ${COLLAB_TYPES.join(', ')}`);
    patch.type = body.type;
  }
  if (body.status !== undefined) {
    if (!COLLAB_STATUSES.includes(body.status)) throw badRequest(`status must be one of ${COLLAB_STATUSES.join(', ')}`);
    patch.status = body.status;
  }
  if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
  const closing = patch.status === 'ended' || patch.status === 'completed';
  return runTx(
    `LET $e = (SELECT * FROM ONLY $id);
     IF $e = NONE { THROW "E_NOT_FOUND: Collaboration not found." };
     IF $actor != $e.in AND $actor != $e.out { THROW "E_FORBIDDEN: Only a collaborator can change this collaboration." };
     LET $u = (UPDATE ONLY $id MERGE $patch);
     IF $closing { UPDATE ONLY $id SET ended_at = time::now(); };
     IF $patch.status != NONE AND $patch.status != $e.status {
       LET $a = (SELECT * FROM ONLY $e.in);
       LET $b = (SELECT * FROM ONLY $e.out);
       fn::log_activity('collaboration_' + $patch.status, string::concat('"', $u.project_title, '" (', $a.name, ' and ', $b.name, ') is now ', $patch.status), [$a.id, $b.id]);
     };
     RETURN (SELECT * FROM ONLY $id);`,
    { id: rid, patch, closing, actor: actorRid },
  );
}

export async function deleteCollaboration(id, actorRid) {
  const rid = toRid('collaborates_with', id);
  return runTx(
    `LET $e = (SELECT * FROM ONLY $id);
     IF $e = NONE { THROW "E_NOT_FOUND: Collaboration not found." };
     IF $actor != $e.in AND $actor != $e.out { THROW "E_FORBIDDEN: Only a collaborator can remove this collaboration." };
     DELETE $id;
     RETURN { removed: $id };`,
    { id: rid, actor: actorRid },
  );
}
