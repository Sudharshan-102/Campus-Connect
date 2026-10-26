import { Surreal } from 'surrealdb';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, isEmbedded } from './config.js';
import { mapDbError } from './errors.js';
import { plain } from './util.js';

let db;
const here = path.dirname(fileURLToPath(import.meta.url));

/** Connect once and reuse. Remote servers reconnect automatically (SDK option). */
export async function connectDb() {
  if (db) return db;
  const { url, user, pass, namespace, database } = config.surreal;

  if (isEmbedded()) {
    const { createNodeEngines } = await import('@surrealdb/node');
    db = new Surreal({ engines: createNodeEngines() });
    await db.connect(url);
  } else {
    db = new Surreal();
    await db.connect(url, {
      namespace,
      database,
      authentication: { username: user, password: pass },
      reconnect: true,
    });
  }
  await db.use({ namespace, database });
  return db;
}

export const getDb = () => {
  if (!db) throw new Error('Database not connected yet');
  return db;
};

export async function closeDb() {
  if (db) await db.close();
  db = undefined;
}

/** Create/refresh every table, field, index and function (idempotent). */
export async function applySchema() {
  const surql = await readFile(path.join(here, 'schema.surql'), 'utf8');
  await getDb().query(surql).collect();
}

/**
 * Run SurrealQL and return one result per statement as plain JSON data.
 * Errors from the database are translated into AppError instances.
 */
export async function run(surql, vars = {}) {
  try {
    const res = await getDb().query(surql, vars).collect();
    return plain(res);
  } catch (e) {
    throw mapDbError(e);
  }
}

/** Convenience: run and return the result of the LAST statement. */
export async function runLast(surql, vars = {}) {
  const res = await run(surql, vars);
  return res[res.length - 1];
}

/**
 * Run statements as ONE atomic SurrealDB transaction:
 *
 *     BEGIN TRANSACTION;  <body>  COMMIT TRANSACTION;
 *
 * If any statement fails (including a THROW), SurrealDB cancels the whole
 * transaction and nothing is written. `body` must end with a RETURN statement;
 * its value is what this function returns.
 */
export async function runTx(body, vars = {}) {
  const res = await run(`BEGIN TRANSACTION;\n${body}\nCOMMIT TRANSACTION;`, vars);
  // result array = [BEGIN, ...body statements..., COMMIT]; the RETURN is just before COMMIT
  return res[res.length - 2];
}
