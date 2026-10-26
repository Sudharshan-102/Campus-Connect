# Architecture

## System

```
┌──────────────────────┐     REST (JSON)      ┌────────────────────────┐    WebSocket (SurrealDB JS SDK)    ┌───────────────────────┐
│  React + Vite        │ ───────────────────► │  Express API (Node.js) │ ─────────────────────────────────► │  SurrealDB            │
│  Cytoscape.js graph  │                      │  validation, services, │   queries, BEGIN…COMMIT, LIVE SELECT│  graph tables (nodes  │
│                      │ ◄─────────────────── │  error mapping         │ ◄───────────────────────────────── │  + relation tables)   │
└──────────────────────┘  Server-Sent Events  └────────────────────────┘      live notifications            └───────────────────────┘
        (no DB credentials here)                (holds credentials in .env)
```

Only SurrealDB stores data. The API has no cache and no second database.

## Graph model

```
                    friends_with  (mutual)
          ┌───────────────────────────────────────┐
          │                                       │
      ┌───▼────┐   mentorship_request (pending)  ┌┴───────┐
      │student │ ──────────────────────────────► │student │
      │(mentee)│                                  │(mentor)│
      └───┬────┘   mentors (active, after accept) └───┬────┘
          │  ◄─────────────────────────────────────────┘
          │      collaborates_with (mutual, project title)
          └──────────────────────────────────────────► student
 activity ──involves──► student      (the activity feed is also graph data)
```

* `RELATE a->mentorship_request->b` : pending request (mentee a asks mentor b)
* `RELATE b->mentors->a` : created when b accepts; **directional**, so mentor and mentee are distinguishable
* `friends_with` and `collaborates_with` are mutual, so each is stored once with the smaller record id as `in`. A schema ASSERT (`out > in`) plus a UNIQUE index make a duplicate logical friendship impossible.

## The atomic mentorship acceptance

```
BEGIN TRANSACTION
  1. SELECT the request  → not found / not yours / not pending ⇒ THROW
  2. check students exist, not self, mentor senior, no active mentorship ⇒ THROW
  3. UPDATE request SET status='accepted'          ┐  both writes happen inside
  4. RELATE mentor->mentors->mentee                ┘  the transaction, invisible to others
  5. fn::log_activity(...)                            activity node + involves edges
COMMIT TRANSACTION        (any THROW / failed constraint before this ⇒ everything discarded)
```

Source: `ACCEPT_TRANSACTION` in `server/src/services/mentorship.js`.
The same text is shown in the app (Mentorship Center → "Show the real SurrealQL").

Defence in depth: even if application code were wrong, the database still refuses
(a) a second active mentorship for the same pair (UNIQUE index on the computed `active_key`),
(b) a second open request for the same pair (UNIQUE index on computed `open_key`),
(c) moving a request out of a finished state (`$before` check in the field ASSERT),
(d) self-links (ASSERT `out != in`).

## Real-time path

```
any client changes data ─► SurrealDB ─► LIVE SELECT on 6 tables ─► Express (managed live subscriptions)
                                                                        │ de-duplicate, number events (seq)
                                                                        ▼
                                           Server-Sent Events  /api/events  ─► every open browser tab
                                                                        │ ring buffer replays missed events on reconnect
                                                                        ▼
                                  React: toast + refetch the affected page; Cytoscape adds/animates the new edge
```

* Subscribed tables: `student, friends_with, mentorship_request, mentors, collaborates_with, activity` (live queries target tables, not traversal paths).
* Reconnects: the SDK's `live()` subscriptions are *managed* (re-registered after a reconnect); the browser's EventSource reconnects automatically and the server replays events after `Last-Event-ID`.
* Duplicates: server drops identical events within 1.5 s; the browser ignores sequence numbers it has already seen.
* A rejected or rolled-back action writes nothing, so it produces **no** live event (tested).
