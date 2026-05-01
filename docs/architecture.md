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
- **Hosting:** Cloudflare Workers, assets-only. The SPA worker is the
  root `wrangler.toml` (`name = "app-fundiverstw"`). See
  [deployment.md](./deployment.md).
- **Scheduled jobs + admin endpoints:** One Cloudflare Worker in
  `workers/push/` runs a daily reminder cron and serves
  `/admin-broadcast`, `/notify-duty`, and `/run` for the SPA. See
  [push-notifications.md](./push-notifications.md).
- **Server-side registration:** A Supabase Edge Function in
  `supabase/functions/create-registration/` handles the atomic
  signUp + profile-update + booking insert + PDF email pipeline for
  the public registration form. Email goes out via Gmail SMTP
  (`nodemailer`).

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
    DashboardPage.tsx     Shared dashboard (rendered at /dashboard for
                          divers and /admin for admins)
    CalendarPage.tsx      Diver calendar + register flow entry
    MapPage.tsx           Dive sites map
    BookingsPage.tsx      Diver's own bookings (upcoming / past)
    PaymentsPage.tsx      Diver's own payment status
    ProfilePage.tsx       Editable profile + push-notification toggle
    DutiesPage.tsx        Staff/admin own-duty list
    RegisterPage.tsx      Public, no-auth registration funnel
    EelSnakePage.tsx      Easter-egg minigame
    LoginPage.tsx / SignupPage.tsx / ForgotPasswordPage.tsx /
    ResetPasswordPage.tsx / TermsPage.tsx
    admin/
      AdminEventsPage.tsx / AdminEventDetailPage.tsx /
      AdminEditEventPage.tsx / AdminNewEventPage.tsx /
      AdminGearMapPage.tsx / AdminUsersPage.tsx /
      AdminDutyPage.tsx / AdminNotificationsPage.tsx /
      AdminManagePage.tsx (catalog landing) +
      AdminRoomsPage / AdminAddonsPage / AdminTravelPage /
      AdminPricesPage  (catalog editors)
  components/
    layout/
      AppShell.tsx           Diver shell (top bar + bottom nav)
      AdminShell.tsx         Admin shell (separate nav, "view as diver" toggle)
      ProtectedRoute.tsx     Gates on session
      AdminRoute.tsx         Gates on profile.role === 'admin'
      StaffOrAdminRoute.tsx  Gates on profile.role IN ('admin','staff')
    register/
      RegisterForm.tsx       3-step booking wizard (used by RegisterPage)
    admin/
      EventMemos.tsx         Staff-visible flags per event
  types/database.ts          Hand-maintained Supabase Database type

supabase/migrations/         Forward-only SQL migrations
supabase/functions/          Supabase Edge Functions (Deno)
  create-registration/       Atomic registration: account + profile +
                             booking + PDF + Gmail SMTP
  _shared/pdf.ts             Registration PDF builder (server-side)
workers/push/                Cloudflare Worker: cron + admin endpoints
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
└───┬───────────┬────────────────┬────────┘
    │supabase-js│ fetch (admin)  │ Web Push endpoint
    ↓           ↓                ↑
┌──────────────────────┐ ┌──────────────────────────────────┐
│ Supabase             │ │ workers/push (Cloudflare)        │
│ Postgres + PostgREST │←│ daily cron + /admin-broadcast +  │
│ Auth + RLS + Edge Fns│ │ /notify-duty + /run              │
│  • create-registration│ │ service_role_key → DB queries    │
└──────────────────────┘ │ VAPID priv key → web-push send   │
                         └──────────────────────────────────┘
```

**Four places code runs:**

1. **Browser (SPA + SW).** All diver-facing features. Auth via the
   user's access token; PostgREST + RLS enforce row access.
2. **Cloudflare Worker** (`app-fundiverstw`). Static asset server for
   the SPA. No custom fetch handler — `[assets]` only.
3. **Cloudflare Worker** (`fundivers-push`). Scheduled cron + admin
   endpoints (`/admin-broadcast`, `/notify-duty`, `/run`). Uses the
   Supabase service-role key (bypasses RLS) for reminder fan-out and
   to look up subscriptions; admin endpoints additionally verify the
   caller's user JWT against `profiles.role`.
4. **Supabase Edge Function** (`create-registration`). Public POST
   endpoint that the registration form invokes. Uses service role to
   create the auth user (guest path), update profile, insert booking,
   and send the PDF over Gmail SMTP. CORS is `*` here — auth is by
   the call shape (guest = email/password in body, authed = Bearer).

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
