# Security audit — 2026-08-07

Second full audit. The first (`security-audit.md`, 2026-06-02) closed every
finding it raised; this one re-tested that work and covered the ~480 commits
since, including ten new edge functions, packages, scheduled trips,
shop-authored terms and waivers, the ride/waitlist system, and event series.

**Scope:** both repos — `app-fundivers` (the shop deployment, private) and
`fundive` (the platform, public). SPA, migrations, all 17 edge functions, the
push worker, CI workflows, dependencies, and runtime config.

**Method:** claims were tested, not read. RLS and privilege findings were
probed against a live local stack as an unprivileged diver, using
`set local role` with a forged JWT claim, inside rolled-back transactions.
Every fix ships with a test that was confirmed to **fail before the fix** —
a test that passes both before and after proves nothing.

**Out of scope:** the Supabase dashboard (auth provider config, JWT lifetime),
Cloudflare WAF/DNS, the Gmail account, the Wix endpoint, and anything needing
a third-party dashboard login.

---

## Result

**1 Critical (not pursued, see below), 3 Medium, 3 Low. All Mediums and Lows
are fixed in both repos.**

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| C1 | Critical | Wix sync token present in the public repo's git history | Not pursued — owner's decision |
| M1 | Medium | `events` select policy was `USING (true)`: anon read private events | Fixed |
| M2 | Medium | No rate limit on six authenticated mail-sending endpoints | Fixed |
| M3 | Medium | `create-child-account` unbounded, with an attacker-chosen email | Fixed |
| L1 | Low | `group_id` self-asserted membership exposed the group PII PDF | Fixed |
| L2 | Low | Registration draft PII survived sign-out | Fixed |
| L3 | Low | Past-event guard never fired for `adventure` (fundive only) | Fixed |

---

## What was verified clean

Recorded so a future audit doesn't re-derive it. Each was tested, not assumed.

- **RLS holds.** As an ordinary diver: 1 profile visible of 149, own bookings
  only, and zero rows in `payments`, `credits`, `dive_logs`, `diver_notes`,
  `admin_notes`, `duties`, `notifications`, `waiver_signatures`,
  `push_subscriptions`, `admin_audit_log`, `staff_availability`. All 46 tables
  have RLS enabled; the three with no policies are deny-all service-role
  tables.
- **All 52 `SECURITY DEFINER` routines pin `search_path`.** Checked via
  `pg_proc.proconfig`, not by parsing SQL — a text pass wrongly flagged 41,
  because quoted and unquoted identifiers made later redefinitions look like
  the originals.
- **Privileged RPCs self-check.** Called as a diver, `admin_delete_user`,
  `admin_record_paper_waiver`, `record_group_payment` and
  `replace_gear_model_sizes` all raise "admin only";
  `update_diver_gear_sizes` raises "staff or admin required";
  `apply_credit_to_booking` on another diver's booking raises "not your
  booking". `sign_waiver` binds to the caller's own `auth.uid()`.
- **The column-blind `bookings: self update` policy is safe** — triggers reject
  both self-confirmation and edits to `details.total`.
- **`create-registration` is hardened**: Turnstile, per-IP/email rate limit,
  allowlisted `profile_patch`, and money recomputed from the `prices` table.
  `payer_id` is validated against the registrant/caller.
- **No anon EXECUTE on privileged RPCs in app-fundivers**, including
  `purge_stale_pii`. fundive needed a migration for this; the shop deployment
  was already correct, confirmed function by function.
- **No XSS sinks** (`dangerouslySetInnerHTML`, `innerHTML`, `eval` appear
  nowhere), no secrets in the bundle, and all five `VITE_*` vars are
  public-by-design.
- **`waiver-pdfs`' `authenticated read` is correct** — that bucket holds
  admin-uploaded *blank templates* every diver must read in order to sign.
  Signed records live in `waiver_signatures`; per-diver PDFs are built on
  demand, never stored.
- **Terms-consent token RPCs are sound**: single-use atomic claim, no
  existence oracle, version read server-side.
- **Supply chain**: of nine "high" advisories, none are production-reachable.
  Eight are under `wrangler`, a devDependency. The one runtime package,
  `react-router-dom`, is affected only in RSC mode; this is a `BrowserRouter`
  SPA. Worth upgrading as hygiene, not urgently.
- **CI**: `permissions: contents: read` on both workflows, every action pinned
  to a full commit SHA, deploys gated to `workflow_dispatch` + `main` +
  a production environment.

---

## Findings

### C1 — Wix sync token in public git history *(not pursued)*

