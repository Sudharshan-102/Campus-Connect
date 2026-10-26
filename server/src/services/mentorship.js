// Mentorship workflow: request -> (accept | reject | cancel) -> active mentorship -> ended.
//
// Every state change is ONE SurrealDB transaction, so the graph can never show
// "request accepted" without the matching mentorship edge (or the reverse).
import { run, runLast, runTx } from '../db.js';
import { badRequest, AppError, notFound } from '../errors.js';
import { toRid } from '../util.js';
import { ENDS } from './shared.js';

const REQUEST_STATUSES = ['pending', 'accepted', 'rejected'];

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listRequests({ mentor, mentee, status } = {}) {
  const vars = {};
  const where = [];
  if (mentor) { vars.mentor = toRid('student', mentor, 'mentor'); where.push('out = $mentor'); }
  if (mentee) { vars.mentee = toRid('student', mentee, 'mentee'); where.push('in = $mentee'); }
  if (status) {
    if (!REQUEST_STATUSES.includes(status)) throw badRequest(`status must be one of ${REQUEST_STATUSES.join(', ')}`);
    vars.status = status;
    where.push('status = $status');
  }
  const rows = await runLast(
    `SELECT id, status, expertise, message, created_at, responded_at, ${ENDS}
     FROM mentorship_request ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC;`,
    vars,
  );
  // a = mentee (requester), b = mentor (asked)
  return rows.map((r) => ({ ...r, mentee: r.a, mentor: r.b, a: undefined, b: undefined }));
}

export async function listMentorships({ student, status } = {}) {
  const vars = {};
  const where = [];
  if (student) { vars.s = toRid('student', student, 'student'); where.push('(in = $s OR out = $s)'); }
  if (status) { vars.status = status; where.push('status = $status'); }
  const rows = await runLast(
    `SELECT id, expertise, status, started_at, ended_at, via_request, ${ENDS}
     FROM mentors ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY started_at DESC;`,
    vars,
  );
  // a = mentor, b = mentee
  return rows.map((r) => ({ ...r, mentor: r.a, mentee: r.b, a: undefined, b: undefined }));
}

/* -------------------------------------------------------------------------- */
/* Create a request                                                           */
/* -------------------------------------------------------------------------- */

export async function createRequest(menteeRid, { mentorId, expertise, message = '' }) {
  const mentor = toRid('student', mentorId, 'mentorId');
  if (typeof expertise !== 'string' || expertise.trim().length < 2 || expertise.trim().length > 60) {
    throw badRequest('Expertise must be 2 to 60 characters');
  }
  if (typeof message !== 'string' || message.length > 300) throw badRequest('Message must be at most 300 characters');

  return runTx(
    `LET $mentee = (SELECT * FROM ONLY $menteeId);
     LET $mentor = (SELECT * FROM ONLY $mentorId);
     IF $mentee = NONE OR $mentor = NONE { THROW "E_NOT_FOUND: One of the students does not exist." };
     IF $menteeId = $mentorId { THROW "E_SELF: You cannot request mentorship from yourself." };
     IF $mentor.year <= $mentee.year { THROW "E_NOT_ALLOWED: A mentor must be at least one year senior to the mentee."; };
     LET $active = (SELECT VALUE id FROM mentors WHERE in = $mentorId AND out = $menteeId AND status = 'active');
     IF array::len($active) > 0 { THROW "E_DUPLICATE: This mentorship is already active."; };
     LET $open = (SELECT VALUE id FROM mentorship_request WHERE in = $menteeId AND out = $mentorId AND status = 'pending');
     IF array::len($open) > 0 { THROW "E_DUPLICATE: A request to this mentor is already pending."; };
     LET $req = (RELATE ONLY ($menteeId)->mentorship_request->($mentorId)
                   SET expertise = $expertise, message = $message);
     fn::log_activity('mentorship_requested',
        string::concat($mentee.name, ' asked ', $mentor.name, ' for ', $expertise, ' mentorship'),
        [$menteeId, $mentorId]);
     RETURN $req;`,
    { menteeId: menteeRid, mentorId: mentor, expertise: expertise.trim(), message: message.trim() },
  );
}

