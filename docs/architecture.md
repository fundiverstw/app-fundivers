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

`src/App.tsx` is the authoritative route table and `ls src/pages/` the
authoritative page list; the landmarks worth knowing are:

```
src/
  App.tsx                 Route table (browser-side)
  main.tsx                React entry + SW registration
  sw.ts                   Service worker (injectManifest target)
  config/site.ts          Typed handle on fundive.config.ts (the shop seam)
  lib/
    supabase.ts           Singleton supabase client
    event-kinds.ts        The `kind` vocabulary + the questions to ask of it
                          (import-free: edge functions + push worker share it)
    events.ts             events rows → AppEvent normalization
    calendar-layout.ts    Multi-day bar track-stacking
    booking-charges.ts    buildCharges / resolveCharges — the itemized total
    push.ts               Web Push enrollment (subscribe/unsubscribe)
    push-reminders.ts     Pure reminder-selection logic (shared with worker)
  hooks/useAuth.ts        Session + profile subscription
  pages/
    DashboardPage.tsx     Shared dashboard (/dashboard for divers,
                          /admin/home for admins)
    CalendarPage.tsx      Diver calendar + register flow entry
    RecordsPage.tsx       Tab shell over Bookings / Payments / Dive logs
    ProfilePage.tsx       Editable profile + push-notification toggle
    DutiesPage.tsx        Staff/admin own-duty list
    RegisterPage.tsx      Public, no-auth registration funnel
    admin/                Event, logistics, catalog, user and accounting
                          surfaces — see admin.md for the route table
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
      AdminNotes.tsx         Operational memos on an event or a booking
  types/database.ts          Hand-maintained Supabase Database type, and the
                             compile-time guard pinning EVENT_KINDS to the DB

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

## Responsive layout

Mobile-first, one breakpoint: Tailwind's default `sm:` (640px). Build
the layout so it works at ~375px wide (iPhone 13/SE), then use `sm:`
to opt into a wider arrangement on tablets and desktop. No other
breakpoints — adding `md:`/`lg:`/`xl:` is a code smell unless you
have a real reason.

Practical rules:

- **Rows with 3+ inputs/buttons need to wrap or stack.** A bare
  `flex gap-2` with four children will overflow on iPhone. Use
  `flex flex-wrap` for button bars and
  `grid grid-cols-1 sm:grid-cols-3` for form-input rows.
- **No new `@media` CSS.** `src/App.css` has a few legacy hand-written
  media queries — don't add more. Stay in Tailwind utility classes so
  the breakpoint stays in one place.
- **No `useMediaQuery` hook / `window.innerWidth` reads for layout.**
  The few `window.innerWidth` reads in the codebase are for canvas
  sizing in minigames, not layout. Branch in CSS, not JS.
- **Native `<input type="date">` styling varies per OS.** Calendar
  icon on desktop Chrome, chevron on Android, nothing on iOS. That's
  the spec — within a single device, just make sure adjacent date
  inputs render the same as each other (same enabled state, same
  width). Don't ship a custom date picker without a real reason.

## Why this shape

- **No custom app server.** PostgREST + RLS covers all CRUD; we avoid
  a whole runtime. RLS policies in migrations are the source of truth
  for authorization.
- **One `events` table, not one per kind.** Dives, courses and
  adventures differ in a handful of columns and in almost nothing else
  a booking, duty, car or waiver cares about, so they share a table and
  a `kind` discriminator; every child points at it with a plain
  `event_id`. The Bubble-imported `EO_*` pair this replaced is gone,
  along with its text ids and text date columns. The catalog tables
  (`prices`, `rooms`, `addons`, `trip_templates`, `travel_destinations`)
  stay read-mostly data the app normalizes through `src/lib/events.ts`.
  See [data-model.md](./data-model.md#the-events-table).
- **injectManifest, not generateSW.** We need a custom `push` event
  handler, which `generateSW` doesn't support.
