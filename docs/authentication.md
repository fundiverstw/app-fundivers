# Authentication & roles

## Accounts

Users live in `auth.users` (Supabase-managed). Every auth user has a
matching row in `public.profiles` created automatically by the
`handle_new_user()` trigger — see migration
`20260416111642_initial_schema.sql`. **Do not insert into `profiles`
manually during signup.**

## Sign-up flow

1. `SignupPage` calls `supabase.auth.signUp({ email, password })`.
2. Supabase sends a confirmation email (Inbucket in local dev — see
   `make mail`).
3. The trigger writes `profiles(id = new.id)` with default
   `role = 'diver'`.
4. User clicks the link, confirms, and can log in.

No auto-login after signup: the confirmation screen directs them back
to `/login`.

## Sign-in flow

1. `LoginPage` calls `signInWithPassword`.
2. After success, it reads `profiles.role` once and redirects:
   - `admin` → `/admin`
   - `diver` → `/calendar`

## `useAuth` hook

`src/hooks/useAuth.ts` exposes `{ session, user, profile, loading, signOut }`:

- Subscribes to `supabase.auth.onAuthStateChange`.
- Re-fetches the full profile row whenever the session changes.
- `loading` stays `true` until the first session + profile resolve — UI
  shells should render a spinner until `!loading`.

## Role gating

Only two roles exist: `diver` and `admin`. The check constraint in
`profiles_role_check` enforces this DB-side.

- **`ProtectedRoute`** (`src/components/layout/ProtectedRoute.tsx`)
  gates on `!!session`. Unauthenticated users bounce to `/login`.
- **`AdminRoute`** (`src/components/layout/AdminRoute.tsx`) gates on
  `profile?.role === 'admin'`. Non-admins bounce to `/calendar`.

Route structure in `src/App.tsx`:

```
/login, /signup
<ProtectedRoute>
  <AppShell>       /calendar, /bookings, /payments, /profile
  <AdminRoute>
    <AdminShell>   /admin, /admin/events, /admin/events/:type/:id, /admin/users
```

`AppShell` renders the diver UI with a bottom nav; `AdminShell` is the
admin mirror. Admins see both: from `AppShell` there's a "view as
admin" link, and `AdminShell` has "view as diver" — see
[admin.md](./admin.md#role-view-toggle).

## RLS interaction

Auth role drives RLS. A diver only sees their own `bookings` /
`payments` / `push_subscriptions`; an admin user has broader `select`
policies on `profiles`, `bookings`, `payments`, `event_memos`. The push
cron uses the **service role** key and bypasses RLS entirely — that's
why it lives in a server-side worker, never in the browser.

See [data-model.md § Row-Level Security](./data-model.md#row-level-security)
for the policy patterns.

## Test accounts (local dev)

`LoginPage` exposes quick-fill buttons in dev mode for:

- `diver@diver.diver` / `devdevdev`
- `admin@admin.admin` / `devdevdev`

Create them via the Supabase dashboard or CLI (`supabase auth admin
create-user`) before first run. See the header comment in
`20260416111642_initial_schema.sql`.

Integration tests create throwaway users on the fly via
`createTestUser()` in `tests/integration/helpers.ts` — use those in new
integration tests rather than the dev accounts.
