import { run, runLast, runTx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { toRid, ridStr } from '../util.js';
import { ENDS } from './shared.js';

const LEVELS = ['friend', 'close'];

/** Friendship is mutual and stored once, from the smaller to the larger record id. */
const canonical = (a, b) => (ridStr(a) < ridStr(b) ? [a, b] : [b, a]);

export async function listFriendships({ student, level } = {}) {
  const vars = {};
  const where = [];
  if (student) { vars.s = toRid('student', student, 'student'); where.push('(in = $s OR out = $s)'); }
  if (level) { vars.level = level; where.push('level = $level'); }
  return runLast(
    `SELECT id, level, created_at, ${ENDS} FROM friends_with ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC;`,
    vars,
  );
}

export async function createFriendship(actorRid, otherId, level = 'friend') {
  const other = toRid('student', otherId, 'friendId');
  if (!LEVELS.includes(level)) throw badRequest(`level must be one of ${LEVELS.join(', ')}`);
  const [x, y] = canonical(actorRid, other);
  return runTx(
    `LET $a = (SELECT * FROM ONLY $x);
     LET $b = (SELECT * FROM ONLY $y);
     IF $a = NONE OR $b = NONE { THROW "E_NOT_FOUND: One of the students does not exist." };
     IF $x = $y { THROW "E_SELF: A student cannot befriend themselves." };
     LET $dup = (SELECT VALUE id FROM friends_with WHERE in = $x AND out = $y);
     IF array::len($dup) > 0 { THROW "E_DUPLICATE: These students are already friends." };
     LET $e = (RELATE ONLY ($x)->friends_with->($y) SET level = $level);
     fn::log_activity('friendship_created', string::concat($a.name, ' and ', $b.name, ' became friends'), [$x, $y]);
     RETURN $e;`,
    { x, y, level },
  );
}

export async function updateFriendship(id, actorRid, { level }) {
  const rid = toRid('friends_with', id);
  if (!LEVELS.includes(level)) throw badRequest(`level must be one of ${LEVELS.join(', ')}`);
  return runTx(
    `LET $e = (SELECT * FROM ONLY $id);
     IF $e = NONE { THROW "E_NOT_FOUND: Friendship not found." };
     IF $actor != $e.in AND $actor != $e.out { THROW "E_FORBIDDEN: Only one of the two friends can change this friendship." };
     RETURN (UPDATE ONLY $id SET level = $level);`,
    { id: rid, level, actor: actorRid },
  );
}

/** Only one of the two friends may remove the friendship. */
export async function deleteFriendship(id, actorRid) {
  const rid = toRid('friends_with', id);
  return runTx(
    `LET $e = (SELECT * FROM ONLY $id);
     IF $e = NONE { THROW "E_NOT_FOUND: Friendship not found." };
     IF $actor != $e.in AND $actor != $e.out { THROW "E_FORBIDDEN: Only one of the two friends can remove this friendship." };
     LET $a = (SELECT * FROM ONLY $e.in);
     LET $b = (SELECT * FROM ONLY $e.out);
     DELETE $id;
     fn::log_activity('friendship_removed', string::concat($a.name, ' and ', $b.name, ' are no longer friends'), [$a.id, $b.id]);
     RETURN { removed: $id };`,
    { id: rid, actor: actorRid },
  );
}

export { notFound };
