# Plan: manual account verification

**Status:** proposal — choices in §2 need confirmation before
implementation. This doc lives alongside the regular per-topic docs as
a working spec; once shipped, fold the relevant sections into
`authentication.md` / `events-and-bookings.md` / `admin.md` and delete
this file.

## 1. Goal

Combat spam by inserting an admin-approval step between a new diver's
**first** registration and any rows landing in `public.bookings` /
`public.profiles`. The diver still gets a confirmation that their form
was received (PDF email, same as today). Subsequent registrations from
an approved diver behave exactly like today.

## 2. Decisions to confirm

The user-facing requirement is: *"data is only sent by PDF email;
nothing enters Supabase until an admin confirms."* That allows two
implementations with very different blast radius.

### Decision A — pre-approval data lives outside Supabase entirely

| Aspect | Mechanic |
| --- | --- |
| Submit (guest, first time) | `create-registration` builds + emails PDF, **no auth user, no profile, no booking** is created. The submitted payload is stashed in **Cloudflare KV** keyed by a UUID. |
| Admin sees | New `/admin/applications` page lists pending KV entries (calls a worker endpoint that scans + returns metadata). |
| Admin approves | Worker reads KV → creates auth user (`createUser` + `email_confirm: true`) → updates profile → inserts booking → deletes KV entry → emails diver a magic link. |
| Admin rejects | KV entry deleted; optional rejection email. |
| Holding store | Cloudflare KV (already-paid Workers infrastructure; no Supabase row). |

Pros: literally zero Supabase footprint pre-approval, matches the
"nothing in DB" wording.

Cons: new infra (KV namespace, worker endpoints, admin page that talks
to the worker not Supabase). Password + form payload sit in KV, not
hashed — KV is private, but it's still credentials at rest in a
non-standard location. Booking deduplication
(`bookings_user_dive_uniq`) doesn't help against duplicate KV entries —
need application-level dedup.

### Decision B — pre-approval row exists with a `pending` flag, RLS gates everything

| Aspect | Mechanic |
| --- | --- |
| Submit (guest, first time) | `create-registration` does what it does today (user + profile + booking + PDF), but the new profile row carries `status = 'pending'`. The booking row inserts with `status = 'pending'` (already the default — no change). |
| Admin sees | New `/admin/applications` page = `profiles where status='pending'`, with the diver's first booking expanded inline. |
| Admin approves | `UPDATE profiles SET status='active' WHERE id=$1`. Email diver "you're approved." Existing booking is now visible to ops just like any other pending booking. |
| Admin rejects | `UPDATE profiles SET status='rejected'` + optionally cascade-delete the booking. Or just delete the auth user (cascades). |
| RLS | All write policies on `bookings`, `payments`, `push_subscriptions` get a clause: `EXISTS (select 1 from profiles where id = auth.uid() and status = 'active')`. Reads of own data stay open. |

Pros: tiny diff — one column, one RLS clause set, one admin page that's
basically `AdminUsersPage` filtered. No new infra. The PDF email side
of `create-registration` is unchanged.

Cons: pending profile + booking rows are still in Supabase, just
gated. If you read the spec literally as "no Supabase rows," this
fails.

### Recommendation

**Decision B.** The reason "nothing in DB" matters operationally is
*spam can't see/touch real data and can't fan out side-effects*, and
RLS achieves that with one extra predicate. Decision A is correct on
the wording but adds a KV namespace, two new worker endpoints, a
parallel approval flow, and a credentials-at-rest concern, all to
avoid two rows that are anyway invisible to anything except admins.

Everything below assumes Decision B. If you pick A, the relevant
sections need re-scoping.

## 3. Schema (Decision B)

One forward migration, e.g.
`supabase/migrations/<ts>_profile_status.sql`:

```sql
begin;

-- Add a pending-state column. Default 'pending' so any new signup is
-- gated; the backfill below opts every existing diver into 'active'.
alter table public.profiles
  add column status text not null default 'pending'
  check (status in ('pending','active','rejected'));

update public.profiles set status = 'active';

-- Index so the admin "pending applications" view is cheap.
create index profiles_status_pending_idx
  on public.profiles (created_at desc) where status = 'pending';

commit;
```

Rules of engagement: the migration file, once `make push`'d, is
immutable (CLAUDE.md §1). Any later tweak goes in a *new* forward
migration.

## 4. RLS (Decision B)

Add a helper mirroring `is_admin()` / `is_staff_or_admin()` so the
predicate is reusable and doesn't recurse into `profiles` RLS:

```sql
create or replace function public.is_active_user() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  )
$$;
grant execute on function public.is_active_user() to authenticated;
```

Then update **insert** policies on tables a pending diver could
otherwise write to:

- `bookings` — diver insert policy gains `and public.is_active_user()`.
  *Exception*: the very first booking from `create-registration` is
  inserted under the **service role**, which bypasses RLS — that's
  fine and intentional. The gate kicks in for any subsequent direct
  insert from the SPA.
- `payments` — staff-only writes already, no change needed.
- `push_subscriptions` — own-row writes; gate behind `is_active_user()`
  so a pending account can't subscribe to pushes (nice-to-have).

Read policies are unchanged. Pending divers can read their own
profile/booking — important so the SPA can show them "your application
is being reviewed."

## 5. SPA changes

### Routing / shell

- `useAuth` already returns `profile` — surface `profile.status` from
  the same hook (cheap; one extra column on the existing select).
