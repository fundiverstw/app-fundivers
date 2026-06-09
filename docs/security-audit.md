# FunDivers TW — Security Audit

**Date:** 2026-06-02
**Scope:** the whole repo as of `main` at audit time — frontend SPA
(`src/`), Supabase migrations (74 forward-only files), 7 Supabase
edge functions, the Cloudflare push worker, the CI/CD workflows,
package dependencies, and runtime config.

**Method:** parallel review by topic (RLS / server endpoints / frontend
/ supply chain), every Critical and High finding spot-verified against
source. File:line citations are live. Migrations are stacked, so each
RLS finding reflects the *cumulative* state after all 74 files apply,
not just one migration.

**Out of scope:** Supabase project dashboard settings (auth provider
config, JWT lifetime, RLS toggles set via UI), Cloudflare WAF /
firewall rules, DNS records, Gmail account 2FA / OAuth scopes,
physical / social engineering, the Wix endpoint that consumes the sync
webhook. Anything that requires logged-in access to a third-party
dashboard could not be checked from the code.

---

## TL;DR

**Update 2026-06-03:** every Critical, High, Medium, and Low finding
is now either FIXED, DEFERRED, or TRACKED. C1–C3, H1–H8, M1–M13,
L1–L3, L5, L6, L8, L9, L10, L12, L13 ship code fixes — see each
section's `**Status: FIXED**` header for the migration / file. L4
(RegisterForm zod) and L7 (wix-sync identifier casing) are DEFERRED
as pure hygiene / out-of-scope-for-security; L11 (heic2any maintenance)
is TRACKED via Dependabot. The original findings are preserved
verbatim below for context; read the status block at the top of each
section before the prose.

Three findings collapse the authorization model end-to-end:

- **C1 — Diver self-promotion to admin via direct `UPDATE profiles`.**
  The self-update RLS policy is column-blind; PostgREST will accept
  `PATCH /rest/v1/profiles?id=eq.<self>` with `{"role":"admin"}`.

- **C2 — Public `create-registration` edge function accepts arbitrary
  `profile_patch` under the service-role key.** Only `status` is
  stripped before applying. Setting `profile_patch.role = "admin"` in
  the signup body produces an admin account on the first call.

- **C3 — Wix sync webhook token committed in plaintext** in
  `20260430153210_remote_schema.sql`, replicated across 9 triggers.
  Anyone with git read access can forge sync events to the public Wix
  endpoint.

Each is one HTTP request from exploit. Fix order: C2 first (most
exposed — pre-auth, internet-facing), then C1 (closes the second path
to admin), then C3 (rotate token, drop & recreate triggers reading
from `vault.decrypted_secrets`).

A handful of High findings sit one layer behind these: an
unauthenticated abuse channel on `create-registration` (no rate limit
/ no CAPTCHA, hits Gmail SMTP quota in minutes); a parent-of-child
RLS policy that mirrors the C1 column-blindness; missing
`search_path` on every `SECURITY DEFINER` function; and a service
worker that caches `*.supabase.co` responses including the
`/auth/v1/*` paths.

Severity legend:

| Tier | Meaning |
| --- | --- |
| **Critical** | Verified, exploitable in current code with no special access. |
| **High** | Real risk, needs a precondition (admin compromise, missing rotation, etc.) or is one config drift away from Critical. |
| **Medium** | Defense-in-depth gap. Not exploitable alone. |
| **Low** | Hardening / hygiene. Unlikely to be the proximate cause of any incident. |
| **Informational** | Confirmations + context. No action required. |

---

## Critical

### C1. Diver can promote self to admin via direct `UPDATE profiles`

**Status: FIXED 2026-06-02** in
`supabase/migrations/20260602000000_block_self_role_status_parent_change.sql`
(also closes H1). Regression coverage in
`tests/integration/profiles-privileged-columns-locked.test.ts` (17
cases pinning each blocked + allowed path).

**Where:** `supabase/migrations/20260423130000_core_rls_and_booking_immutability.sql:57-60`

```sql
create policy "profiles: self update"
  on public.profiles for update to authenticated
  using     (auth.uid() = id)
  with check (auth.uid() = id);
```

The `using` / `with check` clauses only restrict *which row* the
caller may update — not *which columns*. PostgreSQL row-level
security is row-scoped by design; column gating requires a separate
mechanism (column-level GRANT or a trigger). The `profiles_role_check`
CHECK constraint allows `('diver','admin','staff')`, so a logged-in
diver can:

```http
PATCH /rest/v1/profiles?id=eq.<their-own-uid> HTTP/1.1
Authorization: Bearer <their-own-access-token>
Content-Type: application/json
Prefer: return=representation

{"role":"admin"}
```

…and the row updates cleanly. They now satisfy `is_admin()` everywhere
and can mutate every other table the app gates on the helper.

The codebase already has the template for the fix —
`block_self_gear_size_change` in
`20260505020000_gear_sizes_admin_only.sql` is a column-diff trigger.
It just doesn't cover `role` / `status` / `parent_account`.

**Fix (additive forward migration):**

```sql
create or replace function public.profiles_block_self_privileged_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.role           is distinct from old.role
     or new.status        is distinct from old.status
     or new.parent_account is distinct from old.parent_account then
    raise exception 'role/status/parent_account are admin-managed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_block_self_privileged_change_trg
  on public.profiles;
create trigger profiles_block_self_privileged_change_trg
  before update on public.profiles
  for each row execute function public.profiles_block_self_privileged_change();
```

The same trigger also closes C2 below (any future bypass of the
edge-function allowlist will still hit this trigger) and C4 below
(parent-of-child promotion).

---

### C2. `create-registration` edge function lets unauthenticated callers self-promote to admin

**Status: FIXED 2026-06-02.**

Two layers:
1. `supabase/functions/_shared/profile-patch.ts` — allowlist
   `sanitizeProfilePatch()`. Unit-tested in
   `_shared/profile-patch.test.ts` (18 cases: every attack key
   dropped, kitchen sink, SPA-shape contract pin, defensive shape
   handling, no prototype pollution).
