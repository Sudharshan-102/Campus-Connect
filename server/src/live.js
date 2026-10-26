// Real-time layer.
//
//   SurrealDB  --LIVE SELECT (WebSocket, via the SDK)-->  this process  --SSE-->  browsers
//
// We subscribe to the NODE and EDGE tables themselves (live queries target
// tables / records, not graph traversal paths). Every INSERT/UPDATE/DELETE that
// any client makes, from any source, shows up here.
import { Table } from 'surrealdb';
import { getDb } from './db.js';
import { plain, ridStr } from './util.js';

export const LIVE_TABLES = ['student', 'friends_with', 'mentorship_request', 'mentors', 'collaborates_with', 'activity'];

const RING = 300; // events kept so a reconnecting browser can catch up
const DEDUPE_MS = 1500;

class Hub {
  clients = new Set();
  beats = new Set();
  seq = 0;
  ring = [];
  recent = new Map(); // dedupe key -> timestamp

  publish(table, msg) {
    const id = ridStr(msg.recordId);
    const value = plain(msg.value) ?? {};
    // Drop exact duplicates (e.g. a subscription restarted after a reconnect).
    const key = `${table}|${msg.action}|${id}|${JSON.stringify(value)}`;
    const now = Date.now();
    if (now - (this.recent.get(key) ?? 0) < DEDUPE_MS) return;
    this.recent.set(key, now);
    if (this.recent.size > 500) for (const [k, t] of this.recent) if (now - t > DEDUPE_MS) this.recent.delete(k);

    const event = { seq: ++this.seq, table, action: msg.action, id, value, at: new Date().toISOString() };
    this.ring.push(event);
    if (this.ring.length > RING) this.ring.shift();
    for (const res of this.clients) this.write(res, event);
  }

  write(res, event) {
    res.write(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
  }

  addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const last = Number(req.get('last-event-id') || req.query.lastEventId || 0);
    // Catch-up for a short disconnect; the browser also de-duplicates by seq.
    if (last) for (const e of this.ring) if (e.seq > last) this.write(res, e);
    res.write(`event: hello\ndata: ${JSON.stringify({ seq: this.seq })}\n\n`);

    this.clients.add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), 20000);
    beat.unref?.(); // never keep the process alive just for a heartbeat
    this.beats.add(beat);
    req.on('close', () => {
      clearInterval(beat);
      this.beats.delete(beat);
      this.clients.delete(res);
    });
  }
}

export const hub = new Hub();
let subs = [];

export async function startLive() {
  const db = getDb();
  for (const table of LIVE_TABLES) {
    // db.live() is a *managed* subscription: the SDK re-registers it after a reconnect.
    const sub = await db.live(new Table(table));
    sub.subscribe((msg) => {
      if (msg.action === 'KILLED') return;
      hub.publish(table, msg);
    });
    subs.push(sub);
  }
}

export async function stopLive() {
  await Promise.allSettled(subs.map((s) => s.kill()));
  subs = [];
  for (const res of hub.clients) res.end();
  hub.clients.clear();
  for (const b of hub.beats) clearInterval(b);
  hub.beats.clear();
}
