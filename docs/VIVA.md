# Campus Connect — Viva Preparation Guide

## 1. One-minute pitch
Campus Connect is a student relationship and mentorship network. Students are **nodes**; friendships, mentorships, mentorship requests and collaborations are **edges**. SurrealDB is the only database. The backend is Node.js/Express, the frontend is React + Cytoscape.js, and live updates flow from SurrealDB `LIVE SELECT` through an Express hub to the browser.

## 2. Why a graph model?
The domain is about *who is connected to whom*. Questions such as "friends of friends", "mentorship chains" and "who shares skills with my mentor" are traversals. In a graph database they are one-hop-per-arrow (`->mentors->student`); in a relational database each hop is a JOIN.

## 3. Schema summary
| Table | Kind | Purpose |
|---|---|---|
| `student` | node | profile, year, department, skills, interests |
| `friends_with` | edge (student→student) | undirected friendship stored once in canonical direction |
| `mentorship_request` | edge | pending/accepted/rejected/cancelled request, mentor ← mentee |
| `mentors` | edge | active/ended mentorship created on acceptance |
| `collaborates_with` | edge | project collaborations |
| `activity` + `involves` | node + edge | audit/activity feed |
| `fn::log_activity` | function | writes activity inside the same transaction |

Constraints: `TYPE RELATION IN x OUT y ENFORCED`, `SCHEMAFULL`, ASSERTs (no self edge, mentor year > mentee year), UNIQUE indexes on computed keys (`open_key`, `active_key`) so there is at most one open request and one active mentorship per pair.

## 4. ACID — mapped to this project
- **Atomicity**: accepting a request does 5 things in one `BEGIN … COMMIT` block: check request is pending and belongs to the actor, mark it accepted, create the `mentors` edge, log activity, return the result. If any step throws, none persist. The **Rollback demo** in the Mentorship Center throws `E_SIMULATED` after the edge is created and shows the edge was *not* kept.
- **Consistency**: schema types, ASSERTs, `ENFORCED` relations and unique computed-key indexes make invalid states (duplicate request, self-friendship, junior mentoring senior) impossible, even if the API is bypassed.
- **Isolation**: two concurrent accepts of the same request — tested — produce exactly one mentorship; the loser gets `E_CONFLICT` or `E_ALREADY_PROCESSED`.
- **Durability**: with `surrealkv://` or a standalone server with file storage, committed data survives restart. (`mem://` is for demos/tests only and is *not* durable.)

## 5. Graph vs Document vs Relational (conceptual)
| Aspect | Relational | Document | Graph (this project) |
|---|---|---|---|
| Relationships | Foreign keys + join tables | Embedded arrays or references | First-class edges with their own fields |
| Multi-hop queries | Nested JOINs / recursive CTEs | Application-side lookups | Arrow traversal, recursive paths |
| Edge attributes | Extra columns on join table | Awkward | Natural (status, since, role) |
| Schema evolution | Migrations | Flexible | Flexible or schemafull per table |
| Best for | Tabular, aggregate reporting | Self-contained records | Connected data |

SurrealDB is multi-model: documents + graph edges + SQL-like syntax, so we get record flexibility *and* traversals in one engine.

## 6. Honest comparison with Neo4j
- Neo4j is a mature, graph-only database with Cypher, a large ecosystem, graph algorithms (GDS: PageRank, community detection), and very deep traversal optimizations.
- SurrealDB is younger, with a smaller ecosystem, but is multi-model, has built-in live queries, permissions, and embeds into Node.
- For this project (14 students, shallow traversals) either would work; we do not claim a performance advantage. We chose SurrealDB because the assignment requires it, and because live queries and transactions are built in.
- Neo4j would be the better choice for large-scale graph analytics.

## 7. Likely viva questions
**Q: How is a friendship stored?** One edge in `friends_with`, canonical direction enforced by an ASSERT so (A,B) and (B,A) can't both exist; queries use `<->` to ignore direction.

**Q: How do you prevent duplicate pending requests?** A computed field `open_key` is set only while `status='pending'`, and a UNIQUE index on it blocks a second one.

**Q: How does real-time work?** Server opens `LIVE SELECT` on 6 tables via the SDK; the hub dedupes, numbers events and pushes SSE; React `useLiveData` refetches/patches and animates new graph elements. Last-Event-ID replay covers short reconnects.

**Q: Why SSE rather than WebSocket to the browser?** One-way push is enough, auto-reconnect is built in, and it works through the Vite proxy.

**Q: Show a rollback.** Mentorship Center → Rollback demo → the edge appears inside the transaction and disappears after the throw; the request stays pending.

**Q: What is `fn::log_activity` for?** Reusable server-side function so activity logging happens inside the same transaction as the change.

**Q: Where are the 10 traversal queries?** `server/src/services/graph.js` (`QUERIES`), runnable in the **Query Lab** page; outputs recorded in `docs/QUERIES.md`.

**Q: Is there authentication?** No — a demo identity header (`X-Demo-User`) selects the acting student. Production would need real auth and SurrealDB record-level permissions.

## 8. Advantages
Natural modelling of relationships; constraints enforced in the DB; transactions; live queries; single database; simple traversal syntax.

## 9. Limitations (be upfront)
- Demo identity, no real authentication/authorization.
- Tested against the embedded SurrealDB engine; the standalone-server WebSocket path is verified with `npm run db:check`.
- Live queries are bridged via SSE through one server process; multi-instance scaling would need a shared bus.
- Small dataset; no performance benchmarking.
- Recursive traversal depth is capped for safety.
- Younger ecosystem than Neo4j, fewer graph-analytics tools.

## 10. Future work
Real auth + record-level permissions, recommendation scoring (shared skills, mutual friends), graph analytics (centrality), notifications, mentor availability slots, pagination for large graphs, SurrealDB full-text search, deployment with TLS.

## 11. Screenshots
See `docs/screenshots/` (dashboard, directory, profile, graph explorer, mentorship center, rollback, activity, query lab).