2. `supabase/functions/create-registration/handler.ts` — the
   Deno entrypoint was split into a pure handler + thin Deno wrapper
   (`index.ts`). The handler takes injected dependencies (supabase
   admin, anon, makeAuthedClient, transporter, buildPdfBase64, env)
   so vitest can exercise every branch in-memory with `vi.fn`'d
   shims. `handler.test.ts` covers 26 cases: guest path security
   (kitchen-sink, status forcing, parent_account drop), on-behalf-of
   gates (admin / parent / unrelated diver), authed self path,
   rollback (booking failure deletes guest, doesn't delete existing,
   profile-update failure also rolls back, pre-existing booking
   rejection), email behaviour (null transporter, throwing
   transporter, dedup to company, waitlisted text-only path), and
   the happy path's `{booking_id, status, session}` envelope.

The C1 DB trigger remains the belt; this fix is the suspenders that
close the service-role path the trigger intentionally lets through.

**Where:** `supabase/functions/create-registration/index.ts:181-192`

```ts
const safePatch: Record<string, unknown> = { ...body.profile_patch }
delete safePatch.status
if (createdGuest) safePatch.status = "pending"

const { error: profErr } = await admin
  .from("profiles")
  .update(safePatch as never)
  .eq("id", userId)
```

`admin` is a service-role client (line 30) — it bypasses RLS. The
allowlist is "everything the client sent, minus `status`." `role` is
not stripped. A guest registration body of:

```json
{
  "email": "attacker@example.com",
  "password": "hunter2hunter2",
  "event_type": "dive",
  "event_id": "<any public event id>",
  "profile_patch": { "role": "admin" },
  "details": {}
}
```

…produces a logged-in admin account on the response. No CAPTCHA, no
rate limit, no admin review — the function `auth.admin.createUser`s
with `email_confirm: true` (`index.ts:148-150`), so the account is
live the moment the SPA does `setSession` on the returned token.

Same flaw applies to the authed-self path (line 134, no allowlist) and
the parent-of-child path (line 104) — a parent could flip a child to
admin, log in as the child, and inherit it.

**Fix:** replace the `delete safePatch.status` line with a strict
allowlist. Below is the minimum set that today's UI populates; add to
it deliberately, not by spreading.

```ts
const PROFILE_PATCH_ALLOW = new Set([
  "name", "nickname", "date_of_birth",
  "nationality", "id_number", "contact_method", "contact_id",
  "cert_level", "cert_agency", "height_cm", "weight_kg",
  "shoe_size", "nitrox_certified", "deep_certified",
  "logged_dives", "last_dive_date",
])
const safePatch: Record<string, unknown> = Object.fromEntries(
  Object.entries(body.profile_patch ?? {})
    .filter(([k]) => PROFILE_PATCH_ALLOW.has(k)),
)
if (createdGuest) safePatch.status = "pending"
```

Mirror the same allowlist in the other 6 edge functions where any
`profile_patch` shape is applied. The C1 trigger above is the
belt-and-suspenders complement: even if a future endpoint forgets the
allowlist, the trigger rejects the column change for non-admin
callers.

---

### C3. Wix sync webhook token committed in plaintext, replicated across 9 triggers

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603030000_wix_sync_token_from_vault.sql`.
Token rotated in Wix Secrets Manager; new value lives in
`vault.secrets` under name `wix_sync_token`. The 8 triggers were
dropped and recreated against a new `public.wix_sync_notify()`
helper that reads the live token from `vault.decrypted_secrets` and
fires the webhook via `net.http_post`. The historical leaked token
in git history no longer matches anything Wix accepts.

**Where:** `supabase/migrations/20260430153210_remote_schema.sql:15-29` (9 occurrences)

```sql
CREATE TRIGGER wix_sync_dive_travel AFTER INSERT OR DELETE OR UPDATE
ON public."DiveTravel" FOR EACH ROW
EXECUTE FUNCTION supabase_functions.http_request(
  'https://fundiverstw.com/_functions/supabaseWebhook',
  'POST',
  '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}',
  '{}',
  '5000'
);
```

The shared secret `cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e`
is committed to git and ships in every developer clone, every Supabase
dump, and any local backup. Anyone with read access to this repo can
POST forged sync events to the public Wix endpoint. The full impact
depends on what the Wix endpoint does with the payload (which is
out-of-scope for this audit) — at minimum it lets an attacker inject
catalog mutations into the Wix mirror, plausibly leading to incorrect
prices / event titles being shown to Wix-side traffic.

**Fix:**

1. Rotate the token in Wix.
2. Store the new value in Supabase Vault.
3. Forward migration that drops the 9 triggers and recreates them
   reading the secret from `vault.decrypted_secrets` (or rewrites them
   to call a SECURITY DEFINER plpgsql function that reads from vault).
4. Add `.gitleaks.toml` / `gitleaks` pre-commit, since the pattern
   (32+ hex chars in `CREATE TRIGGER … http_request`) is detectable.

Note: a `git filter-repo` rewrite of the old token out of history is
optional. The token is already burned the moment any third party
reads this repo; rotation is mandatory regardless of whether you
rewrite history.

---

## High

### H1. Parent-of-child RLS policy allows child-role promotion

**Status: FIXED 2026-06-02** by the same C1 trigger
(`20260602000000_block_self_role_status_parent_change.sql`). The
trigger fires regardless of which RLS policy granted the row-level
update, so the parent-update-children path is covered. Regression
test cases at
`tests/integration/profiles-privileged-columns-locked.test.ts:117-141`.

**Where:** `supabase/migrations/20260514030000_parent_child_accounts.sql:94-98`

```sql
create policy "profiles: parent update children"
  on public.profiles for update to authenticated
  using     (parent_account = auth.uid())
  with check (parent_account = auth.uid());