The token `cec9e630…` appears in at least eight commits of `fundive/fundive`,
which is public, alongside the endpoint and header needed to use it. Current
code in both repos is clean — the value is read from `vault.decrypted_secrets`,
and fundive removed Wix sync entirely — so this is history-only exposure.

The owner elected not to pursue this. Recorded here as a decision, not an
oversight. Should it be revisited, rotation on the Wix side is the only real
fix: rewriting public history cannot un-publish a value that has been
fetchable.

### M1 — Private events were world-readable *(fixed)*

`events public select` was `USING (true)` for `anon` and `authenticated`. The
only thing hiding a private event was a client-side query filter in
`src/lib/events.ts`. Confirmed by probe: as `anon`, a seeded private event
returned its title and dates.

Fixed in `20260811000000_restrict_private_events_to_participants.sql` (fundive:
`20260813000000_…`) by splitting into two role-scoped policies. `anon` gets
`is_private = false` — a single boolean, so the logged-out path never needs
EXECUTE on a definer helper. `authenticated` additionally passes for
`is_staff_or_admin()` or the new `is_booked_on_event()`.

Cancelled events stay readable deliberately: a cancelled event was public
before cancellation, and must remain visible to the divers being told it is
off.

### M2 — Unbounded mail-sending endpoints *(fixed)*

Fifteen edge functions send mail; only two bounded it. Six reachable by any
signed-in diver were unbounded, so one account could exhaust the shop's Gmail
quota — which also carries waitlist offers, booking confirmations and
cancellation notices. That is a denial of service on shop operations, from any
account, with no privilege required.

Fixed with one shared limiter: `take_action_slot()` over
`user_action_attempts` (`20260813000000_…`), with limits in
`supabase/functions/_shared/rate-limit.ts`. It takes a `pg_advisory_xact_lock`
so the ceiling is exact rather than approximate — verified with 20 parallel
connections against a limit of 5: exactly 5 allowed.

It **fails open**: if the RPC errors the request proceeds and the failure is
logged. A limiter that has lost its database should not become an outage of
its own.

`dive_log_export_requests` is left alone — the SPA reads it to render a
countdown, so folding it in would be a behavior change dressed as a refactor.

### M3 — Child-account creation *(fixed)*

Any active diver could mint auth users for arbitrary email addresses with no
ceiling: amplification through the shop's SMTP reputation, and squatting of
addresses that then sit permanently parented to a stranger, whose parent-RLS
reads the profile and its bookings.

Fixed in three layers: `trg_profiles_child_account_cap` caps a diver at ten
children (staff and admin parents exempt, keyed on the parent's role); every
creation writes an `admin_audit_log` row naming the parent as actor; and the
courtesy email now names the parent and offers a way to repudiate.

**Residual, accepted:** a diver may still claim up to ten addresses that are
not theirs. Eliminating that means minting the login under a synthetic address
and keeping the real one purely as contact — a `profiles` column split touching
every surface that shows a diver's email.

### L1 — Group membership was self-asserted *(fixed)*

`bookings.group_id` was client-generated and unvalidated, and
`send-group-summary` authorizes on "you hold a booking in this group". The
group PDF carries every member's name, date of birth, nationality and
certification, so `group_id` was a capability token by accident — unguessable
only because the client mints it with `crypto.randomUUID()`.

`create-registration` now refuses a `group_id` whose existing bookings belong
to anyone but the caller or a child they manage.

### L2 — Registration draft PII survived sign-out *(fixed)*

A half-finished registration keeps date of birth, national ID number and
emergency contact in `localStorage` for 14 days. Sign-out cleared the service
worker cache but not these. `clearAllRegistrationDrafts()` now runs on sign-out.

### L3 — Past-event guard skipped adventures *(fixed, fundive only)*

`eventHasPassed` selected columns with `eventType === "dive"` but branched on
`usesDateEnvelope()`. For `adventure` those disagree, so `lastDay` was null and
every past adventure was accepted. Exactly the trap CLAUDE.md rule 6 describes.

The bug was invisible to unit tests because the mock returned all columns
regardless of the `select()` list. The mock now projects to the requested
columns, which makes this whole class of bug catchable.

---

## Notes for the next audit

- Test against the live database, as an unprivileged role. Three of this
  audit's strongest conclusions — and one of its false alarms — came from
  probing rather than reading.
- Confirm each new test fails before its fix.
- The two repos share ~95% of their security surface but are not identical:
  `eventShareUrl`, the config import path, and the Wix sync integration all
  differ. Verify per repo rather than assuming the port is faithful.