/* -------------------------------------------------------------------------- */
/* THE ATOMIC ACCEPTANCE TRANSACTION                                          */
/* -------------------------------------------------------------------------- */

export const ACCEPT_TRANSACTION = `BEGIN TRANSACTION;

-- 1. Verify the request exists, belongs to this mentor, and is still pending
LET $req = (SELECT * FROM ONLY $rid);
IF $req = NONE { THROW "E_NOT_FOUND: Mentorship request not found."; };
IF $req.out != $actor { THROW "E_FORBIDDEN: Only the mentor named on this request can respond to it."; };
IF $req.status != 'pending' {
    THROW string::concat("E_ALREADY_PROCESSED: This request was already ", $req.status, ".");
};

-- 2. Verify the participants and that the relationship is allowed
LET $mentor = (SELECT * FROM ONLY $req.out);
LET $mentee = (SELECT * FROM ONLY $req.in);
IF $mentor = NONE OR $mentee = NONE { THROW "E_NOT_FOUND: A student on this request no longer exists."; };
IF $mentor.id = $mentee.id { THROW "E_SELF: A student cannot mentor themselves."; };
IF $mentor.year <= $mentee.year { THROW "E_NOT_ALLOWED: A mentor must be at least one year senior to the mentee."; };
LET $already = (SELECT VALUE id FROM mentors WHERE in = $mentor.id AND out = $mentee.id AND status = 'active');
IF array::len($already) > 0 { THROW "E_DUPLICATE: An active mentorship already exists between these students."; };

-- 3. The two writes that must succeed or fail TOGETHER
UPDATE ONLY $rid SET status = 'accepted', responded_at = time::now();
LET $mentorship = (RELATE ONLY ($mentor.id)->mentors->($mentee.id)
                     SET expertise = $req.expertise, via_request = $rid);

-- (demo only) pretend the server crashes after both writes but before COMMIT
IF $simulate_failure { THROW "E_SIMULATED: Simulated crash after both writes, before COMMIT."; };

-- 4. Log it in the graph, then return the result
fn::log_activity('mentorship_accepted',
    string::concat($mentor.name, ' is now mentoring ', $mentee.name, ' in ', $req.expertise),
    [$mentor.id, $mentee.id]);
RETURN { request: (SELECT * FROM ONLY $rid), mentorship: $mentorship };

COMMIT TRANSACTION;`;

/**
 * Accept a request. Throws AppError (404/403/409/422...) and leaves the graph
 * untouched if anything is wrong.
 */
export async function acceptRequest(requestId, actorRid, { simulateFailure = false } = {}) {
  const rid = toRid('mentorship_request', requestId, 'request id');
  const res = await run(ACCEPT_TRANSACTION, { rid, actor: actorRid, simulate_failure: simulateFailure });
  return res[res.length - 2];
}

/**
 * Teaching helper: run the acceptance with a forced failure AFTER both writes,
 * and prove the database rolled everything back.
 */
export async function rollbackDemo(requestId, actorRid) {
  const rid = toRid('mentorship_request', requestId, 'request id');

  const snapshot = () =>
    runLast(
      `RETURN {
         request_status: (SELECT VALUE status FROM ONLY $rid),
         mentorship_edges: array::len((SELECT id FROM mentors)),
         activity_nodes: array::len((SELECT id FROM activity))
       };`,
      { rid },
    );

  const before = await snapshot();
  if (before.request_status !== 'pending') {
    throw new AppError(409, 'E_ALREADY_PROCESSED', 'Pick a request that is still pending to run the rollback demo.');
  }

  let error = null;
  try {
    await acceptRequest(requestId, actorRid, { simulateFailure: true });
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== 'E_SIMULATED') throw e;
    error = { code: e.code, message: e.message };
  }
  const after = await snapshot();

  return {
    steps: [
      'BEGIN TRANSACTION',
      'Verified the request is pending and the mentor is allowed',
      'UPDATE request SET status = accepted  (executed inside the transaction)',
      'RELATE mentor->mentors->mentee  (executed inside the transaction)',
      'THROW "E_SIMULATED ..."  (forced failure before COMMIT)',
      'SurrealDB cancels the transaction: both writes are discarded',
    ],
    error,
    before,
    after,
    rolledBack: JSON.stringify(before) === JSON.stringify(after) && error !== null,
  };
}

