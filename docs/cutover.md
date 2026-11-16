# Cutover: app-fundivers to FunDive

FunDivers moves from its own copy of the app to the FunDive platform, keeping
the production Supabase database, the Cloudflare workers and the domain. Users
should notice nothing: same URL, same session, same installed PWA, same push
subscriptions, same look.

This repository becomes the shop's **deployment repository**, set up exactly as
FunDive's [self-hosting walkthrough](https://fundive.github.io/fundive/self-hosting)
tells any shop to: what `npx fundive init` creates, with FunDivers' values in
it. The code, the migrations and the edge functions come from `fundive`,
pinned in `package.json`; every command below is a documented `npx fundive`
command ([deployment.md](https://fundive.github.io/fundive/deployment)).

## What stays the same

| Piece | Before | After |
| --- | --- | --- |
| Supabase project, data, auth users, storage | prod | the same project, untouched |
| SPA worker | `app-fundiverstw` on app.fundiverstw.com | the same worker, redeployed |
| Push worker | `fundivers-push`, crons, VAPID keys | the same worker; secrets are not touched |
| Push notifications in the app | off: the live bundle carries no VAPID key | still off: `.env.local` leaves `VITE_VAPID_PUBLIC_KEY` empty |
| Edge functions | the same 19 functions | the same names, redeployed |
| Service worker, cache keys, localStorage keys | | byte-identical in both codebases, so nobody is logged out or loses offline data |

## What changes in the database

Three things, all rehearsed on a copy of production's registry and grants:

1. **The migration registry** (`supabase_migrations.schema_migrations`). It
   lists app-fundivers' file versions; it must list fundive's. Adoption marks
   the 27 app-only versions `reverted` and 17 fundive versions `applied`, all
   without running anything. Those 17 are the same changes production already
   has, renumbered when they were ported. Objects and data are untouched.
2. **Two fundive migrations then run as no-ops:**
   `20261116110000_course_continuation` (production has had it since
   20260814000000) and `20261116120000_event_id_not_null` (production's columns
   are already NOT NULL). They are written with `if not exists` guards for
   exactly this.
3. **One fundive migration does real work: `20261116130000_lock_down_adopted_grants`.**
   Production never got the locked default privileges app-fundivers' baseline
   declares, so anon can EXECUTE eight privileged functions today, among them
   `purge_stale_pii` (no authorization check: it scrubs every idle diver's ID
   number, medical notes and emergency contact) and `normalize_profile_values`,
   and anon holds INSERT/UPDATE/DELETE on every table (RLS still guards the
   rows). This migration revokes all of that and sets the default privileges a
   fresh install has. Until the cutover, the hole stays open; to close it
   sooner, run that one file against production in the SQL editor. It is
   idempotent, so the cutover's `npx fundive db push` then runs it again
   harmlessly.

Rehearsal result: after adopt + push, the adopted database matched a fresh
fundive install object for object (columns, constraints, indexes, policies,
triggers, functions), and on grants: the same anon-callable SECURITY DEFINER
functions, no anon table writes, the same default privileges. The only
difference is the comment text inside one function body.

Known out-of-band drift on production, harmless and left alone:
`shop_profile.currency_label` (an unused column) and a public storage bucket
`Featured Pictures` holding one object.

## Before the cutover (any day ahead)

Done already: `package.json` pins fundive at the `v0.2.1` release tag; the old
code is tagged
`app-fundivers-final` for rollback; and the old `.env.local` and
`.env.production` were merged into the one `.env.local` the docs describe
(originals kept in `ignore/env-before-single-file-2026-11-16/`). The merge
takes each `VITE_*` value from where the old production build took it, and a
build from it bakes in the same Supabase URL, anon key, Turnstile site key and
push-worker URL as the live bundle.

1. **Install:** `npm install`.
2. **Build and look:** `npx fundive build && npx fundive preview`, sign in,
   click through the dashboard, calendar, a registration, an admin event and
   logistics.
3. **(Optional) GitHub buttons:** to deploy from the Actions tab instead of this
   machine, add the repository secrets listed in
   [deployment.md § GitHub Actions](https://fundive.github.io/fundive/deployment#github-actions).

Optional but cheap: rehearse steps 2 to 4 of the cutover against a restored
backup (`npx fundive db backup`, restore into a scratch Postgres, set
`SUPABASE_DB_URL` to it, run `npx fundive db adopt … --apply` and
`npx fundive db push`).

## The cutover (one sitting, about 15 minutes)

Run from this repository, on `main`.

1. `npx fundive db backup`: a rollback point for the registry.
2. `npx fundive db adopt --baseline 20260708090000 --applied-through 20261029120000`:
   a dry run (checked against production on 2026-11-16). Expect:
   - remote-only, to be marked reverted: 27 versions, from `20260707230000`
     to `20261029100000`
   - local-only, to be marked applied: `20260708090000` plus 16 more, ending at
     `20260925100000`
   - left for `db push`: `20261116110000 20261116120000 20261116130000`

   Anything else means production moved since this was written. Stop and
   diff before going on.
3. The same command with `--apply`.
4. `npx fundive db push`: applies the three migrations above. Then check the
   grants took (read-only), expecting `false`:

   ```sql
   select has_function_privilege('anon', 'public.purge_stale_pii(integer)', 'execute');
   ```
5. `npx fundive functions deploy`: sets the `FUNDIVE_CONFIG` secret from
   `fundive.config.ts`, then deploys every function. Always deploy functions
   this way; without the secret they fall back to the platform's placeholder
   shop name and currency.
6. `npx fundive deploy push`
7. `npx fundive build && npx fundive deploy`. Open browsers get the usual
   "update available" banner, the same as for any deploy.

Steps 5 to 7 are also the **Deploy** workflow (target `all`) once the
repository secrets are set; steps 3 and 4 are not in a workflow, and should be
run by hand, watching the output.

## Smoke test (5 minutes)

- Signed-in diver: the dashboard shows featured trips with their photos, and the
  calendar renders. Open a registration form, then Payments.
- Admin: the event detail roster loads with balances, and so do logistics and
  the accounting revenue tab.
- Share an event: the link is `https://www.fundiverstw.com/events/<id>`.
- Trigger one email: request a terms-consent link to yourself. It must be
  signed "FunDivers TW", not "Your Dive Shop".
- `select max(version) from supabase_migrations.schema_migrations` is
  `20261116130000`.

## Rollback

The database stays compatible with the old code: adoption only rewrote the
registry, the two no-op migrations changed nothing, and the grant lockdown only
removes access the old app never used. To go back, check out the
`app-fundivers-final` tag and run its `make deploy-app deploy-push
deploy-functions` (that checkout needs the original env files from
`ignore/env-before-single-file-2026-11-16/`). Leave the registry as fundive's;
nothing reads it at runtime.

## After the cutover

- **Event photos** live in `public/imgs/media/`, trimmed to the ones upcoming
  events use. Photos appear only on the dashboard's Featured Trips cards, which
  list upcoming featured events, so an older event whose file is gone shows
  nothing anywhere (the admin form shows the path as text). A new photo goes in
  `public/imgs/media/` and ships with the next app deploy.
- **Push notifications** are off in production today, and stay off. Turning
  them on is its own decision: set `VITE_VAPID_PUBLIC_KEY` in `.env.local` to
  the push worker's own public key (the one in
  `ignore/env-before-single-file-2026-11-16/.env.push`; the old `.env.local`
  held a different key that would not have worked), then build and deploy.
- **Upgrading** follows
  [deployment.md § Upgrading](https://fundive.github.io/fundive/deployment#upgrading):
  move the pin, `npm install`, `npx fundive db push`, deploy.
