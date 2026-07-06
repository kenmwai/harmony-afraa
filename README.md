# HARMONY — AFRAA UPR Trial Platform

Developer handover document. This README is aimed at the next engineer taking
the project forward and focuses on **what to optimise**, **how the system is
wired**, and **the known gaps** (including rate limiting).

---

## 1. Stack

- **Framework:** TanStack Start v1 (React 19, Vite 7, SSR on Cloudflare Workers)
- **Styling:** Tailwind CSS v4 (via `src/styles.css`) + shadcn/ui
- **Backend:** Lovable Cloud (managed Supabase) — Postgres + Auth + Storage
- **Server logic:** `createServerFn` (RPC) in `src/lib/*.functions.ts`
- **Data fetching:** TanStack Query (loader → `ensureQueryData` → `useSuspenseQuery`)
- **Package manager:** `bun`

Runtime constraint: server code runs in **Cloudflare workerd** with
`nodejs_compat`. No `child_process`, no `sharp/canvas/puppeteer`, no native
addons. Bundle everything at build time.

---

## 2. Repository layout

```
src/
  routes/                 # File-based routes
    __root.tsx            # Root layout, head metadata, auth listener
    index.tsx             # Home / dashboard (large — see §5)
    auth.tsx              # Sign-in / sign-up
    reset-password.tsx
    _authenticated/       # (managed) gated subtree
  components/
    FlightReports.tsx
    TrialAndIncidents.tsx
    ui/                   # shadcn primitives
  lib/
    admin-users.functions.ts   # Server fns (admin ops)
    upr-storage.ts             # Storage helpers for upr-attachments bucket
    upr-types.ts
    config.server.ts
  integrations/supabase/       # AUTO-GENERATED — do not edit
supabase/
  migrations/                  # All schema + policy history
  config.toml                  # AUTO-GENERATED
```

**Never edit**: `src/integrations/supabase/*`, `src/routeTree.gen.ts`,
`supabase/config.toml`, `.env`.

---

## 3. Data model (public schema)

| Table            | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `profiles`       | 1:1 with `auth.users`; approval workflow       |
| `user_roles`     | `airline` / `ansp` / `admin` / `regulator`     |
| `airlines`       | Registered airline codes                       |
| `firs`           | Flight Information Regions                     |
| `aircraft_types` | Burn-rate reference data                       |
| `uprs`           | User Preferred Routes (the core entity)        |
| `segments`       | FIR-by-FIR segments of a UPR                   |
| `trial_schedules`| Scheduled trial windows                        |
| `flight_reports` | Post-flight reports (airline + ANSP)           |
| `incidents`      | Incident reports attached to a UPR             |
| `chat_messages`  | Per-UPR chat                                   |
| `broadcasts`     | Global broadcasts                              |

Role checks go through `public.has_role(uid, role)` (SECURITY DEFINER, stable).
Scope lookups use `public.user_scope(uid, role)`.

### Author-identity enforcement

`chat_messages`, `broadcasts`, `incidents`, `flight_reports` have a
`BEFORE INSERT OR UPDATE` trigger (`enforce_author_identity`) that overwrites
client-supplied `author`, `author_label`, `author_role`, `party`, and
`party_scope` with values derived from `auth.uid()` + `user_roles`. Do **not**
rely on client-sent identity fields — they are always replaced.

### Profile self-escalation guard

`profiles` has a `BEFORE UPDATE` trigger (`prevent_profile_self_escalation`)
that blocks non-admins from changing `approved`, `requested_role`,
`requested_scope`, `email`, `rejected*`, or `id` on their own row.

---

## 4. Auth & routing rules

- The managed `_authenticated/` layout uses `ssr: false` and gates the subtree
  client-side via `supabase.auth.getUser()`. Do not recreate this gate on
  top-level SSR routes.
- Public routes must **not** call server functions that use
  `requireSupabaseAuth` from their loader — SSR/prerender has no bearer and
  the build will fail with `Unauthorized`. Call from the component via
  `useServerFn` + `useQuery`.
- Google/Apple/Microsoft OAuth must go through `lovable.auth.signInWithOAuth`
  with `redirect_uri = window.location.origin` (a public URL). Never point
  `redirect_uri` at a protected route.

---

## 5. Known optimisation targets

### 5.1 `src/routes/index.tsx` is doing too much
The home route contains the admin approval UI, dashboard content, and query
wiring in one file. **Suggested refactor:**
- Extract the pending-accounts panel into `src/components/admin/PendingAccounts.tsx`.
- Move each admin query into `src/lib/admin-*.functions.ts` and use
  `useSuspenseQuery` with a shared `queryOptions`.
- Split airline / ANSP / admin dashboards behind route boundaries under
  `_authenticated/` so bundles code-split naturally.

### 5.2 Query cache invalidation is coarse
`onAuthStateChange` in `__root.tsx` calls `queryClient.invalidateQueries()` on
every identity transition. Scope invalidations by `queryKey` prefix
(`['profiles']`, `['uprs']`, …) to avoid refetch storms on token refresh.

