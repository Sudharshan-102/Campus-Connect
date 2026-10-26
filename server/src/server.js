import { config } from './config.js';
import { connectDb, applySchema, run, closeDb } from './db.js';
import { seedDemoData } from './seed.js';
import { startLive, stopLive } from './live.js';
import { createApp } from './app.js';

async function main() {
  console.log(`Connecting to SurrealDB at ${config.surreal.url} ...`);
  const db = await connectDb();
  console.log('Connected:', JSON.stringify(await db.version()));

  await applySchema();
  const [rows] = await run('SELECT VALUE id FROM student LIMIT 1;');
  if (rows.length === 0 && config.autoSeed) {
    console.log('Empty graph: seeding demo data ...');
    console.log('Seeded:', await seedDemoData());
  }

  await startLive();
  console.log('Live queries running on: student, friends_with, mentorship_request, mentors, collaborates_with, activity');

  const server = createApp().listen(config.port, () => {
    console.log(`Campus Connect API ready on http://localhost:${config.port}/api`);
  });

  const shutdown = async () => {
    console.log('\nShutting down ...');
    server.close();
    await stopLive();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('\nCould not start the API:', e.message);
  console.error('Check that SurrealDB is running and your .env values are correct (try: npm run db:check).');
  process.exit(1);
});
