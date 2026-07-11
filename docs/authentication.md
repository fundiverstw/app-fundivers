# Authentication & roles

## Accounts

Users live in `auth.users` (Supabase-managed). Every auth user has a
matching row in `public.profiles` created automatically by the
`handle_new_user()` trigger — see migration
`20260416111642_initial_schema.sql`. **Do not insert into `profiles`
manually during signup.**

The email of record lives in `auth.users`, but `profiles.email` mirrors
it (added in `20260616000000_profiles_email.sql`) so the admin Users page
can show it through the normal `profiles` select instead of a service-role
lookup. The copy is **read-only** — `handle_new_user` seeds it at signup,
a `before update` trigger (`profiles_email_mirror_auth`) coerces it back to
the `auth.users` value on any profile edit so it can't be spoofed, and an
`after update of email on auth.users` trigger (`sync_profile_email`)
propagates a future email change. It inherits the existing `profiles`
SELECT policies, so only self, staff/admin, and a parent-of-child can read
it. The app never writes it — hence it's absent from the `Insert`/`Update`
types in `src/types/database.ts`.

## Sign-up flow

There are **two** entry points:

### `/signup` — direct account creation

1. `SignupPage` calls `supabase.auth.signUp({ email, password,
   options: { data: { agreed_to_terms_at } } })`.
2. Supabase sends a confirmation email (Inbucket in local dev — see
   `make mail`).
3. The trigger writes `profiles(id = new.id)` with default
   `role = 'diver'` and copies `agreed_to_terms_at` from
   `raw_user_meta_data` into the profile column.
4. User clicks the link, confirms, and can log in.

No auto-login after signup: the confirmation screen directs them back
to `/login`.

### `/register` and `/register/:id` — one-shot signup + booking

Public funnel for visitors arriving from fundiverstw.com or a Wix
calendar deep-link. `RegisterPage` renders `RegisterForm`. On submit
the form invokes the **`create-registration` edge function**, which:

- Guest path (caller has no Bearer JWT): `auth.admin.createUser({
  email_confirm: true })` — bypasses the click-to-confirm gate so a
  typo'd email is rejected loudly instead of silently dropping the
  account; immediately signs in so the SPA holds the session without
  a second round-trip.
- Authed path (Bearer JWT): identifies the user via `auth.getUser()`.

In both cases the function then updates `profiles`, inserts the
`bookings` row, and emails a registration PDF to the diver and the
company inbox via Gmail SMTP. See
`supabase/functions/create-registration/index.ts`.

## Sign-in flow

1. `LoginPage` calls `signInWithPassword`.
2. After success, it reads `profiles.role` once and redirects:
   - `admin` → `/admin`
   - `staff` → `/admin/events`
   - `diver` → `/calendar`

Local dev quick-fill buttons cover all three: `diver@diver.diver` /
`admin@admin.admin` / `staff@staff.staff`.

## `useAuth` hook

`src/hooks/useAuth.ts` exposes `{ session, user, profile, loading, signOut }`:

- Subscribes to `supabase.auth.onAuthStateChange`.
- Re-fetches the full profile row whenever the session changes.
- `loading` stays `true` until the first session + profile resolve — UI
  shells should render a spinner until `!loading`.

## Role gating

Three roles: `diver`, `staff`, `admin`. The check constraint in
`profiles_role_check` enforces this DB-side. Promotion is **not**
exposed in the UI — flip `profiles.role` in Supabase Studio / SQL
editor with the service role.

| Role | Sees | Can mutate |
| --- | --- | --- |
| `diver` | own data | own bookings/profile |
| `staff` | every diver's profile/bookings/payments + own duties | nothing on the catalog or other users |
| `admin` | everything | everything |

Route guards (each gates one slice of the tree):

- **`ProtectedRoute`** (`src/components/layout/ProtectedRoute.tsx`) —
  gates on `!!session`. Unauthenticated users bounce to `/login`.
- **`StaffOrAdminRoute`** (`src/components/layout/StaffOrAdminRoute.tsx`) —
  read-only admin surfaces (events list, event detail, gear map).
  Allows `staff` + `admin`.
- **`AdminRoute`** (`src/components/layout/AdminRoute.tsx`) — write
  surfaces (catalog editors, user directory, duty assignment,
  notifications, new/edit event). Admin-only; staff bounces.

Route structure in `src/App.tsx` (representative — see file for the
authoritative list):

```
/login /signup /forgot-password /reset-password /terms
/register /register/:id            (public, no auth)
<ProtectedRoute>
  <AppShell>       /dashboard /calendar /map /bookings /payments
                   /profile /duties
  /minigame/eel-snake
  <StaffOrAdminRoute>
    <AdminShell>   /admin /admin/events
                   /admin/events/:id
                   /admin/events/:id/gear-map
  <AdminRoute>
    <AdminShell>   /admin/new /admin/new/event /admin/rooms
                   /admin/addons /admin/travel /admin/prices
                   /admin/events/:id/edit /admin/users
                   /admin/duty /admin/notifications
```

`AppShell` renders the diver UI with a bottom nav; `AdminShell` is
the admin mirror. Admins see both: from `AppShell` there's a "view as
admin" link, and `AdminShell` has "view as diver" — see
[admin.md](./admin.md#role-view-toggle).

## RLS interaction

Auth role drives RLS. A diver only sees their own `bookings` /
`payments` / `push_subscriptions`; staff and admin share broader
`select` policies on `profiles`, `bookings`, `payments`,
`event_memos` (gated through the `is_staff_or_admin()` SQL helper).
Writes on those tables stay admin-only via `is_admin()`. The push
worker uses the **service role** key and bypasses RLS entirely — that's
why it lives server-side, never in the browser.

See [data-model.md § Row-Level Security](./data-model.md#row-level-security)
for the policy patterns and the `is_admin()` /
`is_staff_or_admin()` helpers.

## Test accounts (local dev)

`LoginPage` exposes quick-fill buttons in dev mode. Credentials live
at the top of `src/pages/LoginPage.tsx` — read them from there rather
than relying on this doc, since they drift. Create them via the
Supabase dashboard or CLI (`supabase auth admin create-user`) before
first run; see the header comment in
`20260416111642_initial_schema.sql`.

Integration tests create throwaway users on the fly via
`createTestUser()` in `tests/integration/helpers.ts` — use those in
new integration tests rather than the dev accounts.
