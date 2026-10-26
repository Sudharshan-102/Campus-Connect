// "npm run db:check": quick proof that the API can talk to SurrealDB.
import { config } from './config.js';
import { connectDb, run, closeDb } from './db.js';

try {
  console.log(`Connecting to ${config.surreal.url} (ns=${config.surreal.namespace}, db=${config.surreal.database}) ...`);
  const db = await connectDb();
  console.log('Connected. Server version:', JSON.stringify(await db.version()));
  const [row] = await run('RETURN { ok: true, now: time::now() };');
  console.log('Query works:', JSON.stringify(row));
  await closeDb();
  console.log('\nAll good. You can run: npm run seed  and  npm start');
} catch (e) {
  console.error('\nFAILED:', e.message);
  console.error('Is SurrealDB running? Are SURREAL_URL / SURREAL_USER / SURREAL_PASS in .env correct?');
  process.exit(1);
}