### 5.3 Storage uploads (`upr-attachments`)
- The bucket is private. Every read goes through `createSignedUrl`. Cache
  signed URLs client-side for their lifetime (default 60s → bump to 5–10 min
  for read-heavy pages) to cut round-trips.
- Validate MIME type and size **server-side** before issuing an upload URL;
  today validation is client-only in `src/lib/upr-storage.ts`.

### 5.4 Database indexes to add
Run `supabase--slow_queries` after real traffic, but likely wins:
- `segments (upr_id, order_idx)` — already implied by PK usage, verify.
- `flight_reports (upr_id, created_at DESC)` for report timelines.
- `incidents (upr_id, created_at DESC)`.
- `chat_messages (upr_id, created_at DESC)` for pagination.
- `user_roles (user_id, role)` if not present — hot path via `has_role`.

### 5.5 Realtime
If the chat/broadcasts panels grow, subscribe with `supabase.channel(...)`
scoped to the current UPR rather than polling with `useQuery` intervals.

### 5.6 SSR head metadata
Only `__root.tsx` sets head metadata today. Give `auth.tsx`,
`reset-password.tsx`, and any future public route their own `head()` with
route-specific `<title>` / `og:*` for shareable links.

### 5.7 Bundle
- Audit `src/components/ui/*` — only the shadcn primitives actually used
  should ship; unused ones can be deleted.
- Icons: import individual `lucide-react` icons, not the whole set (already
  the case in most files — enforce with an ESLint rule).

### 5.8 Type safety
`src/integrations/supabase/types.ts` regenerates on every migration. Prefer
`Database['public']['Tables']['<t>']['Row']` over hand-written interfaces so
schema changes surface at compile time.

---

## 6. Rate limiting (KNOWN GAP)

> **There is no rate-limiting primitive in this stack today.** The Lovable
> Cloud backend does not ship one, and Cloudflare Workers rate limiting is
> not configured for this project.

**Impact:** `createServerFn` endpoints, the `/api/public/*` routes (none
today, but the layer is available), and `supabase.auth.*` calls are limited
only by Supabase's own defaults.

**Recommended options for the next developer, in order of preference:**

1. **Cloudflare Rate Limiting bindings** (best fit — same runtime).
   Wire a `RATE_LIMITER` binding and check it at the top of each server
   function / API route. Requires access to the Cloudflare account.

2. **Upstash Redis** (`@upstash/ratelimit`) called from server functions.
   HTTP-based, works from workerd, sliding-window primitives out of the box.
   Adds one external secret (`UPSTASH_REDIS_REST_URL`, `..._TOKEN`).

3. **Postgres-backed limiter** (no new infra). Add a
   `public.rate_limit_events(user_id, bucket, occurred_at)` table with an
   index on `(user_id, bucket, occurred_at DESC)`, and a
   `SECURITY DEFINER` function `public.check_rate_limit(bucket, max, window)`
   that inserts a row and raises when the count exceeds `max`. Call it as
   the first line of each protected server function. Trade-off: adds write
   load to Postgres and is only accurate to the second.

Whichever route is chosen, apply limits to:
- `auth` (sign-in, sign-up, password reset) — per-IP.
- `admin-users.functions.ts` — per-admin.
- Any future `/api/public/*` webhook — per-IP + signature verification.
- File upload URL issuance — per-user.

Until then, keep Supabase's built-in auth throttling enabled and monitor
the analytics dashboard for abuse.

---

## 7. Local development

```bash
bun install
bun run dev          # Vite dev server on :8080
```

Environment variables are managed by Lovable Cloud and injected at build
time. `process.env.*` is server-only; `import.meta.env.VITE_*` is client.

### Migrations

Every schema change goes through a SQL file in `supabase/migrations/`. New
`public` tables **must** include `GRANT` statements in the same migration
(the Data API grants nothing by default). Pattern:

```sql
CREATE TABLE public.<name>(...);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<name> TO authenticated;
GRANT ALL ON public.<name> TO service_role;
ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;
CREATE POLICY ... ;
```

### Data seeding
Seed/demo data belongs in a migration, not a server function. There is no
unauthenticated seeding endpoint by design.

---

## 8. Security posture (as of handover)

- RLS enabled on every table in `public`.
- All `SECURITY DEFINER` helper functions have `EXECUTE` revoked from
  `PUBLIC`/`anon` and granted only to `authenticated` where appropriate.
- Author identity and profile self-escalation are enforced by triggers
  (see §3), so RLS policy drift alone cannot re-open those vectors.
- The `upr-attachments` bucket is private; all access via signed URLs.
- Admin bootstrap: the first admin claims via `claim_first_admin()`, which
  is hard-coded to a single email. Change this before onboarding other
  admins.

Run `supabase--linter` and the security scanner regularly. Both are wired
into the Lovable workspace.

---

## 9. Contact / ownership

- Product owner: AFRAA
- Codebase: HARMONY (`harmony-afraa.lovable.app`)
- Cloud tenancy: Lovable Cloud (managed)

Good luck. Start with §5.1 and §6 — those give the highest immediate return.