```

Same column-blind shape as C1 but on the *parent → child* axis.
Parents typically created the child's account and hold its
credentials, so this is rarely an across-account attack — but the same
parent can `UPDATE` the child's row to set `role = 'admin'`, then log
in as the child. Net effect: parents are admin-eligible. The trigger
proposed in C1 closes this path too because it gates on
`auth.uid()` (the *parent* in this case) and `is_admin()`.

---

### H2. `create-registration` is internet-facing, unauthenticated, and uncontrolled

**Status: FIXED 2026-06-03.** Four-part fix landed in one bundle:

1. **Cloudflare Turnstile** verified server-side before `createUser`.
   SPA renders the widget via `src/components/register/TurnstileWidget.tsx`;
   handler refuses guest signups without a valid token.
2. **Per-IP rate limit** via `record_signup_attempt(bytea)` RPC in
   `20260603040000_signup_throttling_and_orphan_log.sql`. Caps each
   IP hash at 5/min OR 50/day. SHA-256 of client IP only — raw IPs
   not stored.
3. **Event-existence pre-check** — guest path now confirms the
   `event_id` exists in `EO_dives` / `EO_courses` before burning MAU
   on `auth.admin.createUser`.
4. **Rollback orphan logging** — when `createUser` succeeds but
   subsequent steps fail and `deleteUser` itself errors, the orphan
   auth user is recorded in `orphan_auth_users` via the
   `log_orphan_auth_user` RPC instead of being silently swallowed.

All gates apply only to the guest path; authed parent-on-behalf-of
and self-auth flows skip them. 11 new unit cases in
`supabase/functions/create-registration/handler.test.ts` pin each
gate's behavior.

**Where:** `supabase/functions/create-registration/index.ts:71-229`

No CAPTCHA, no Turnstile, no IP-throttle, no per-email throttle. The
function does, per call:

1. `auth.admin.createUser({ email_confirm: true })` — a real
   `auth.users` row, billable MAU.
2. `from("profiles").update(...)` — a real PII payload.
3. `from("bookings").insert(...)` — a real booking against any
   event_id.
4. `nodemailer.sendMail` x2 — one to the company inbox, one to the
   attacker-supplied address.

Gmail's workspace SMTP quota is ~500 messages/day; a loop hits it in
~4 minutes and takes down every transactional email path in the app
(waitlist offers, application decisions, dive-log exports). MAU runs
up. The `auth.users` table fills with junk that has to be GC'd by
hand because the rollback path silently swallows errors
(`index.ts:173-178`: `await rollback().catch(() => {})`).

**Fix:**

1. Require a Cloudflare Turnstile token in the request body; verify
   server-side before `createUser`.
2. Add a per-IP rate-limit using a small `signup_attempts(ip_hash,
   created_at)` table with a 5/min / 50/day window.
3. Optionally restrict guest bookings to events the SPA actually
   advertises on the public calendar.
4. On rollback failure, log the orphan to an `orphan_auth_users` table
   for a janitor to reap, instead of `.catch(() => {})`.

---

### H3. `SECURITY DEFINER` functions missing `SET search_path = public`

**Status: FIXED 2026-06-03.** `handle_new_user` was patched as part of
the L10 work in
`supabase/migrations/20260603000000_terms_consent_versioning.sql`.
The remaining three (`accept_waitlist_offer`,
`handle_booking_cancellation`, `offer_next_waitlist_spot`) were
pinned in
`supabase/migrations/20260603050000_search_path_sweep.sql`. Existing
waitlist integration suite (11 cases) continues to pass against the
patched functions, so the runtime behavior is unchanged.

**Where:**

- `handle_new_user` —
  `supabase/migrations/20260416111642_initial_schema.sql` + redefined
  in `20260423150000_pii_retention_and_tos.sql`.
- `offer_next_waitlist_spot`, `handle_booking_cancellation`,
  `accept_waitlist_offer` —
  `supabase/migrations/20260507000000_waitlist_offers.sql` and the
  redefinitions in `20260507010000_waitlist_uuid_args.sql`.

Postgres `SECURITY DEFINER` functions run as the function owner
(here, postgres-equivalent) but resolve unqualified identifiers via
the *caller's* `search_path`. The canonical exploit pattern is for an
attacker to create a temp-schema object named `profiles` (or shadow
`now()`, `coalesce()`, etc.) that the definer's code resolves *first*
and uses with elevated rights.

The audit-log trigger
(`20260423140000_admin_audit_log.sql`) gets this right — it has
`set search_path = public`. The fix is to copy that pattern:

```sql
alter function public.handle_new_user()                     set search_path = public;
alter function public.offer_next_waitlist_spot(uuid, text)  set search_path = public;
alter function public.handle_booking_cancellation()         set search_path = public;
alter function public.accept_waitlist_offer(uuid)           set search_path = public;
```

---

### H4. Service worker caches every `*.supabase.co` response, including `/auth/v1/*`

**Status: FIXED 2026-06-03.** Cache route narrowed via
`src/sw-cache-policy.ts`: GETs only, never `/auth/v1/*`, never any
request with an `Authorization` header (all RLS-scoped reads).
Added `CacheableResponsePlugin({ statuses: [200] })` and
`ExpirationPlugin({ maxAgeSeconds: 60*5 })`. `useAuth.signOut` now
posts `CLEAR_SUPABASE_CACHE` to the SW after successful sign-out so
even the safe-cached anon reads get wiped on user switch. 7 cases
on the predicate + 2 on the sign-out post-message.

**Where:** `src/sw.ts:19-22`

```ts
registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co'),
  new NetworkFirst({ cacheName: 'supabase-api', networkTimeoutSeconds: 10 })
)
```

Two distinct problems:

1. **Auth-token caching.** `/auth/v1/token` and `/auth/v1/user`
   responses contain `access_token` / `refresh_token` JSON. After
   sign-out, the next offline lookup can return the prior session's
   cached body — useful for any post-sign-out same-device user (shared
   tablet, family device).
2. **PII-staleness across user switches.** Cached RLS-filtered
   responses for `/rest/v1/profiles?...` survive sign-out. Switching
   accounts and going offline briefly = stale view of the wrong
   user's data.

`NetworkFirst` with `networkTimeoutSeconds: 10` means the network
usually wins, but any flaky reconnection (mobile, café Wi-Fi) flips
to the stale cache.

**Fix:** narrow the route to GETs against the small set of read-mostly
tables the app benefits from caching (`EO_dives`, `EO_courses`, etc.)
and explicitly exclude `/auth/v1/`. Wire a `clients.postMessage` from
`useAuth.signOut` to a SW listener that does
`caches.delete('supabase-api')`. Apply `cacheableResponse: { statuses:
[200] }` and an `ExpirationPlugin` with `maxAgeSeconds: 60*5`.

---

### H5. No CSP / X-Frame-Options / X-Content-Type-Options on the SPA

**Status: FIXED 2026-06-03.** Replaced pure-assets `wrangler.toml`
with a thin Worker wrapper (`src/worker.ts`) that calls
`env.ASSETS.fetch(req)` and applies the headers defined in
`src/security-headers.ts`: full CSP (`default-src 'self'`,
`script-src 'self' challenges.cloudflare.com`,
`frame-ancestors 'none'`, `object-src 'none'`, etc.) plus
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a
`Permissions-Policy` that disables camera/geolocation/microphone.
11 unit cases pin the policy shape so it can't be silently loosened.

**Where:** root `wrangler.toml` is `[assets]`-only; `index.html` has
no `<meta http-equiv="Content-Security-Policy">`; no `public/_headers`.

The SPA is iframable, has no XSS defense-in-depth, and ships with
sniffable MIME types. The admin panel can be clickjacked into running
admin mutations (event price edits, broadcast pushes). No XSS vector
exists in current code, but the next dangerously-rendered string
would be free-range.

**Fix:** replace pure-assets mode with a thin Worker wrapper that
serves the same `dist/` but appends:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  connect-src 'self' https://<project>.supabase.co
              https://fundivers-push.<account>.workers.dev;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), geolocation=(), microphone=()
```

Test in `Content-Security-Policy-Report-Only` first, since the
`workbox-window` import or Vite-injected scripts may need
`'wasm-unsafe-eval'` or per-build nonces.

---

### H6. `notify-application-decision` admin actions are unaudited

**Status: FIXED 2026-06-03** in
`supabase/functions/notify-application-decision/index.ts`. The status
flip now goes through the caller's authed Supabase client (not the
service-role client) so the existing `audit_admin_write` trigger on
profiles sees `auth.uid()` = the admin's id, recognises them via
`is_admin()`, and writes the audit row automatically — no extra
explicit INSERT needed. Pinned by a new case in
`tests/integration/admin-audit-log.test.ts` that exercises the path
end-to-end (admin authed client → profile status UPDATE → audit row
present with before/after snapshots and actor_id = admin).

**Where:** `supabase/functions/notify-application-decision/index.ts:81-87`

Any admin can flip any diver's status (`active` / `rejected`) without
a trace. No row is written to `admin_audit_log`. With multiple admins
this is both a lateral-movement amplifier (a compromised admin can
delete-via-status anyone they want) and a repudiation gap (no log =
no answer to "who rejected me?").

**Fix:** insert an `admin_audit_log` row in the same edge call, with
`actor_id = caller.user.id`, `target_table = 'profiles'`,
`target_id = body.user_id`, and the prior + new status in the
`diff` jsonb.

---

### H7. CI workflows pass deploy secrets to an unpinned build step with default-write `GITHUB_TOKEN`

**Status: FIXED 2026-06-03.** All four workflows
(`ci.yml`, `deploy.yml`, `supabase-push.yml`,
`supabase-deploy-functions.yml`) now declare top-level
`permissions: contents: read`. Every action is SHA-pinned with a
trailing `# vX.Y.Z` comment for human readers — `actions/checkout`,
`actions/setup-node`, `cloudflare/wrangler-action`,
`supabase/setup-cli`. Deploy + migration-push + functions-deploy
jobs declare `environment: production` so they gate on whatever
protection rules are set in repo Settings → Environments.
`supabase-push.yml` and `supabase-deploy-functions.yml` additionally
gate on `github.ref == 'refs/heads/main'` so a `workflow_dispatch`
from a PR branch no-ops instead of shipping experimental migrations
to prod. Dependabot (`.github/dependabot.yml`) opens a weekly PR
when any pinned action publishes a new tag so the SHA pins stay
current without manual `git ls-remote` polling.

**Where:** `.github/workflows/deploy.yml`,
`.github/workflows/supabase-push.yml`,
`.github/workflows/supabase-deploy-functions.yml`.

None of the three workflows declare a top-level `permissions:` block,
so `GITHUB_TOKEN` defaults to broad write across the repo. Action
references (`actions/checkout`, `actions/setup-node`,
`cloudflare/wrangler-action`, `supabase/setup-cli`) are pinned to
floating majors, not commit SHAs. A compromised action major (Tj
Actions tj-actions/changed-files 2025, etc.) would inherit the
deploy-time secrets (`SUPABASE_DB_PASSWORD`,
`CLOUDFLARE_API_TOKEN`, `VITE_SUPABASE_*`).

The `supabase-push.yml` workflow additionally has no environment
gate — any maintainer with `workflow_dispatch` can push migrations
from any ref against production, including a PR branch.

**Fix:**

1. Add `permissions: { contents: read }` at the top of each workflow.
2. Pin every action to a commit SHA (`actions/checkout@<sha>` etc.).
3. Add an `environment: production` block to migration / deploy jobs
   and set required reviewers in Settings → Environments.
4. Add `if: github.ref == 'refs/heads/main'` to the `supabase-push`
   job.

---

### H8. `EO_*` tables grant `INSERT/UPDATE/DELETE/TRUNCATE` to `anon` and `authenticated` at the DDL layer

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603060000_eo_table_write_grants_lockdown.sql`.
Revoked `INSERT/UPDATE/DELETE/TRUNCATE` on `EO_dives`, `EO_courses`,
`EO_prices`, `EO_rooms`, and `Other_Addons` from both `anon` and
`authenticated`; re-granted `INSERT/UPDATE/DELETE` to `authenticated`
only. Nobody outside `service_role` can `TRUNCATE`; `anon` retains
`SELECT` for public reads. The admin RLS policies still gate which
authenticated rows actually get through. 317/317 integration tests
pass — no flow depended on the over-broad grants.

**Where:** `supabase/migrations/20260421130941_remote_schema.sql:188-396`

RLS is the only gate. Today the policies are admin-only so this is
not exploitable. But a single accidental `USING (true)` policy added
later, or a dashboard click that toggles RLS off on one of these
tables, turns the entire Bubble catalog into a world-writable surface
in one keystroke. The comment in
`20260423130000_core_rls_and_booking_immutability.sql` confirms RLS
has been accidentally disabled via dashboard before — so this is not
a hypothetical drift.

**Fix:**

```sql
revoke insert, update, delete, truncate
  on public."EO_dives", public."EO_courses",
     public."EO_prices", public."EO_rooms",
     public."Other_Addons"
  from anon, authenticated;
grant insert, update, delete
  on public."EO_dives", public."EO_courses",
     public."EO_prices", public."EO_rooms",
     public."Other_Addons"
  to authenticated;
```

`anon` keeps the existing `SELECT` grant. The admin RLS policies
still apply on top.

---

## Medium

### M1. `credits` policy lets staff issue / modify / delete credits

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603070000_medium_tier_policy_lockdowns.sql`.
Dropped "credits: staff manage all" and replaced with four scoped
policies: staff_or_admin SELECT, admin-only INSERT / UPDATE / DELETE.
`tests/integration/credits.test.ts` updated to assert staff can read
but cannot write (RLS hides INSERT → 42501; UPDATE / DELETE just
0-row no-ops with the row unchanged).

**Where:** `supabase/migrations/20260521010000_credits.sql:47`

The migration's own comment says "issuance is admin-driven only,"
but the policy is `for all` to staff_or_admin. Staff can credit
themselves arbitrary amounts. Split into `select` for staff_or_admin
and `insert/update/delete` for admin-only via `is_admin()`.

### M2. `push_subscriptions` UPDATE policy missing `WITH CHECK` and `TO authenticated`

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603070000_medium_tier_policy_lockdowns.sql`.
Recreated the SELECT / UPDATE / DELETE policies on
`push_subscriptions` with `to authenticated` (was defaulting to
public/anon) and added `with check (auth.uid() = user_id)` on UPDATE
so a user can't repoint their device endpoint at another user's id.

**Where:** `supabase/migrations/20260422180000_push_notifications.sql`

```sql
create policy "user updates own push sub"
  on public.push_subscriptions for update
  using (auth.uid() = user_id);
```

Two issues: it defaults to `public` (anon + authenticated), and the
missing `with check` means a user can UPDATE one of their own rows to
set `user_id = <someone-else>` — re-pointing their device endpoint at
another user. The push worker reads the row, sees "<victim>'s
subscription," and sends content meant for victim to attacker's
device. Fix with `to authenticated using (auth.uid() = user_id) with
check (auth.uid() = user_id)`.

### M3. `bookings: parent insert for children` skips the active-user gate

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603070000_medium_tier_policy_lockdowns.sql`.
Recreated "bookings: parent insert for children" to require
`public.is_active_user() and exists (… parent_account = auth.uid())`.
Pending parents can no longer insert bookings for their kids until
their own profile is approved — matches the gate the diver self-insert
policy already had.

**Where:** `supabase/migrations/20260514030000_parent_child_accounts.sql`

`20260501100000_profile_status.sql` adds `and public.is_active_user()`
to the diver self-insert policy. The parent-of-child insert policy
added later doesn't include the gate. A pending parent can insert
bookings for their children even before manual verification.

### M4. CORS `*` + verbatim Postgres errors on edge function 4xx/5xx

**Status: FIXED 2026-06-03.** New shared module
`supabase/functions/_shared/responses.ts` exports `corsHeaders(req)`,
`corsOk(req)`, `jsonResponse(req, body, status)`, and `safeError(err,
fallback)`. CORS is now an allowlist echo
(`app.fundiverstw.com` + localhost dev origins) with `Vary: Origin`
always set. `safeError` maps known SQLSTATEs (23505 → "Already
exists", 42501 → "Permission denied", etc.) and suppresses raw
Postgres / PostgREST messages while console.error'ing them for
debugging; authored Error messages still pass through. All seven
edge functions (`create-registration`, `notify-application-decision`,
`admin-create-diver`, `create-child-account`,
`request-dive-log-export`, `export-event-divers`,
`notify-waitlist-offer`) now import the helpers; verbatim `err.message`
returns replaced with `safeError(err, fallback)`. 11 unit cases in
`supabase/functions/_shared/responses.test.ts` pin the CORS + error
behavior.

**Where:** all `supabase/functions/*/index.ts`

Every edge function returns `Access-Control-Allow-Origin: *` and
echoes `err.message` (which is the raw Postgres/PostgREST string —
constraint names, column names, sometimes row contents). With CORS
`*`, any cross-origin page can probe schema details by deliberately
triggering errors. Mirror the push worker's allowlist
(`fundiverstw.com` + `localhost`) and replace `err.message` with
generic strings + a correlation id logged to `console.error`.

### M5. `purge_stale_pii` doesn't write to `admin_audit_log`

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603010000_pii_purge_audit_and_broaden.sql`.
Function now inserts one synthetic `admin_audit_log` row per run
with `actor_id = null`, `action = 'delete'`, `target_table =
'profiles'`, `target_id = 'pii_purge'`, and the cutoff + affected
counts + scrubbed profile ids in the `before` jsonb. Same migration
also broadens the scrub to include `nitrox_card_path`,
`deep_card_path`, and `bookings.notes`. Regression coverage in
`tests/integration/pii-purge-audit-and-broaden.test.ts`.

