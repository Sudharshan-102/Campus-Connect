/** An error we expect and know how to report to the client. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'E_VALIDATION', msg, details);
export const notFound = (msg) => new AppError(404, 'E_NOT_FOUND', msg);
export const forbidden = (msg) => new AppError(403, 'E_FORBIDDEN', msg);
export const conflict = (msg, code = 'E_DUPLICATE') => new AppError(409, code, msg);

const CODE_STATUS = {
  E_NOT_FOUND: 404,
  E_FORBIDDEN: 403,
  E_VALIDATION: 400,
  E_SELF: 400,
  E_NOT_ALLOWED: 422,
  E_ALREADY_PROCESSED: 409,
  E_DUPLICATE: 409,
  E_CONFLICT: 409,
  E_SIMULATED: 500,
};

/**
 * Translate whatever SurrealDB (or the SDK) threw into an AppError.
 * Our own THROW statements always look like:  E_CODE: human readable message
 */
export function mapDbError(err) {
  if (err instanceof AppError) return err;
  const raw = String(err?.message ?? err);

  const tagged = raw.match(/\b(E_[A-Z_]+):\s*([^\n]*)/);
  if (tagged) {
    const [, code, msg] = tagged;
    return new AppError(CODE_STATUS[code] ?? 400, code, msg.trim());
  }
  if (/already contains/i.test(raw)) {
    return new AppError(409, 'E_DUPLICATE', 'That relationship (or email) already exists.');
  }
  if (/does not exist/i.test(raw)) {
    return new AppError(404, 'E_NOT_FOUND', 'A referenced student or record does not exist.');
  }
  if (/must conform to/i.test(raw) || /Couldn't coerce|Found .* for field/i.test(raw)) {
    return new AppError(400, 'E_VALIDATION', 'A value was rejected by the database schema.', raw);
  }
  if (/conflict|can be retried|read or write conflict/i.test(raw)) {
    return new AppError(409, 'E_CONFLICT', 'Another change touched the same records at the same time. Please retry.');
  }
  return err;
}
