import { AppError, mapDbError } from './errors.js';
import { run } from './db.js';
import { toRid } from './util.js';

/**
 * DEMO IDENTITY (not real authentication).
 * The browser sends the id of the student you chose to "act as" in X-Demo-User.
 * We never take the acting student from the request body, and every workflow
 * checks that identity against the data in the database (e.g. only the mentor
 * named on a request can accept it). A production system would replace this
 * header with SurrealDB record access / JWT sign-in.
 */
export async function withActor(req, _res, next) {
  try {
    const header = req.get('x-demo-user');
    req.actor = null;
    if (header) {
      const rid = toRid('student', header, 'X-Demo-User');
      const [rows] = await run('SELECT VALUE id FROM student WHERE id = $id;', { id: rid });
      if (!rows.length) throw new AppError(401, 'E_NO_IDENTITY', 'The selected demo identity no longer exists. Pick another student.');
      req.actor = rid;
    }
    next();
  } catch (e) {
    next(mapDbError(e));
  }
}

export function needActor(req) {
  if (!req.actor) throw new AppError(401, 'E_NO_IDENTITY', 'Choose which student you are acting as (demo identity) first.');
  return req.actor;
}

/** Destructive actions must carry an explicit confirmation header. */
export function needConfirm(req, word) {
  if (req.get('x-confirm') !== word) {
    throw new AppError(400, 'E_CONFIRM', `This action needs confirmation (header X-Confirm: ${word}).`);
  }
}

export function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'E_NOT_FOUND', 'No such API route.'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: { code: 'E_VALIDATION', message: 'Request body is not valid JSON.' } });
  }
  console.error('Unexpected error:', err);
  res.status(500).json({ ok: false, error: { code: 'E_INTERNAL', message: 'Something went wrong on the server.' } });
}
