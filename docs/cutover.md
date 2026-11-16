# Cutover: app-fundivers to FunDive

FunDivers moves from its own copy of the app to the FunDive platform, keeping
the production Supabase database, the Cloudflare workers and the domain. Users
should notice nothing: same URL, same session, same installed PWA, same push
subscriptions, same look.

This repository becomes the shop's **deployment**: config, branding, worker
names and shop documents. The code, the migrations and the edge functions come
from `fundive`, pinned in `package.json`.

## What stays the same

| Piece | Before | After |
| --- | --- | --- |
| Supabase project, data, auth users, storage | prod | the same project, untouched |
| SPA worker | `app-fundiverstw` on app.fundiverstw.com | the same worker, redeployed |
| Push worker | `fundivers-push`, crons, VAPID keys | the same worker; secrets are not touched |
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
   idempotent, so the cutover's `make push` then runs it again harmlessly.

Rehearsal result: after adopt + push, the adopted database matched a fresh
fundive install object for object (columns, constraints, indexes, policies,
triggers, functions), and on grants: the same anon-callable SECURITY DEFINER
functions, no anon table writes, the same default privileges. The only
difference is the comment text inside one function body.

Known out-of-band drift on production, harmless and left alone:
`shop_profile.currency_label` (an unused column) and a public storage bucket
`Featured Pictures` holding one object.

## Before the cutover (any day ahead)

Done already: `package.json` pins fundive at commit `ff991971` (no release tag
yet; switch to a tag once one is cut), and the old code is tagged
`app-fundivers-final` for rollback.

1. **Install:** `make install` in this checkout. The old app's `node_modules`
   can go first (`rm -rf node_modules`).
2. **Copy the env files** from the old checkout: `.env.local` and
   `.env.production` work unchanged (see `.env.example`).
3. **Build and look:** `make build && make preview`, sign in, click through
   the dashboard, calendar, a registration, an admin event and logistics.

Optional but cheap: rehearse steps 2 to 4 of the cutover against a restored backup
(`make backup-prod`, restore into a scratch Postgres, set `SUPABASE_DB_URL` to
it, run `npx fundive db adopt … --apply` and `npx fundive db push`).

## The cutover (one sitting, about 15 minutes)

Run from this repository, on the merged `main`.

1. `make backup-prod`: a rollback point for the registry.
2. `make adopt`: a dry run. Expect:
   - remote-only, to be marked reverted: 27 versions, from `20260707230000`
     to `20261029100000`
   - local-only, to be marked applied: `20260708090000` plus 16 more, ending at
     `20260925100000`
   - left for `db push`: `20261116110000 20261116120000 20261116130000`

   Anything else means production moved since this was written. Stop and
   diff before going on.
3. `npx fundive db adopt --baseline 20260708090000 --applied-through 20261029120000 --apply`
4. `make push`: applies the three migrations above. Then check the grants
   took (read-only), expecting `false`:

   ```sql
   select has_function_privilege('anon', 'public.purge_stale_pii(integer)', 'execute');
   ```
5. `make deploy-functions`: sets the `FUNDIVE_CONFIG` secret from
   `fundive.config.ts`, then deploys every function. Always deploy functions
   this way. Without the secret they fall back to the platform's placeholder
   shop name and currency.
6. `make deploy-push`
7. `make deploy-app`. Open browsers get the usual "update available" banner,
   the same as for any deploy.

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
registry, and the two migrations changed nothing. To go back, check out the
`app-fundivers-final` tag and run its `make deploy-app deploy-push
deploy-functions`. Leave the registry as fundive's; nothing reads it at
runtime.

## After the cutover

- **Event photos into Supabase Storage** (proposed): 139 events point at
  `/imgs/media/*.webp`, which this repo ships in `public/`. Uploading them to
  a public bucket and rewriting `events.featured_image` would make photos
  admin-managed and drop them from this repo. That is a production data change
  of its own, so it gets its own step and its own check.
- **Upgrading** is editing the tag in `package.json`, `npm install`, then
  `make push` and `make deploy`.
