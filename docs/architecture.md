# Architecture

## Stack

- **Frontend:** Vite 8 + React 19 (SPA, TypeScript). Routing via
  `react-router-dom`. Styling via Tailwind 4. Forms via
  `react-hook-form` + `zod`.
- **PWA:** `vite-plugin-pwa` in **injectManifest** mode — `src/sw.ts`
  is the real service worker (precache + Supabase runtime cache + push
  + notificationclick).
- **Backend / DB:** Supabase (Postgres 15, Auth, RLS). No custom
  server for the main app — the frontend talks to PostgREST directly.
- **Hosting:** Cloudflare Workers, assets-only. See
  [deployment.md](./deployment.md).
- **Scheduled jobs:** One Cloudflare Worker in `workers/push/` runs a
  daily cron for reminders. See
  [push-notifications.md](./push-notifications.md).

## Directory layout

```
src/
  App.tsx                 Route table (browser-side)
  main.tsx                React entry + SW registration
  sw.ts                   Service worker (injectManifest target)
  lib/
    supabase.ts           Singleton supabase client
    events.ts             EO_dives / EO_courses → AppEvent normalization
    calendar-layout.ts    Multi-day bar track-stacking
    push.ts               Web Push enrollment (subscribe/unsubscribe)
    push-reminders.ts     Pure reminder-selection logic (shared with worker)
  hooks/useAuth.ts        Session + profile subscription
  pages/
    CalendarPage.tsx      Diver calendar + register flow entry
    BookingsPage.tsx      Diver's own bookings (upcoming / past)
    PaymentsPage.tsx      Diver's own payment status
    ProfilePage.tsx       Editable profile + push-notification toggle
    LoginPage.tsx / SignupPage.tsx
    admin/
      AdminDashboard.tsx
      AdminEventsPage.tsx
      AdminEventDetailPage.tsx
      AdminUsersPage.tsx
  components/
    layout/
      AppShell.tsx        Diver shell (top bar + bottom nav)
      AdminShell.tsx      Admin shell (separate nav, "view as diver" toggle)
      ProtectedRoute.tsx  Gates on session
      AdminRoute.tsx      Gates on profile.role === 'admin'
    register/
      RegisterForm.tsx    3-step booking wizard
    admin/
      EventMemos.tsx      Staff-visible flags per event
  types/database.ts       Hand-maintained Supabase Database type

supabase/migrations/      Forward-only SQL migrations
workers/push/             Cloudflare Worker cron sender
tests/
  setup.unit.ts           Stubs VITE_* env for unit tests
  setup.integration.ts    Loads local stack's SERVICE_ROLE / API_URL
  test-utils.tsx          renderWithRouter, mockQueryBuilder
  integration/            Live-DB tests (requires `make start`)
scripts/
  verify-sync.sh          Compare local vs cloud schema + row counts
```

## Runtime boundaries

```
┌───────────── Browser (PWA) ─────────────┐
│ React SPA  ←→  Service Worker (sw.js)   │
└───────┬─────────────────┬───────────────┘
        │ supabase-js     │ Web Push endpoint (push service)
        ↓                 ↑
┌───────────── Supabase ─────────────┐    ┌────── Cloudflare Worker ───────┐
│ Postgres + PostgREST + Auth + RLS  │←───│ workers/push (daily cron)      │
└────────────────────────────────────┘    │ service_role_key → DB queries  │
                                          │ VAPID priv key → web-push send │
                                          └────────────────────────────────┘
```

**Three places code runs:**

1. **Browser (SPA + SW).** All diver-facing features. Auth via the
   user's access token; PostgREST + RLS enforce row access.
2. **Cloudflare Worker** (`app-fundiverstw`). Static asset server for
   the SPA. No custom fetch handler today.
3. **Cloudflare Worker** (`fundivers-push`). Scheduled cron. Uses the
   Supabase service-role key (bypasses RLS) because it needs to read
   every user's pending reminders and write the ledger.

## Why this shape

- **No custom app server.** PostgREST + RLS covers all CRUD; we avoid
  a whole runtime. RLS policies in migrations are the source of truth
  for authorization.
- **EO\_\* tables are legacy Bubble-imported** catalog data (dives,
  courses, prices, rooms, addons). They use text `_id` columns and
  text date/time columns because that's what Bubble emits. Treat them
  as read-mostly data the app normalizes through `src/lib/events.ts`.
- **injectManifest, not generateSW.** We need a custom `push` event
  handler, which `generateSW` doesn't support.
