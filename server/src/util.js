import { RecordId, DateTime } from 'surrealdb';
import { badRequest } from './errors.js';

const KEY_RE = /^[a-zA-Z0-9_]{1,64}$/;

/** "student:arun" -> RecordId('student','arun'), rejecting anything unexpected. */
export function toRid(table, value, label = 'id') {
  if (typeof value !== 'string') throw badRequest(`${label} must be a string like "${table}:abc"`);
  let key = value.trim();
  if (key.includes(':')) {
    const [t, ...rest] = key.split(':');
    if (t !== table) throw badRequest(`${label} must reference table "${table}"`);
    key = rest.join(':');
  }
  if (!KEY_RE.test(key)) throw badRequest(`${label} is not a valid ${table} id`);
  return new RecordId(table, key);
}

/** RecordId -> "table:key" (no angle brackets). */
export const ridStr = (r) => (r ? `${r.table.name}:${r.id}` : r);

/** Deep-convert SDK value classes into plain JSON-friendly data. */
export function plain(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof RecordId) return ridStr(v);
  if (v instanceof DateTime) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    if (typeof v.toISOString === 'function') return v.toISOString();
    if (v.constructor && v.constructor !== Object && typeof v.toString === 'function' && v.constructor.name === 'Uuid') {
      return v.toString();
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'student';

export const cleanList = (v) => {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const t = String(x).trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t.slice(0, 40));
  }
  return out.slice(0, 20);
};

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
