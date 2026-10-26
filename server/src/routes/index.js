import { Router } from 'express';
import { asyncRoute } from '../util.js';
import { needActor, needConfirm } from '../middleware.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { hub } from '../live.js';
import { seedDemoData } from '../seed.js';
import * as students from '../services/students.js';
import * as friends from '../services/friendships.js';
import * as mentorship from '../services/mentorship.js';
import * as collabs from '../services/collaborations.js';
import * as graph from '../services/graph.js';
import * as dashboard from '../services/dashboard.js';

const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
export const router = Router();

/* ---------------------------------- meta --------------------------------- */
router.get('/health', (_req, res) => ok(res, { status: 'up' }));
router.get('/events', (req, res) => hub.addClient(req, res)); // Server-Sent Events (live updates)

/* -------------------------------- students ------------------------------- */
router.get('/students', asyncRoute(async (req, res) => ok(res, await students.listStudents(req.query))));
router.post('/students', asyncRoute(async (req, res) => ok(res, await students.createStudent(req.body), 201)));
router.get('/students/:id', asyncRoute(async (req, res) => ok(res, await students.getStudentProfile(req.params.id))));
router.put('/students/:id', asyncRoute(async (req, res) => {
  needActor(req);
  ok(res, await students.updateStudent(req.params.id, req.body));
}));
router.delete('/students/:id', asyncRoute(async (req, res) => {
  needActor(req);
  needConfirm(req, 'DELETE');
  ok(res, await students.deleteStudent(req.params.id));
}));

/* ----------------------- per-student graph reads ------------------------- */
router.get('/students/:id/connections', asyncRoute(async (req, res) => ok(res, await students.getStudentProfile(req.params.id))));
router.get('/students/:id/friends', asyncRoute(async (req, res) => ok(res, (await students.getStudentProfile(req.params.id)).friends)));
router.get('/students/:id/mentors', asyncRoute(async (req, res) => {
  const p = await students.getStudentProfile(req.params.id);
  ok(res, { mentors: p.mentors, mentees: p.mentees });
}));
router.get('/students/:id/network', asyncRoute(async (req, res) => ok(res, await graph.getNetwork(req.params.id, req.query.depth ?? 2))));

/* --------------------------------- graph --------------------------------- */
router.get('/graph', asyncRoute(async (req, res) => ok(res, await graph.getGraph({ includeEnded: req.query.includeEnded === 'true' }))));
router.get('/connections', asyncRoute(async (req, res) => ok(res, await graph.listConnections(req.query))));
router.get('/queries', (_req, res) => ok(res, graph.listQueries()));
router.get('/queries/:id', asyncRoute(async (req, res) => ok(res, await graph.runQuery(req.params.id, req.query))));

/* ------------------------------- friendships ------------------------------ */
router.get('/friendships', asyncRoute(async (req, res) => ok(res, await friends.listFriendships(req.query))));
router.post('/friendships', asyncRoute(async (req, res) => {
  ok(res, await friends.createFriendship(needActor(req), req.body?.friendId, req.body?.level), 201);
}));
router.put('/friendships/:id', asyncRoute(async (req, res) => ok(res, await friends.updateFriendship(req.params.id, needActor(req), req.body ?? {}))));
router.delete('/friendships/:id', asyncRoute(async (req, res) => ok(res, await friends.deleteFriendship(req.params.id, needActor(req)))));

/* --------------------------- mentorship requests -------------------------- */
router.get('/mentorship-requests/transaction-sql', (_req, res) => ok(res, { surql: mentorship.ACCEPT_TRANSACTION }));
router.get('/mentorship-requests', asyncRoute(async (req, res) => ok(res, await mentorship.listRequests(req.query))));
router.post('/mentorship-requests', asyncRoute(async (req, res) => ok(res, await mentorship.createRequest(needActor(req), req.body ?? {}), 201)));
router.post('/mentorship-requests/:id/accept', asyncRoute(async (req, res) => ok(res, await mentorship.acceptRequest(req.params.id, needActor(req)))));
router.post('/mentorship-requests/:id/reject', asyncRoute(async (req, res) => ok(res, await mentorship.rejectRequest(req.params.id, needActor(req)))));
router.post('/mentorship-requests/:id/rollback-demo', asyncRoute(async (req, res) => ok(res, await mentorship.rollbackDemo(req.params.id, needActor(req)))));
router.delete('/mentorship-requests/:id', asyncRoute(async (req, res) => ok(res, await mentorship.cancelRequest(req.params.id, needActor(req)))));

/* ------------------------------- mentorships ------------------------------ */
router.get('/mentorships', asyncRoute(async (req, res) => ok(res, await mentorship.listMentorships(req.query))));
router.put('/mentorships/:id/end', asyncRoute(async (req, res) => ok(res, await mentorship.endMentorship(req.params.id, needActor(req)))));
router.delete('/mentorships/:id', asyncRoute(async (req, res) => ok(res, await mentorship.deleteMentorship(req.params.id, needActor(req)))));

/* ----------------------------- collaborations ----------------------------- */
router.get('/collaborations', asyncRoute(async (req, res) => ok(res, await collabs.listCollaborations(req.query))));
router.post('/collaborations', asyncRoute(async (req, res) => {
  const b = req.body ?? {};
  ok(res, await collabs.createCollaboration(needActor(req), b.partnerId, b.projectTitle, b.type), 201);
}));
router.put('/collaborations/:id', asyncRoute(async (req, res) => ok(res, await collabs.updateCollaboration(req.params.id, needActor(req), req.body))));
router.delete('/collaborations/:id', asyncRoute(async (req, res) => ok(res, await collabs.deleteCollaboration(req.params.id, needActor(req)))));

/* ------------------------------- dashboard -------------------------------- */
router.get('/dashboard/stats', asyncRoute(async (_req, res) => ok(res, await dashboard.getStats())));
router.get('/activity', asyncRoute(async (req, res) => ok(res, await dashboard.getActivity(req.query.limit))));

/* --------------------------------- admin ---------------------------------- */
router.post('/admin/reseed', asyncRoute(async (req, res) => {
  if (!config.allowReset) throw new AppError(403, 'E_FORBIDDEN', 'Resetting demo data is disabled (ALLOW_RESET=false).');
  needConfirm(req, 'RESET');
  ok(res, await seedDemoData());
}));