**Where:** `supabase/migrations/20260423150000_pii_retention_and_tos.sql`

The retention sweep nulls PII columns under the cron's service-role
context. The audit trigger gates on `auth.uid() is null or not
is_admin()` and silently drops the event — so PII deletions leave no
trace. Have the function insert one synthetic rollup row per run
(`actor_id = null`, action `'pii_purge'`, count and cutoff).

### M6. `admin_audit_log` is RLS-append-only but not trigger-append-only

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603070000_medium_tier_policy_lockdowns.sql`.
Added `public.audit_log_no_mutations()` plus
`admin_audit_log_block_update` and `admin_audit_log_block_delete`
BEFORE UPDATE / DELETE triggers that raise
`insufficient_privilege` unconditionally. Studio SQL editor running
as postgres can no longer rewrite audit history without first
explicitly `ALTER TABLE … DISABLE TRIGGER`-ing the guards (a noisy,
auditable act). The audit-write trigger that inserts into this table
fires at default trigger depth and is unaffected.

**Where:** `supabase/migrations/20260423140000_admin_audit_log.sql`

RLS gives admin SELECT only — no INSERT/UPDATE/DELETE. But the
Supabase dashboard SQL editor runs as `postgres` and bypasses RLS.
Any admin with dashboard access can rewrite audit history. Add a
BEFORE UPDATE/DELETE trigger that raises unconditionally. Service
role can still `ALTER TABLE … DISABLE TRIGGER` for legitimate
redactions, and that act itself shows in `pg_stat`.

### M7. Inconsistent admin gates: inline subqueries vs `is_admin()` helper

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603070000_medium_tier_policy_lockdowns.sql`.
Recreated every policy that used inline
`exists (select 1 from profiles where role = 'admin')` to call
`public.is_admin()` (or `public.is_staff_or_admin()` where
appropriate) instead: 4 policies on `public.duties`, 2 on
`public.admin_notes` (update + delete; select + insert were already
migrated in 20260429240000_staff_role.sql), and 12 storage.objects
policies covering the cert-cards / nitrox-cards / deep-cards admin
read/insert/update/delete tetrad.