- New gate component `RequireActive` wrapping every authenticated
  route except `/profile` and a new `/pending` route. Pending users
  bounce to `/pending`.
- `/pending` page — minimal: "Your application is being reviewed.
  We'll email you when an admin confirms." Sign-out button.
- `LoginPage` post-success redirect: pending → `/pending`,
  active diver → `/calendar`, admin → `/admin`. Currently it does the
  diver/admin fork already; add the pending branch.

### Booking form

`RegisterForm.tsx` and `RegisterPage.tsx` need **no functional
change** for the guest path — `create-registration` still creates the
profile + booking + PDF. The only difference is the new profile row
arrives with `status='pending'`, which `create-registration` sets
explicitly.

For an *authed* diver who's still pending and somehow reaches the
form, `RequireActive` blocks the route before they get there. (Edge
case only — they shouldn't see the calendar in the first place.)

### Admin

New page `/admin/applications` (`src/pages/admin/AdminApplicationsPage.tsx`):

- Lists `profiles where status='pending'`, newest first.
- Each card expands to show the diver's submitted profile fields and
  their first booking (one-to-one for now: pending users can only
  have one booking until approved — enforced by
  `RequireActive` blocking re-submission).
- Two actions per row:
  - **Approve** → `update profiles set status='active'` + send
    "approved" email via a new edge function (or inline in the same
    update path).
  - **Reject** → `update profiles set status='rejected'` + optional
    rejection email + soft-delete pattern of your choice (TBD —
    simplest is to leave the row with `status='rejected'` and let
    cleanup happen out-of-band).
- Add a top-nav badge in `AdminShell` showing the pending count, so
  applications don't pile up unnoticed.

## 6. Edge function changes

`supabase/functions/create-registration/index.ts`:

1. On the **guest path** (`createdGuest === true`), set the new
   profile row's `status` to `'pending'` in the existing
   profile-update step (today: `body.profile_patch`; add `status:
   'pending'` server-side, not from the client — never trust the
   client to set its own status).
2. On the **authed path**, no change. Authed callers are by definition
   already approved, since `RequireActive` would have blocked them
   otherwise.
3. Add a second outgoing email path: subject line tweak so admin can
   filter `application--<event>--<diver>` separately from regular
   confirmations. (Optional polish; current `registration--…` works.)

New edge function `supabase/functions/approve-application/index.ts`:

- Auth-gated: requires admin JWT (mirrors the pattern in
  `workers/push/src/index.ts → handleAdminBroadcast`).
- Body: `{ user_id, decision: 'approve' | 'reject', reason?: string }`.
- On approve: `update profiles set status='active'` + Gmail SMTP send
  via the same nodemailer setup as `create-registration`.
- On reject: `update profiles set status='rejected'` + optional email.

Could also live as a Cloudflare worker endpoint in `workers/push/src`
to reuse the JWT-verifying admin-gate pattern that's already there
post-CORS-fix. Trade-off: edge function is closer to the data;
worker is closer to the existing admin pattern. Either works.

## 7. Tests

- **Migration (integration).** `tests/integration/profiles_status.test.ts`:
  - Brand-new auth user has `status='pending'`.
  - Existing users (created in seed) have `status='active'` after the
    backfill.
  - Pending user inserting into `bookings` directly via Supabase
    client is rejected by RLS.
  - Active user inserting succeeds.
- **Edge function (integration).** Hit the local edge function with
  a guest payload, assert the resulting profile row is `pending` and
  the PDF email queued (mock SMTP).
- **SPA (unit).**
  - `RequireActive` redirects pending → `/pending`, active → through.
  - `LoginPage` redirect logic for pending status.
  - `AdminApplicationsPage` renders, calls approve, navigates back.

Everything follows the patterns in `docs/testing.md` — unit tests use
`mockQueryBuilder` from `tests/test-utils.tsx`; integration tests run
against the local Supabase stack and use `createTestUser()`.

## 8. Rollout order

1. Migration + RLS + helper (one PR). Backfill makes this safe to ship
   without UI: every existing diver is `active`.
2. Edge-function update to set `status='pending'` on guest signup.
3. SPA: `RequireActive`, `/pending` page, login redirect.
4. SPA: `AdminApplicationsPage` + approve/reject flow.
5. Polish: pending-count badge, rejection emails, pending-state copy.

Each step is independently shippable — at any point, the worst case is
"new signups land as pending and admin clears them via Supabase Studio
SQL editor."

## 9. Open questions

- **Pending diver paying a deposit.** A spammer can't, because RLS
  blocks `payments` writes for divers anyway (staff-only). But should
  the form even *show* a payment method for a pending user's first
  submission? Probably keep it on the PDF only and skip in-app.
- **Rate limiting.** Even with PDF-only output, a script can hammer
  `create-registration` and spam your inbox. Consider a Cloudflare
  Turnstile / hCaptcha on the guest form, or per-IP throttling at the
  worker layer.
- **Rejected accounts re-applying.** Today nothing stops a rejected
  user from signing up with a new email. Worth deciding whether
  rejection is enforcement or just a flag.
- **Existing pending bookings.** None today (`status` is new). After
  rollout, pending users' first bookings are visible to admins via the
  applications page; they don't show up in `/admin/events` until the
  user is approved (filter `bookings.user_id IN (active profiles)` or
  let RLS be the gate).
