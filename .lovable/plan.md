# Scalability Audit — Harmony by AFRAA

## Verdict
The schema and security model are sound, but the **client/realtime data layer will not survive ~100 concurrent users, let alone 1000+**. The platform crashes before the database does. With the fixes below, the same backend comfortably handles thousands of users.

## Where it will break (ranked)

### 1. Every realtime event triggers a full re-download of the entire dataset *(critical)*
`src/routes/index.tsx` `refetch()` runs 6 `SELECT *` queries with no filter and no limit on every change to **uprs, segments, chat_messages, broadcasts, trial_schedules, flight_reports**. With 1000 users producing chat/segment updates, every user's browser refetches the whole network on every keystroke. Network and memory blow up quadratically.

### 2. Realtime publication is global, not scoped
All 6 tables broadcast every change to every authenticated subscriber. A single chat message fans out to 1000 sockets. Also flagged by the scanner: `realtime.messages` has no RLS, so any signed-in user can subscribe to arbitrary channels.

### 3. No indexes on RLS join / filter columns
Every RLS policy runs `EXISTS (SELECT 1 FROM uprs u WHERE u.id = …)`, `segments.upr_id = …`, `user_scope(auth.uid(),'ansp')`, etc. The only indexes today are primary keys. At a few thousand UPRs and tens of thousands of segments/reports/messages, every query degrades to a seq scan inside RLS.

### 4. No pagination, no result caps
`select("*")` everywhere. UPR list, chat history, flight reports, schedules — all unbounded. A year of trials produces tens of thousands of rows that get shipped to every browser.

### 5. Aggregated PDF report builds in the browser from full dataset
`exportAggregatedReport` iterates every flight report client-side; OK at 100 rows, OOM at 50k. Belongs on the server with streaming/pagination.

### 6. Storage signed URLs requested one-by-one
Incident image gallery calls `createSignedUrl` per image sequentially. At 10 images × 100 concurrent viewers = 1000 round trips.

### 7. Auth state listener + full refetch
`onAuthStateChange` fires on `TOKEN_REFRESHED` (~hourly) and on every tab focus. Currently it does not refetch, but route invalidation patterns elsewhere can amplify (1).

### 8. Single monolithic route
`src/routes/index.tsx` is 1231 lines holding all four role dashboards. Ships ~all code to every user on first load; not fatal but hurts cold-start at scale.

## Plan (apply in this order)

### Phase 1 — Database indexes (migration, zero downtime)
Add B-tree indexes on every RLS / FK / sort column:
- `uprs(created_by)`, `uprs(airline_code)`, `uprs(created_at desc)`
- `segments(upr_id)`, `segments(fir_code)`, `segments(upr_id, order_idx)`
- `chat_messages(upr_id, created_at)`
- `flight_reports(upr_id, created_at desc)`
- `trial_schedules(upr_id, start_at)`
- `incidents(upr_id)`
- `user_roles(user_id)`, `user_roles(role, scope)`
- `broadcasts(created_at desc)`
- `profiles(approved)` partial WHERE NOT approved

### Phase 2 — Scoped, paginated fetches
Replace the six unfiltered `SELECT *` calls with per-role scoped queries:
- Airline: only their own UPRs (`airline_code = scope`), and segments/chat/reports/schedules joined on those UPR ids.
- ANSP: only UPRs that have a segment in their FIR.
- Admin/regulator: paginated lists (50 per page, ordered by `created_at desc`) with explicit `range()`.
- Chat: load last 100 messages per active UPR, lazy-load older on scroll.
- Broadcasts: last 50.

### Phase 3 — Targeted realtime
- Subscribe per active UPR (`chat_messages` filtered by `upr_id=eq.${activeId}`, `segments` filtered the same way) instead of every table globally.
- Apply incremental state updates (insert/update/delete handlers) instead of full `refetch()`.
- For dashboards, poll-on-focus + lightweight `uprs` channel filtered by scope; no global subscription.
- Lock down `realtime.messages` with RLS so subscribers can only join topics they own.

### Phase 4 — Server-side aggregation
- Move `exportAggregatedReport` behind a `createServerFn` that streams report rows in pages and returns a precomputed summary (totals, per-stage breakdown). PDF still rendered client-side from the summary + paginated detail.
- Add server fn `getNetworkStats()` returning the dashboard KPIs without shipping raw rows.

### Phase 5 — Storage perf
- Batch signed URLs: one server fn `signImagePaths(paths[])` returning all URLs in a single round trip.
- Cache signed URLs in component state for their 1h lifetime.

### Phase 6 — Code splitting
- Split `src/routes/index.tsx` into four lazily-loaded role views (`AirlineView`, `ANSPView`, `AdminView`, `RegulatorView`) via `React.lazy` so each user downloads ~25% of the bundle.

### Phase 7 — Operational guardrails
- Add `LIMIT 1000` to every list query (defense in depth).
- Wrap fetches in TanStack Query with stale-time + dedupe so multi-tab users share cache.
- Recommend upgrading Lovable Cloud instance once concurrent users exceed ~200 (Backend → Advanced settings → Upgrade instance).

## What I will implement now
Phases 1, 2, 3, 5, 6 in one batch — these are the changes that prevent the platform from crashing. Phases 4 and 7 follow once you confirm the scoped data model behaves as expected for each role.

## Out of scope
- Custom CDN / image resizing pipeline (use Lovable Cloud Storage + signed URLs).
- Horizontal sharding — not needed until ~100k UPRs.

Approve to proceed with Phases 1–3, 5, 6.