**Where:** `admin_notes`, `duties`, `credits`, several `storage.objects`
policies, all newer migrations.

`is_admin()` exists to be the single source of truth for the admin
gate (and to avoid `profiles` → `profiles` policy recursion). Multiple
later migrations reintroduced inline `exists (select 1 from
profiles where role = 'admin')` instead. Today it works because the
self-select policy lets the EXISTS see the caller's own row, but the
intent of the helper is eroded. Forward migration that drops &
recreates each of those policies using `is_admin()` /
`is_staff_or_admin()`.

### M8. SPA Supabase client uses default `flowType: 'implicit'`

**Status: FIXED 2026-06-03** in `src/lib/supabase.ts`. The client is
now constructed with `auth: { flowType: 'pkce', autoRefreshToken:
true, persistSession: true, detectSessionInUrl: true }`. Access tokens
no longer arrive in URL fragments on magic-link / OAuth redirect (which
bled into browser history + document.referrer).

**Where:** `src/lib/supabase.ts:12`

The client is created with no `auth: { ... }` options. Default is
`implicit` flow, which puts access tokens in URL fragments on
magic-link / OAuth redirect — bleeding into browser history and
`document.referrer`. Switch to PKCE:

```ts
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
})
```

### M9. `ResetPasswordPage` unlocks on any active session, not just `PASSWORD_RECOVERY`

