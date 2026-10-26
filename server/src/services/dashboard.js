import { run, runLast } from '../db.js';

export async function getStats() {
  const [stats, byDept] = await run(`
    RETURN {
      students:       array::len((SELECT VALUE id FROM student)),
      friendships:    array::len((SELECT VALUE id FROM friends_with)),
      mentorships:    array::len((SELECT VALUE id FROM mentors WHERE status = 'active')),
      pendingRequests:array::len((SELECT VALUE id FROM mentorship_request WHERE status = 'pending')),
      collaborations: array::len((SELECT VALUE id FROM collaborates_with WHERE status != 'ended'))
    };
    SELECT department, count() AS students FROM student GROUP BY department ORDER BY students DESC;`);
  return { ...stats, byDepartment: byDept };
}

/** Recent activity: each event is a graph node linked to the students it involves. */
export async function getActivity(limit = 20) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return runLast(
    `SELECT id, kind, message, created_at, ->involves->student.{ id, name } AS people
     FROM activity ORDER BY created_at DESC LIMIT $n;`,
    { n },
  );
}
