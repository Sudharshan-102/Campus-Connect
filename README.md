# Campus Connect

**A real-time, graph-powered student relationship and mentorship network built on SurrealDB.**
DBMS case study: graph data model only, one database (SurrealDB), with graph CRUD, native graph traversal,
atomic mentorship transactions and live (real-time) graph updates.

```
React + Vite + Cytoscape  ←— REST + Server-Sent Events —→  Express API  ←— WebSocket (SDK) —→  SurrealDB
        (browser)                                           (Node.js)                      graph + LIVE SELECT
```

The browser never talks to the database and never sees credentials.

---

## 1. Quick start (Windows)

You need **Node.js 20 or newer** (`node -v`). Open **two** Command Prompt windows.

### Option A (recommended): real SurrealDB server

1. Install SurrealDB (https://surrealdb.com/install) and check `surreal version`.
2. Window 1, start the database:
   ```
   surreal start --user root --pass root --bind 127.0.0.1:8000 memory
   ```
   (If your version complains about the flags, run `surreal start --help`. The API only needs a WebSocket URL, username and password.)
3. Window 2, set up and start the API:
   ```
   cd server
   npm install
   copy .env.example .env
   npm run db:check
   npm start
   ```
   `db:check` must print "Connected" and "Query works". The first start seeds the demo data automatically.
4. Window 3, start the website:
   ```
   cd client
   npm install
   npm run dev
   ```
5. Open http://localhost:5173

### Option B: no SurrealDB install (embedded engine from npm)

SurrealDB's own engine also ships as an npm package, so the whole project runs with just Node.
In `server/.env` set `SURREAL_URL=mem://` (data lives in memory and is re-seeded on every start), then `npm start`.
This is exactly how the automated tests below run.

---

## 2. The two-window demo (the main highlight)

1. Open http://localhost:5173 in a normal window and an **Incognito/second browser window**.
   (The "Acting as" choice is stored per tab, so each window can be a different student.)
2. **Window 1** → *Acting as*: **Karthik Raj** (final year, mentor). Open **Graph Explorer**.
3. **Window 2** → *Acting as*: **Neha Pillai** (first year). Open **Mentorship Center**, choose Karthik, topic "Cybersecurity", **Send request**.
4. **Window 1, without refreshing:** a flash "Mentorship request arrived", a toast, and a dashed amber edge appears in the graph. It also shows under *Incoming requests*.
5. Click **💥 Run failing transaction** (Mentorship Center). A failure is forced after both writes and before COMMIT. The page shows before = after, and the request is still *pending*: **rollback proved**.
6. Click **Accept**. The request becomes *accepted* **and** the green mentor → mentee edge is created in one transaction. Window 2 gets "Karthik Raj accepted your mentorship request" and the graph edge turns green live.
7. Optional: in Graph Explorer click a student, drag the **Reach** slider to 2 to reveal friends-of-friends (recursive traversal).
8. **Query Lab** shows the ten graph queries with the exact SurrealQL and live results. **Dashboard → Reset demo data** restores the starting graph.

---

## 3. What is in the graph

| Kind | Table | Direction | Important rules (enforced by the database itself) |
|---|---|---|---|
| Node | `student` | | unique email, department/year validated, skills & interests arrays |
| Edge | `friends_with` | mutual, stored once (smaller id → larger id) | unique pair, no self-friendship |
| Edge | `mentorship_request` | mentee → mentor | statuses pending/accepted/rejected; can only leave *pending*; one open request per pair |
| Edge | `mentors` | mentor → mentee | one **active** mentorship per pair; ended (not deleted) to keep history |
| Edge | `collaborates_with` | mutual, stored once | unique per (pair, project title) |
| Node + edge | `activity` + `involves` | activity → student | the activity feed is part of the graph |

Schema file: `server/src/schema.surql`. Seed data (14 fictional students): `server/src/seed.js`.

Business rule used in the demo: **a mentor must be in a later academic year than the mentee.**

---

## 4. Project layout

```
campus-connect/
├─ server/
│  ├─ src/schema.surql         graph schema, constraints, stored function
│  ├─ src/seed.js              repeatable demo data (npm run seed)
│  ├─ src/services/            students, friendships, mentorship (the transaction!), collaborations, graph + the 10 queries
│  ├─ src/live.js              LIVE SELECT subscriptions → Server-Sent Events
│  ├─ src/routes/index.js      REST endpoints
│  └─ test/api.test.mjs        15 integration tests (npm test)
├─ client/                     React + Vite + Cytoscape.js
└─ docs/                       ARCHITECTURE.md, QUERIES.md, VIVA.md, screenshots/
```

## 5. API summary

`GET/POST /api/students`, `GET/PUT/DELETE /api/students/:id` · `GET /api/students/:id/{friends,mentors,connections,network?depth=}` ·
`GET /api/graph`, `GET /api/connections` · `POST/PUT/DELETE /api/friendships` · `POST/GET /api/mentorship-requests`, `POST …/:id/accept|reject|rollback-demo`, `DELETE …/:id` ·
`GET /api/mentorships`, `PUT /api/mentorships/:id/end`, `DELETE /api/mentorships/:id` · `POST/PUT/DELETE /api/collaborations` ·
`GET /api/queries`, `GET /api/queries/:id` · `GET /api/dashboard/stats`, `GET /api/activity` · `GET /api/events` (live stream).

Responses are always `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

## 6. Tests

```
cd server
npm test
```
15 tests run against a real SurrealDB engine and the real Express app: CRUD, duplicate/self/invalid-state rules,
**atomic accept**, **forced-failure rollback**, **four simultaneous accepts → exactly one mentorship**, all ten queries, live events, no orphan edges on delete.

## 7. Honest notes and limits

- **Demo identity, not real login.** "Acting as" sends an `X-Demo-User` header. The server never takes the acting student from the request body and checks it against the data (only the named mentor can accept a request; only the sender can cancel, etc.). Production would use SurrealDB record access / JWT sign-in. Destructive actions also need an explicit confirmation header.
- **What was verified where:** everything (schema, transactions, live queries, API, UI) was tested on SurrealDB **3.3.4 via the embedded engine** with the JS SDK 2.1.1. The only code path not exercised here is the WebSocket connection to a *standalone* `surreal start` server (`db.js`, a few lines using the SDK's documented `connect` options). `npm run db:check` verifies it on your machine in seconds.
- Live updates reach browsers through Server-Sent Events from the Express server (which holds the SurrealDB `LIVE SELECT` subscriptions). That keeps credentials out of the browser.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `db:check` fails | Is `surreal start` still running? Do `SURREAL_URL/USER/PASS` in `server/.env` match? Or use Option B (`mem://`). |
| Website shows "Cannot reach the API" | Start the API first (`npm start` in `server`), port 4000 must be free. |
| "Reconnecting…" pill | The API stopped; restart it. The page reconnects by itself. |
| Want a clean demo | Dashboard → *Reset demo data*, or `npm run seed` in `server`. |
