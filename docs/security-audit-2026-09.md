# Security audit — 2026-09-11

Third full audit. The first (`security-audit.md`, 2026-06-02) and second
(`security-audit-2026-08.md`, 2026-08-07) closed every finding they raised.
This one re-tested those invariants and covered the ~5 weeks of work since:
three new admin edge functions (`admin-create-diver`, `admin-set-temp-password`,
`export-database-backup`), crowdsourced dive sites, dive site maps, the wildlife
taxon catalog, the almanac review flow, shop-authored payment methods, contact
and shop profile, account refunds, and profile value normalization.

**Scope:** both repos — `app-fundivers` (the shop deployment, private) and
`fundive` (the platform, public). SPA, migrations, all 19 edge functions, the
push worker, CI workflows, dependencies, storage, and runtime config.

**Method:** claims were tested, not read. RLS and privilege findings were probed
against both live local stacks as `anon` and as an unprivileged diver, using
`set local role` with a forged JWT claim inside rolled-back transactions. Where
a table held no adversarial rows (no private events, no pending proposals), the
fixtures were seeded inside the transaction first — a sweep against data that
cannot express the attack proves nothing. The two databases were diffed against
each other object by object: 216 policies, 121 functions, and every table grant.

**Out of scope:** the Supabase dashboard (auth provider config, JWT lifetime,
production storage limits), Cloudflare WAF/DNS, the Gmail account, and anything
needing a third-party dashboard login.

---

## Result

**2 High (fundive only), 2 Medium, 5 Low.** Nothing found in app-fundivers
rises above Low.

Both Highs are fixed, in `20260911100000` and `20260911110000`, each with an
integration test confirmed to fail against the pre-fix database. Everything
else is open.

| # | Sev | Finding | Repo | Status |
|---|-----|---------|------|--------|
| H1 | High | `normalize_profile_values()` executable by `anon` — unauthenticated rewrite of every profile | fundive | **FIXED** |
| H2 | High | Baseline default privileges grant `anon` ALL on new tables and functions | fundive | **FIXED** |
| M1 | Medium | Terms consent is self-stampable; `accept_current_terms`' stated guarantee does not hold | both | Open |
| M2 | Medium | jsPDF 2.5.1 runs server-side on diver-supplied text; 4 advisories, one critical | both | Open |
| L1 | Low | Shop bank account details readable by `anon` | both | Open |
| L2 | Low | `anon` holds DML on nearly every table; RLS is the sole control | both | fundive **FIXED**; app open |
| L3 | Low | Storage buckets carry no size or MIME limit | both | Open |
| L4 | Low | `admin-set-temp-password` can silently take over another admin | both | Open |
| L5 | Low | `rls_auto_enable()` is never wired to an event trigger | both | Open |

The two Highs are the same root cause, and both are specific to the public
repo. app-fundivers' squashed baseline has hardened default privileges;
fundive's captured Supabase's permissive stock defaults. That difference is why
an identical migration produced a safe grant in one database and an exploitable
one in the other — and it is inherited by every shop that forks fundive.

---

## Findings

### H1 — `normalize_profile_values()` is callable by `anon` *(fundive)* — FIXED

`public.normalize_profile_values()` is `SECURITY DEFINER`, owned by `postgres`,
and carries no authorization check of its own. In fundive's database, `anon`
holds EXECUTE on it:

```
{postgres=X/postgres,anon=X/postgres,service_role=X/postgres}
```

PostgREST exposes every executable function as an RPC endpoint, so the whole
capability is reachable with nothing but the public anon key — the key that
ships in the SPA bundle by design. Verified end to end against the local stack:

```
POST /rest/v1/rpc/normalize_profile_values
apikey: <public anon key>          →  HTTP 200, body: 6
```

Six profile rows were rewritten by a caller holding no session. The function:

- rewrites `cert_level` and `nationality` across **every** row of `profiles`,
- writes a row to `profile_value_normalizations` for each change,
- and, around that work, runs
  `alter table public.profiles disable trigger profiles_maybe_set_submitted_at_trg`
  and re-enables it.