**Status: FIXED 2026-06-03** in `src/pages/ResetPasswordPage.tsx`. The
gate now requires `event === 'PASSWORD_RECOVERY'` exclusively;
pre-existing SIGNED_IN / INITIAL_SESSION events no longer unlock the
form. An already-signed-in user navigating to `/reset-password`
directly stays on the "Verifying reset link…" placeholder.

**Where:** `src/pages/ResetPasswordPage.tsx:27-29`

```ts
if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
```

Any signed-in user who navigates to `/reset-password` directly can
rotate their password without re-authenticating. Gate strictly on
`event === 'PASSWORD_RECOVERY'`.

### M10. Push notification `url` is followed without same-origin check

**Status: FIXED 2026-06-03.** Extracted the navigation-target
validator into `src/sw-notification-target.ts` so it can be unit
tested without the WebWorker globals; `sw.ts` imports it. The helper
returns `/` for anything that isn't a bare `/foo` same-origin path —
absolute URLs, protocol-relative `//host`, `javascript:`, relative
paths, non-strings. 7 unit cases in `src/sw-notification-target.test.ts`.

**Where:** `src/sw.ts:54-68`

`target` is taken straight from `event.notification.data.url`. A push
worker compromise (or a future admin-broadcast bug) lets a single
notification open an attacker-controlled URL under the FunDivers
context. Validate `target.startsWith('/') && !target.startsWith('//')`
in the SW before `navigate` / `openWindow`.

### M11. Root SPA `wrangler.toml` `compatibility_date` is 14 months stale

**Status: FIXED 2026-06-03.** Bumped `wrangler.toml` `compatibility_date`
from `2025-04-16` to `2026-04-01`, matching the push worker. Smoke-test
on next deploy.

**Where:** `wrangler.toml:2` → `2025-04-16`. Push worker is current at
`2026-04-01`. Stale compat dates miss security defaults Cloudflare
ships. Bump to a recent date and smoke-test.

### M12. `tsconfig.app.json` / `tsconfig.node.json` lack `"strict": true`

**Status: FIXED 2026-06-03.** Added `"strict": true` to both
`tsconfig.app.json` and `tsconfig.node.json`. The codebase compiled
clean on the first run — no implicit `any` or null-check issues
surfaced (existing typing discipline was already strict-compatible).

`workers/push/tsconfig.json` has it. The SPA tsconfigs only enable
`noUnusedLocals` / `noUnusedParameters`. Implicit `any` lets a class
of input-shape bugs ship. Add `"strict": true`, fix the resulting
errors.

### M13. Supabase edge functions have no central `import_map.json`

**Status: FIXED 2026-06-03 (in-place pin).** Replaced the floating
`jsr:@supabase/supabase-js@2` specifier with the exact pin
`jsr:@supabase/supabase-js@2.103.2` in every edge function entry
point. `nodemailer@6.9.14` and `jspdf@2.5.1` were already pinned.
This avoids the import_map.json + config.toml restructuring that the
audit suggested while still locking the version that ships per
cold start. A future centralisation pass remains an option.

Versions drift across files (`jsr:@supabase/supabase-js@2`,
`npm:nodemailer@6.9.14`, `npm:jspdf@2.5.1`). The bare `@2` floats per
cold-start. Add `supabase/functions/import_map.json` (pinning exact
versions) and wire it via `supabase/config.toml`.

---

## Low

### L1. `pii_purge` and `notify-application-decision` do not check duplicate notifications

**Status: FIXED 2026-06-03** for `notify-application-decision`.
Before flipping `profiles.status`, the function now reads the
target's current status and short-circuits with
`{ ok: true, status, email_sent: false, idempotent: true }` if it
already matches `newStatus`. A second click on Approve / Reject is a
no-op rather than a duplicate email. `pii_purge` runs from cron
under service-role and audits its own runs (M5) — re-running it
inside the retention window simply finds nothing to scrub.