/* -------------------------------------------------------------------------- */
/* Reject / cancel / end                                                      */
/* -------------------------------------------------------------------------- */

export async function rejectRequest(requestId, actorRid) {
  const rid = toRid('mentorship_request', requestId, 'request id');
  return runTx(
    `LET $req = (SELECT * FROM ONLY $rid);
     IF $req = NONE { THROW "E_NOT_FOUND: Mentorship request not found."; };
     IF $req.out != $actor { THROW "E_FORBIDDEN: Only the mentor named on this request can respond to it."; };
     IF $req.status != 'pending' { THROW string::concat("E_ALREADY_PROCESSED: This request was already ", $req.status, "."); };
     LET $mentor = (SELECT * FROM ONLY $req.out);
     LET $mentee = (SELECT * FROM ONLY $req.in);
     UPDATE ONLY $rid SET status = 'rejected', responded_at = time::now();
     fn::log_activity('mentorship_rejected',
        string::concat($mentor.name, ' declined ', $mentee.name, "'s mentorship request"), [$mentor.id, $mentee.id]);
     RETURN (SELECT * FROM ONLY $rid);`,
    { rid, actor: actorRid },
  );
}

/** The student who asked may withdraw a request that is still pending. */
export async function cancelRequest(requestId, actorRid) {
  const rid = toRid('mentorship_request', requestId, 'request id');
  return runTx(
    `LET $req = (SELECT * FROM ONLY $rid);
     IF $req = NONE { THROW "E_NOT_FOUND: Mentorship request not found."; };
     IF $req.in != $actor { THROW "E_FORBIDDEN: Only the student who sent the request can cancel it."; };
     IF $req.status != 'pending' { THROW string::concat("E_ALREADY_PROCESSED: This request was already ", $req.status, " and cannot be cancelled."); };
     LET $mentor = (SELECT * FROM ONLY $req.out);
     LET $mentee = (SELECT * FROM ONLY $req.in);
     DELETE $rid;
     fn::log_activity('mentorship_cancelled',
        string::concat($mentee.name, ' withdrew the request to ', $mentor.name), [$mentor.id, $mentee.id]);
     RETURN { removed: $rid };`,
    { rid, actor: actorRid },
  );
}

/** Either participant can end an active mentorship. History is kept (status = ended). */
export async function endMentorship(id, actorRid) {
  const rid = toRid('mentors', id);
  return runTx(
    `LET $m = (SELECT * FROM ONLY $rid);
     IF $m = NONE { THROW "E_NOT_FOUND: Mentorship not found."; };
     IF $actor != $m.in AND $actor != $m.out { THROW "E_FORBIDDEN: Only the mentor or the mentee can end this mentorship."; };
     IF $m.status != 'active' { THROW "E_ALREADY_PROCESSED: This mentorship has already ended."; };
     LET $mentor = (SELECT * FROM ONLY $m.in);
     LET $mentee = (SELECT * FROM ONLY $m.out);
     UPDATE ONLY $rid SET status = 'ended', ended_at = time::now();
     fn::log_activity('mentorship_ended',
        string::concat($mentor.name, "'s mentorship of ", $mentee.name, ' has ended'), [$mentor.id, $mentee.id]);
     RETURN (SELECT * FROM ONLY $rid);`,
    { rid, actor: actorRid },
  );
}

/** Remove the record of an ENDED mentorship entirely (housekeeping). */
export async function deleteMentorship(id, actorRid) {
  const rid = toRid('mentors', id);
  return runTx(
    `LET $m = (SELECT * FROM ONLY $rid);
     IF $m = NONE { THROW "E_NOT_FOUND: Mentorship not found."; };
     IF $actor != $m.in AND $actor != $m.out { THROW "E_FORBIDDEN: Only the mentor or the mentee can remove this mentorship."; };
     IF $m.status = 'active' { THROW "E_NOT_ALLOWED: End the mentorship first; active mentorships cannot be deleted."; };
     DELETE $rid;
     RETURN { removed: $rid };`,
    { rid, actor: actorRid },
  );
}

export { notFound };