Two distinct impacts. First, unauthenticated mutation of every diver's
certification and nationality — the fields the shop reads to decide who may
dive what. Second, the `ALTER TABLE` takes a `ShareRowExclusiveLock` on
`profiles` (measured, not assumed), which blocks every concurrent write to the
table. A loop on this endpoint is an unauthenticated write-outage on signup,
profile edits, and everything else that touches `profiles`. The function is not
covered by `take_action_slot`, so there is no ceiling on the loop.

Root cause is one missing word. The migration is byte-identical in both repos:

```sql
revoke all on function public.normalize_profile_values() from public, authenticated;
grant execute on function public.normalize_profile_values() to service_role;
```

`revoke ... from public` strips the implicit PUBLIC grant, but `anon` holds an
*explicit* grant handed to it by the default privileges in H2, and an explicit
grant survives a revoke aimed at PUBLIC. app-fundivers has no such default, so
the same file left the function correctly restricted there:

```
app-fundivers: {postgres=X/postgres,service_role=X/postgres}       (safe)
fundive:       {postgres=X/postgres,anon=X/postgres,...}           (exploitable)
```

**Status: fixed** in `20260911100000_revoke_anon_execute_on_normalize_profile_values.sql`,
which adds `anon` to the revoke. Re-running the exploit against the patched
database returns `401 {"code":"42501","message":"permission denied for function
normalize_profile_values"}`; `service_role`, the path the admin Manage page
uses, still executes it. Guarded by a case in
`tests/integration/anon-definer-rpc-lockdown.test.ts`, confirmed to fail before
the fix. H2 removes the default that created the gap.

### H2 — New objects grant `anon` write privileges *(fundive)* — FIXED

Settled by probe rather than by reading the baselines, because the dumps are
easy to misread. One table and one function were created as `postgres` in each
database, inside a rolled-back transaction:

```
fundive:       new table -> anon S=true  I=true  U=true  D=true
app-fundivers: new table -> anon S=false I=false U=false D=false
```

The cause is in the two squashed baselines:

```sql
-- app-fundivers 20260707230000
ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES ... GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";

-- fundive 20260708090000
ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO "anon";
```

app-fundivers tightened Supabase's stock defaults; fundive's baseline captured
them as shipped. Every table created in fundive since therefore grants the
logged-out role full DML, and every function grants it EXECUTE.

Worth separating the function half carefully, because it is not quite what it
looks like. PostgreSQL's own built-in default grants `EXECUTE` on a new function
to `PUBLIC`, and `anon` is in `PUBLIC` — that is true in **both** repos, and it
is why every migration in this schema writes `revoke all on function ... from
public, anon`. What fundive adds on top is an *explicit* `anon` grant, and an
explicit grant is not removed by a revoke aimed at `PUBLIC`. That is exactly the
gap H1 fell through.

Nothing was exploitable through the table half: all 65 tables have RLS enabled,
and not one policy in the schema grants `anon` an INSERT, UPDATE or DELETE —
checked explicitly, because a blanket revoke would have broken the logged-out
register form if one did. RLS was carrying the whole load alone, and
`rls_auto_enable()`, the event trigger that would catch a table shipped without
RLS, is defined in the baseline but wired to nothing (L5). A forked shop that
adds a table and forgets `enable row level security` publishes it to the
internet, readable and writable.

That is why this is rated High despite nothing being exploitable today: fundive
is what shops fork, so the baseline's defaults become theirs.

**Status: fixed** in `20260911110000_anon_holds_no_write_privileges.sql`. The
default privileges are set to match app-fundivers exactly rather than to a third
posture — drift between the two schemas is what produced H1, so the fix is
parity. `anon`'s INSERT/UPDATE/DELETE are also revoked on the tables that
already carried them (64 tables to 0), with SELECT deliberately left intact for
the catalog tables the register form reads before sign-in. Verified after the
migration: a new table in fundive now grants `anon` exactly what one in
app-fundivers does, and all 64 anon-readable tables still read.