Lightweight idempotency. Two admin clicks send two emails.

### L2. `notify-waitlist-offer` only authenticates by service-role Bearer

**Status: FIXED 2026-06-03.** Two defence-in-depth checks added before
the email send: offers whose `offered_at` is older than 1h return
`{ ok: true, sent: false, reason: "offer is stale" }`, and offers
with `notified_at` already set return
`{ ok: true, sent: false, reason: "offer already notified" }`. On
successful send, the function stamps `notified_at = now()` so the
next call hits the second guard. A leaked service-role key replaying
an old `offer_id` no longer triggers the email path.

If the service-role key ever leaks, an attacker can replay any
`offer_id` to mass-email waitlisted divers. Defence-in-depth: reject
offers older than 1h, reject offers already `notified_at`.

### L3. PostgREST raw error strings rendered in toasts

**Status: FIXED 2026-06-03** in `src/lib/errors.ts`. `errorMessage()`
now detects PostgREST / Postgres errors via the `code` field
(SQLSTATE) and maps the known ones to friendly user-facing strings:
23505 → "That value is already in use.", 23502 → "A required field
is missing.", 42501 → "You don't have permission to do that.",
PGRST116 → "No matching record found.", etc. The raw `.message` is
suppressed (and console.error'd for dev debugging). Authored Error
instances and `.error` string shapes still pass through unchanged.

`src/lib/errors.ts` returns `.message` verbatim. Schema-shape
disclosure (constraint names, column names) — not a credential leak
but reveals the model. Map known SQLSTATEs to friendly strings.

### L4. `RegisterForm.tsx` (~1400 lines) skips zod entirely

**Status: DEFERRED 2026-06-03.** The high-risk fields the audit
flagged (guest email, guest password, file uploads) are gated
manually today by the form's step-Next disabled checks
(`guestEmail.trim() === ''`, `guestPassword.length < 8`,
`!guestAgreedTerms`, Turnstile presence) and now by the L5
`assertUploadSize` precheck on the upload helpers. The server-side
gates (Turnstile, per-IP rate limit, event existence check, profile
patch allowlist) are the actual security boundary; the client
schema would be UX hardening, not a defence gap. A full
react-hook-form + zod rewrite of the 1400-line form remains
worthwhile but is out of scope for this security-tier sweep.

Every other form in the app uses zod + react-hook-form. The form most
likely to be exploited (public, file uploads, child bookings) is the
loosest. Incrementally add a schema.

### L5. File uploads have no client-side size cap

**Status: FIXED 2026-06-03.** New `src/lib/upload-guard.ts` exports
`MAX_UPLOAD_BYTES = 25 MB`, `FileTooLargeError`, and
`assertUploadSize(file)`. `cert-card.ts`, `nitrox-card.ts`, and
`deep-card.ts` call the guard before passing the file to
`compressImage` so a 200 MB HEIC fails fast with a friendly error
instead of OOM'ing the tab.

`heic2any` runs in-browser; a 200 MB HEIC can OOM the tab. Server
must enforce, but a precheck (`file.size > 25 * 1024 * 1024`) saves
the UX.

### L6. Inconsistent password floor: login `min(6)` vs signup/reset `min(8)`

**Status: FIXED 2026-06-03** in `src/pages/LoginPage.tsx`. Login zod
schema bumped from `min(6)` to `min(8)`, matching signup + reset.
Dev seed accounts (`diverdiver`, `adminadmin`, `staffstaff`) are all
10 chars and unaffected. `LoginPage.test.tsx` regex updated.

Unify on whatever Supabase project setting enforces.

### L7. `wix-sync` triggers + `Other_Addons` have inconsistent quoting

**Status: DEFERRED 2026-06-03.** Pure-hygiene item; the audit itself
flags it as non-blocking. Renaming the Bubble-imported tables would
ripple through every existing migration that references the
quoted-identifier form and would breach the immutability rule
(CLAUDE.md #1). Left as-is.

`"Other_Addons"` mixed-case + double-quoted is harder to audit;
non-blocking, just a footgun for future grep-by-table.

### L8. No CodeQL / Dependabot config

**Status: FIXED 2026-06-03** in `.github/dependabot.yml`. Extended
the existing `github-actions` config (added during H7) with weekly
`npm` updates for both the root `package.json` and `workers/push`,
each with a `patch` group that bundles patch releases into one PR per
ecosystem. CodeQL was not enabled — it's GitHub Advanced Security on
private repos. If the repo is public or you have GHAS, a CodeQL
workflow is a worthwhile follow-up.

`.github/` has workflows but no `dependabot.yml` / no SAST job. Add
`dependabot.yml` covering `npm` (root + `workers/push`),
`github-actions`, and `docker` (Supabase CLI).

### L9. `accept_waitlist_offer` does not re-check capacity

**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603080000_accept_waitlist_offer_capacity_recheck.sql`.
The RPC now looks up the booking's event (eo_dive_id XOR
eo_course_id), reads `capacity`, counts pending + confirmed bookings,
and refuses the accept with `check_violation` if the event is already
at-or-above capacity. Null capacity (uncapped event) skips the check.

Two waitlisters racing to accept the last spot both succeed. Not a
security issue today (admin gates final confirm) but will be once
auto-confirm is added.

### L10. `agreed_to_terms_at` from `user_metadata` (client-controlled)
**Status: FIXED 2026-06-03** in
`supabase/migrations/20260603000000_terms_consent_versioning.sql`.
`handle_new_user` now server-stamps `agreed_to_terms_at = now()` on
signup; it only reads the *presence* of the metadata key, not the
client's timestamp value. Re-acceptance via the
`accept_current_terms` RPC also server-stamps. Regression coverage
in `tests/integration/terms-consent-versioning.test.ts`.

### L11. `heic2any@0.0.4` unmaintained

**Status: TRACKED 2026-06-03.** Dependabot (L8) now opens a PR for
the next heic2any release if one ships. The L5 size guard
(`assertUploadSize`) caps input size to 25 MB so a malicious HEIC
can't OOM the tab regardless of the library's bug surface. If the
project stays dormant past the next quarter, plan a `libheif-js`
migration as a separate effort.

Pinned `0.0.x`, no recent release. Runs on user-supplied images
in-browser. Track CVEs; consider `libheif-js` if the project goes
fully dormant.

### L12. Stale auth-state flash on sign-out

**Status: FIXED 2026-06-03.** New `src/hooks/AuthProvider.tsx` runs
the supabase auth subscription once at the top of the React tree;
`src/hooks/auth-context.ts` exports the context type; `useAuth.ts`
now just reads from context via `useContext` and throws if a caller
renders outside the provider. `App.tsx` wraps the route tree in
`<AuthProvider>`. Every component that calls `useAuth()` now shares
one session / user / profile / loading state — sign-out updates flow
to all consumers in lockstep, no stale-flash window. `useAuth.test.tsx`
updated to render through the provider via the renderHook `wrapper`
option (10 cases, all green).

Multiple components call `useAuth()` directly; each holds its own
state. After sign-out, a stale `profile` can flash in one component
while another has already cleared. Lift to `AuthContext` (one
provider, one source of truth).

### L13. `BROADCAST_WEBHOOK_URL` forwards admin-controlled body unchanged

**Status: FIXED 2026-06-03** in `workers/push/src/index.ts`.
Admin-supplied title is capped at 120 chars and body at 500 chars
via `.trim().slice(...)` before the push fan-out / webhook forward.
Keeps the push payload under VAPID's 4 KB body limit and bounds the
downstream surface for any future LINE/Slack/etc. integration.

Operator-configured URL, so no SSRF, but the admin payload is sent
verbatim to a third-party endpoint. Cap title/body lengths server-side
(120/500 chars) before fan-out.

---

## Informational

- **I1.** No `dangerouslySetInnerHTML`, `eval`, `new Function`,
  `innerHTML`, or markdown library anywhere in `src/`. XSS surface is
  minimal by construction.
- **I2.** All `target="_blank"` links carry `rel="noopener
  noreferrer"`.
- **I3.** `localStorage` use is limited to Supabase session +
  minigame high scores. No tokens written by app code.
- **I4.** `package-lock.json` present at root and in `workers/push/`;
  CI uses `npm ci`. No `^0.x` floats except `heic2any` (L11).
- **I5.** XOR FK constraints (`bookings_event_xor`,
  `admin_notes_target_xor`) are enforced correctly. The docs still
  mention `event_memos`; that table was renamed to `admin_notes`.
- **I6.** Audit-log trigger
  (`20260423140000_admin_audit_log.sql`) is the correct template:
  `SECURITY DEFINER` + `SET search_path = public` + append-only RLS.
  Reuse it.
- **I7.** Storage buckets `cert-cards`, `nitrox-cards`, `deep-cards`
  are private with per-folder ownership policies.
- **I8.** No real service-role key, VAPID private key, Gmail app
  password, or JWT was found in the repo. `.gitignore` correctly
  excludes `.env.local` / `.env.production` / `.env.push` / `dist/`.
  The C3 Wix token is the only secret-in-repo.
- **I9.** Push worker enforces a strict origin allowlist
  (`workers/push/src/index.ts:99-114`), doesn't forward cookies,
  doesn't mutate inbound headers. Good.
- **I10.** Edge functions log `err.message`, never full error
  objects. No accidental env-dump paths found.
- **I11.** `compatibility_flags = ["nodejs_compat"]` in
  `workers/push/wrangler.toml` is necessary for `web-push`.
- **I12.** `dist/` builds are gitignored; no leaked bundle in
  history.

---

## Suggested patch plan

Order is roughly "biggest exposure reduction per hour."

1. **Same-day, mandatory:**
   - C2 — allowlist `profile_patch` in `create-registration` (and the
     other 6 edge functions that accept any profile patch shape).
   - C1 + H1 — single forward migration adding
     `profiles_block_self_privileged_change` trigger.
   - C3 — rotate Wix token, store in vault, forward migration to drop
     & recreate the 9 triggers reading from vault.
   - H4 — narrow SW cache to a read-mostly allowlist, exclude
     `/auth/v1/`, add `signOut` → cache-flush message.
   - H5 — add CSP / `X-Frame-Options` / `nosniff` via a thin SPA
     Worker handler.

2. **This week:**
   - H2 — Turnstile + rate-limit on `create-registration`.
   - H3 — `set search_path = public` on the four `SECURITY DEFINER`
     functions.
   - H6 — audit-log row in `notify-application-decision`.
   - H7 — `permissions:` blocks + action SHA pins + environment gates
     on the three workflows.
   - H8 — revoke DDL `INSERT/UPDATE/DELETE/TRUNCATE` from `anon` on
     `EO_*`.

3. **Pre-launch hardening:**
   - M1, M2, M3, M5, M6, M7, M8, M9, M10 — one consolidated migration
     + small SPA PR.
   - M11, M12, M13 — bump compat_date, enable `strict`, central
     import_map.

4. **Ongoing:**
   - All Low items as opportunistic cleanup during normal feature
     work.
   - L8 — Dependabot + CodeQL.
   - Schedule quarterly rotation of `SUPABASE_DB_PASSWORD`,
     `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`,
     `GMAIL_APP_PASSWORD`, `ADMIN_TRIGGER_SECRET`,
     `CLOUDFLARE_API_TOKEN`, and document it in
     `docs/deployment.md`.

---

## Coverage caveats

- This audit reads source, not the live Supabase project. RLS toggles
  flipped via the dashboard, JWT lifetime / refresh policy,
  email-verification settings, and Auth provider configuration could
  not be checked.
- Cloudflare WAF / firewall rules are out-of-scope; the report assumes
  default Cloudflare protection.
- The Wix endpoint at
  `https://fundiverstw.com/_functions/supabaseWebhook` is third-party
  code; the impact of forged sync events (C3) depends on its
  implementation.
- The audit reflects the state of the repo at 2026-06-02. Migrations
  are immutable but new ones land regularly — re-run the high-level
  RLS sweep after any migration touching `profiles`, `bookings`,
  `payments`, or `storage.objects` policies.
