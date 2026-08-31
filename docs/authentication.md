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

There are **two** entry points, and neither one has an approval step.

### `/signup` — direct account creation

**A passport name, an email address and a password are the whole of the ask**,
plus a Cloudflare Turnstile challenge the diver never usually has to touch.

1. `SignupPage` posts to the **`create-account` edge function**.
2. The function verifies the Turnstile token server-side, spends a per-IP
   budget (`record_signup_attempt`, shared with the `/register` funnel), then
   calls `auth.admin.createUser({ email_confirm: true })` and signs the diver
   in.
3. The `handle_new_user` trigger writes `profiles(id = new.id)` with
   `role = 'diver'`, **`status = 'active'`**, the `name` from
   `raw_user_meta_data`, and a server-stamped `agreed_to_terms_at`.
4. The SPA installs the returned session and the diver lands on `/calendar`.

Why an edge function rather than `supabase.auth.signUp()`:

- **Captcha.** Supabase's own captcha setting arms *every* auth endpoint,
  sign-in and password-reset included. Verifying the token here puts the
  challenge on signup alone.
- **No confirmation email.** `email_confirm: true` marks the address confirmed
  at creation, so there is no click-the-link step between signing up and
  diving — regardless of the project's "Confirm email" dashboard toggle.
- **Rate limiting.** `record_signup_attempt` is a service-role RPC.

No profile field beyond the name is required, at signup or afterwards.
`ProfileForm` on `/profile` saves whatever it is given; what is still blank is
computed by `src/lib/profile-completeness.ts` and shown to staff on the admin
screens — a gap is a prompt, never a block. Details the shop genuinely cannot
dive without are collected at booking time by `RegisterForm`.

### `/register` and `/register/:id` — one-shot signup + booking

Public funnel for visitors arriving from fundiverstw.com or a Wix
calendar deep-link. `RegisterPage` renders `RegisterForm`. On submit
the form invokes the **`create-registration` edge function**, which:

- Guest path (caller has no Bearer JWT): the same Turnstile + per-IP gates,
  then `auth.admin.createUser({ email_confirm: true })` — bypasses the
  click-to-confirm gate so a typo'd email is rejected loudly instead of
  silently dropping the account; immediately signs in so the SPA holds the
  session without a second round-trip.
- Authed path (Bearer JWT): identifies the user via `auth.getUser()`.

In both cases the function then updates `profiles`, inserts the
`bookings` row, and emails a registration PDF to the diver and the
company inbox via Gmail SMTP. See
`supabase/functions/create-registration/index.ts`.

### What `status` is for now

`profiles.status` (`pending` | `active` | `rejected`) is a **suspension
lever**, not a queue. Signing up no longer produces a `pending` row, so in
normal operation nothing sits in that state. An admin can still move a live
profile to `pending` or `rejected` from `/admin/applications` ("Accounts on
hold"), and doing so still severs diver-side `bookings` and
`push_subscriptions` inserts through the `is_active_user()` RLS helper and
bounces the diver to `/pending`.

Before migration `20260831120000` every new account started at `pending` and
waited for a human. Divers read the wait as the site being broken, and the shop
was approving essentially everyone, so the queue bought no safety.

### Terms re-acceptance

`RequireCurrentTerms` used to redirect every authenticated route to
`/terms?reaccept=1` the moment `profiles.agreed_to_terms_version` fell behind
the live `terms.version`. It now renders a **banner** above the page instead,
linking to the same flow. The banner is not dismissible — it stays until the
diver accepts, so the shop still gets its consent — but nothing behind it is
blocked meanwhile. Signup is unaffected: `/signup` takes consent to the current
version before the account exists.

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
`admin_notes` / `diver_notes` (gated through the `is_staff_or_admin()`
SQL helper).
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