Guarded by `tests/integration/anon-write-lockdown.test.ts`, which distinguishes
the two layers by message — `permission denied for table X` (no grant) versus
`new row violates row-level security policy` (grant present, RLS refusing). All
16 write assertions were confirmed to fail against the pre-fix grants; a test
that only asserted `error !== null` would have passed either way.

### M1 — Terms consent can be self-stamped *(both)*

`src/types/database.ts` states the guarantee `accept_current_terms` was built to
provide:

> No arguments on purpose: the server reads `public.terms.version` itself, so a
> modified client can't consent to a version it was never shown.

That guarantee does not hold. `profiles: self update` is column-blind —
`USING (auth.uid() = id)` — and `block_self_privileged_profile_change()` guards
only `role`, `status` and `parent_account`. `agreed_to_terms_at` and
`agreed_to_terms_version` are unguarded. Confirmed in both databases as an
unprivileged diver:

```
update public.profiles set agreed_to_terms_at = now(), agreed_to_terms_version = 99
 →  consented = t, version = 99
```

A diver can reach the same state through `PATCH /rest/v1/profiles?id=eq.<self>`.
Two consequences:

- `RequireCurrentTerms` forces re-acceptance when the shop publishes new terms
  by comparing `agreed_to_terms_version` against `terms.version`. A diver who
  sets the column to a large integer never sees that gate again, for any future
  version.
- Consent is the shop's legal record that a diver accepted the terms, and the
  token flow (`terms_consent_tokens`, `accept_terms_with_token`) was built to
  make that record rigorous for admin-minted walk-ins — single-use, atomic,
  server-read version. All of that care is bypassed by a column the subject of
  the record can write directly, which weakens the evidentiary value of every
  consent row, not just forged ones.

Worth noting why the column is writable: `SignupPage.tsx` and `RegisterForm.tsx`
both write `agreed_to_terms_at` / `agreed_to_terms_version` from the client at
signup. Closing this means routing those two writes through the server-stamping
RPC first, then adding the columns to the guard trigger.

The neighboring self-asserted fields — `cert_level`, `nitrox_certified`,
`deep_certified`, `logged_dives`, `uncertified` — are also diver-writable, but
that is a documented decision rather than a finding.
`_shared/registration-eligibility.ts` says so plainly ("the shop settles
certification at the counter") and treats the values as an acknowledgment gate,
not an authorization one. No change recommended.

### M2 — jsPDF 2.5.1 renders diver-supplied text server-side *(both)*

`supabase/functions/_shared/pdf.ts` pins `npm:jspdf@2.5.1`. That version is
subject to four advisories:

| Advisory | Severity | Affected |
|----------|----------|----------|
| GHSA-f8cm-6447-x5h2 — Local File Inclusion / path traversal | critical | `<=3.0.4` |
| GHSA-8mvj-3j78-4qmw — DoS, CVSS 7.5 `AV:N/AC:L/PR:N/UI:N/A:H` | high | `<=3.0.1` |
| GHSA-w532-jxjh-hjhj — ReDoS | high | `<3.0.1` |
| GHSA-pqxr-3g65-p328 — AcroForm PDF injection → arbitrary JS | high | see advisory |

`npm audit` does not see this copy. jsPDF is a devDependency of the SPA, so
`npm audit --omit=dev` reports it clean; the edge functions pull their own copy
through a Deno `npm:` specifier that no lockfile audit covers. The dependency
that matters is the one the audit cannot see.

Reachability, stated precisely. The input path is confirmed: `row()` at
`pdf.ts:207` calls `doc.splitTextToSize(v, ...)` on diver-supplied field values
— names, notes, emergency contacts — and twelve further call sites do the same
across the registration, group summary and waiver record builders. Text wrapping
is the documented vector for both DoS advisories, and this runs server-side in
an edge function, so the cost of a slow parse is the shop's CPU rather than the
attacker's browser. What was **not** done is craft a payload proving a hang;
the severity reflects a confirmed input path, not a demonstrated exploit.

The critical path-traversal advisory concerns file-loading APIs. The only
`addImage` calls take `logo.dataUrl`, built by `_shared/shop-logo.ts` from an
admin-written `shop_profile.logo_path`. Diver input never reaches a
file-loading API, so that one is not reachable here. `AcroForm` is not used.

Upgrading past 3.0.4 is the fix, and it is a real upgrade — jsPDF 3.x changed
its font and API surface, and the CJK font embedding in `pdf-fonts.ts` is
exactly the area that moved. Treat it as scheduled work, not a one-line bump.

### L1 — Shop bank details are readable by `anon` *(both)*

`payment_methods` carries `bank_name`, `bank_branch`, `bank_code`,
`account_number`, `account_holder` and `swift_bic`, and its select policy is
`USING (true)` for `anon, authenticated`. Anyone on the internet holding the
public anon key can read the shop's bank account.

The policy comment gives the reason — "the register form has to render the
options before sign-in completes" — and it is a good reason for `label`,
`blurb`, `surcharge_percent` and `sort_order`. It is not a reason for the
account number, which only a diver with something to pay needs.

Real-world consequence is payment-redirect fraud: scraped genuine bank details
make a "our account has changed" message to the shop's divers considerably more
convincing. Splitting the transfer columns behind an `authenticated`-only policy
(or a view) keeps the register form working and takes the account number off the
open web.

### L2 — `anon` holds DML on nearly every table *(both)*

Correcting an earlier reading of this. A relative diff of the two databases
surfaced only `almanac_records`, which made it look like a stray grant unique to
app-fundivers. Checked absolutely rather than as a diff, the picture reverses:

```
app-fundivers:  65 of 65 tables grant anon INSERT/UPDATE/DELETE
fundive:        64 of 65   (before 20260911110000)
```

`almanac_records` is not the outlier that is broken — it is the one table
fundive got *right*, because its migration writes an explicit
`revoke all on table public.almanac_records from anon, authenticated`. Every
other table simply inherited the defaults. The affected list includes
`profiles`, `payments`, `credits`, `bookings`, `admin_audit_log`,
`waiver_signatures` and `terms_consent_tokens`.

None of it is exploitable. There is not a single INSERT, UPDATE or DELETE policy
granted to `anon` anywhere in either schema, so RLS refuses every one of these
writes — verified by probe in both databases and over HTTP. This is the normal
Supabase posture, where broad table grants are expected and RLS is the
authorization layer. It is recorded because it means RLS is the *only* layer,
across every table, in a schema whose security model is otherwise carefully
two-layered.

**Status: fixed in fundive** by `20260911110000` (64 tables to 0, SELECT
retained). Open in app-fundivers, where the same revoke would apply cleanly.

One loose end worth the owner's attention. app-fundivers' own baseline grants
`profiles` only `REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` to `anon`, and a table
created there today gets no DML at all — yet its live local database shows
`anon=arwdDxtm` on all 65 tables, including tables created by migrations well
after the baseline. Its local grants therefore do not match what its own
migrations produce, and `supabase/seed.sql` contains no GRANT statements to
explain it. Provenance was not established. **Check production's actual grants
read-only before assuming either state**, since that database is the one that
matters and this audit could not reach it.

Separately: these defaults leave `anon` holding `TRUNCATE`, which is exempt from
RLS, on every table in both repos. PostgREST exposes no TRUNCATE verb so it is
unreachable over the API, and it was deliberately left alone by the fix rather
than changed in one repo only — but it is the one privilege in this group that
RLS would not stop, and it belongs in a change that moves both repos together.

### L3 — Storage buckets carry no size or MIME limit *(both)*

All five buckets have `file_size_limit` and `allowed_mime_types` null:

```
cert-cards | deep-cards | nitrox-cards | waiver-pdfs | shop-logo
```

They fall back to the project-wide limit, 50MiB in `config.toml`. Any active
diver can write to `cert-cards`, `nitrox-cards` and `deep-cards` under their own
uid folder, so any diver can store an unlimited number of 50MiB objects of any
content type. The client compresses images before upload (`lib/cert-card.ts`),
but that is client-side and not a control.

Two consequences, both modest: storage cost growth with no ceiling, and the
shop's storage serving arbitrary attacker-supplied content types through signed
URLs. Setting `allowed_mime_types` to the image types the app actually accepts,
and a per-bucket `file_size_limit` in the low megabytes, costs nothing.

Note the production values are a dashboard setting and were not checked; this
finding is from the committed config and the bucket rows.

### L4 — `admin-set-temp-password` can silently take over another admin *(both)*

The function issues a fresh random password for any `user_id` and returns the
plaintext once. It correctly refuses non-admin callers, never exposes an
existing password, and writes an `admin_audit_log` row without the secret. All
of that is right.

What it does not do is exclude admin targets or notify the target. One
compromised admin session can seize every other admin account, and the only
trace is a log row in a table the victim cannot read. There is also no
`take_action_slot` ceiling, so the takeover can be scripted across all accounts
in one pass.

This is inherent to having admins and is not an escalation from outside the
trust boundary, which is why it is Low. An email to the target ("an
administrator issued a temporary password for your account") turns a silent
takeover into a noisy one for the cost of one `sendMail`.

### L5 — `rls_auto_enable()` is never wired *(both)*

`public.rls_auto_enable()` exists in both baselines as an `event_trigger`
function that enables RLS on newly created tables, and it logs a message when it
does. `CREATE EVENT TRIGGER` appears in no migration in either repo, and
`pg_event_trigger` lists only the eight stock Supabase entries in both
databases. The function has never fired.

Harmless in app-fundivers, where the default privileges mean a table missing RLS
is at least not granted to `anon`. In fundive it is the missing backstop that
would make H2 survivable. Either wire it or delete it — a safety net that is
present in the schema but not in `pg_event_trigger` is worse than no safety net,
because it reads like coverage.

---

## What was verified clean

Recorded so a future audit does not re-derive it. Each was tested against a live
database, not assumed.

- **RLS holds, and the two repos are identical.** 216 policies in each database,
  diffed by name, command, roles, `USING` and `WITH CHECK` — zero differences.
  All 65 tables have RLS enabled in both; the four with no policies
  (`orphan_auth_users`, `push_notifications_sent`, `signup_attempts`,
  `user_action_attempts`) are deny-all service-role tables.
- **Reads are correctly scoped.** As an unprivileged diver: 1 profile of 37,
  3 bookings of 54, and zero rows in `payments`, `credits`, `dive_logs`,
  `diver_notes`, `admin_notes`, `duties`, `notifications`, `waiver_signatures`,
  `push_subscriptions`, `admin_audit_log`, `staff_availability`,
  `terms_consent_tokens`, `trusted_partners`, `coral_surveys`,
  `profile_value_normalizations`, and all six `dive_site_*` tables.
- **New feature surfaces were probed with seeded adversarial rows**, since the
  local data expressed none of these cases. A private event, another diver's
  pending taxon proposal, and another diver's pending almanac record were each
  inserted inside the transaction. A non-participant diver saw **0** of all
  three. The M1 fix from the last audit still holds, and the almanac review flow
  and taxon proposal flow do not leak pending submissions between divers.
- **All 85 `SECURITY DEFINER` routines pin `search_path`** in both databases,
  checked via `pg_proc.proconfig` rather than by parsing SQL.
- **Every anon-executable RPC fails closed.** `replace_gear_model_sizes` raises
  "admin only"; `update_diver_gear_sizes` raises "staff or admin required";
  `sign_waiver` raises "must be authenticated"; `cancel_my_package_registration`
  and `cancel_my_scheduled_trip_registration` scope to `auth.uid()`, which is
  null for `anon`, so they match nothing; `list_my_*` return zero rows. The one
  exception is H1.
- **The three new admin edge functions are correctly gated.**
  `admin-create-diver`, `admin-set-temp-password` and `export-database-backup`
  each resolve the caller from the bearer JWT with the anon client, then confirm
  `profiles.role = 'admin'` with the service-role client. `export-database-backup`
  is deliberately admin-only rather than staff, is rate-limited at 5/24h, caps
  at 250k rows, and refuses to page a table with no primary key rather than
  shipping a silently wrong archive. `backup_table_inventory()` is revoked from
  `public, anon, authenticated` and granted only to `service_role`.
- **Rate-limit coverage is complete for what needs it.** Seven functions are
  unlimited; every one is admin- or staff-gated (`admin-create-diver`,
  `admin-set-temp-password`, `export-diver-waivers`, `export-event-divers`,
  `notify-application-decision`, `notify-booking-confirmed`,
  `notify-event-cancellation`, `send-terms-request`), service-role-gated
  (`notify-waitlist-offer` compares the bearer against `SUPABASE_SERVICE_ROLE_KEY`),
  Turnstile-gated (`create-account`, `create-registration`), or carries its own
  cooldown table (`request-dive-log-export`). M2 from the last audit still holds.
- **Turnstile fails closed.** Both unauthenticated endpoints return 500 when
  `TURNSTILE_SECRET` is unset rather than accepting the request.
- **CORS is allowlisted, not `*`**, and `safeError` suppresses PostgREST
  messages for anything carrying a SQLSTATE.
- **Storage policies are correctly scoped.** Card buckets are private, with
  own-folder and parent-of-child access keyed on `storage.foldername(name)[1]`,
  plus admin. `shop-logo` is the only public bucket and is admin-write-only.
  `waiver-pdfs` stays `authenticated read` for the reason the last audit
  recorded — it holds blank templates every diver must read to sign.
- **Profile privilege escalation stays closed.** A diver cannot change `role`,
  `status` or `parent_account` on their own row, cannot adopt another user as a
  child (`UPDATE 0`), and cannot set their own gear sizes.
  `profiles.email` is writable in principle but a `BEFORE` trigger overwrites it
  from `auth.users`, and every edge function reads `u.user.email` from auth
  rather than the profile column — confirmed, not assumed.
- **No XSS sinks.** `dangerouslySetInnerHTML`, `innerHTML`, `eval` and `srcdoc`
  appear nowhere in application code in either repo. fundive's one
  `new Function` is in `src/vite/index.ts`, a build-time Node config loader
  evaluating esbuild output, not browser code.
- **CI is sound.** `permissions: contents: read` on all three workflows, every
  action pinned to a full commit SHA, no `pull_request_target`, and both deploy
  workflows gated to `workflow_dispatch` plus `environment: production`.
- **Supply chain, SPA.** The only production advisory is `react-router`'s RSC-mode
  CSRF bypass, which does not apply to a `BrowserRouter` SPA — unchanged from the
  last audit. The remaining 15 are devDependencies, mostly under `wrangler`. The
  exception is jsPDF, which `npm audit` misclassifies as dev-only; see M2.

---

## Notes for the next audit

- **Diff the two databases directly.** Both High findings came out of comparing
  `pg_proc` ACLs and `pg_default_acl` between the stacks, not from reading
  either repo. Identical migration text does not imply identical grants, because
  the baselines the text lands on differ. Three commands: policy diff, function
  grant diff, table grant diff.
- **Seed the attack before sweeping for it.** The first visibility sweep looked
  clean and proved almost nothing — the database held no private events, no
  pending taxa and no almanac records. Insert the adversarial row inside the
  rolled-back transaction, then look.
- **`npm audit` does not cover the edge functions.** They pull dependencies
  through Deno `npm:` specifiers that no lockfile describes. Grep
  `supabase/functions/` for `npm:` and check those versions by hand.
- **Watch the column-blind self-update policies.** `profiles: self update` and
  `bookings: self update` are safe only for as long as the guard triggers
  enumerate every column worth protecting. Both have grown columns since the
  triggers were written, and M1 is what that looks like. Any migration adding a
  column to either table should be read as a question about those triggers.

---

## Appendix — local stack changes made during this audit

Probing was done inside rolled-back transactions with two exceptions, both on
local databases only. Production was never touched.

- The H1 proof-of-concept committed: it rewrote 6 `cert_level` values in
  fundive's local database and wrote 6 `profile_value_normalizations` rows.
  Reverted from the normalization log; both tables are back to their prior
  state.
- A `ShareRowExclusiveLock` measurement on fundive's `profiles` ran and rolled
  back.
