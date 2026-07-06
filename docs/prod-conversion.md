# Production schema conversion — app-fundivers → fundive

Goal: bring app-fundivers' **live production** schema to fundive's clean model —
unified `events` table (no `EO_` prefix, no two-table dive/course split), uuid
FKs, modern junctions — **without breaking any of the three consumers** that read
the same prod database.

## The three consumers (all read prod)

| Consumer | How it reads | Writes? |
| --- | --- | --- |
| **app-fundivers** (the React app) | Supabase JS client, `.from('EO_dives')` etc. — ~271 `eo_dive_id`/`eo_course_id` + 77 `EO_dives`/`EO_courses` refs across ~57 files | **yes** (admins create/edit) |
| **site-fundivers** (React marketing site) | Supabase JS client (`src/lib/events.ts`, `supabase.ts`) — `EO_dives`/`EO_courses`/`EO_prices` | read-only |
| **Wix** (`ignore/wix`, Velo) | PostgREST REST (`/rest/v1/EO_dives…`) + a **sync pipeline** (Supabase DB Webhooks → Wix CMS collections) | read-only (mirrors into Wix CMS) |

Only app-fundivers writes. site-fundivers and Wix are read-only — that's what
makes compatibility **views** viable.

## Guiding principle: expand / contract behind read-only views

Never a single 3-way lockstep deploy. Each risky rename/unify migration:
1. builds the new shape **alongside** the old,
2. re-creates the **old names as read-only views** over the new tables,
3. so read-only consumers keep working **unchanged**,
4. then consumers migrate off the views **one at a time**,
5. and the views drop **last**.

**Every prod migration is rehearsed against a restored prod snapshot first, with
a PITR backup checkpoint immediately before the real run.**

---

## Stages

### Stage 0 — Drop dead columns  ✅ done (dev), pending prod push
`20260706020000_drop_bubble_cruft_columns.sql`. 41 Bubble cruft columns, 0
consumers read them (Wix already `RESERVED`-strips the metadata). Safe to push to
prod after a backup checkpoint; no view needed.

### Stage 1 — Reference tables → uuid PKs
fundive's `events` FKs are uuid (`price`, `cancel_policy`, `prereq_cert_id`,
`divetravel_id`); app-fundivers' are Bubble text `_id`. Do this **first** so
Stage 2 can point at uuid.
- Migration: add `uuid` surrogate keys to `EO_prices`, `EO_rooms`, `Other_Addons`,
  `DiveTravel`, `cancellation_policies`, `cert_levels`; carry a `legacy_id (text)`
  = old `_id` for backfill mapping; repoint the child text refs to the new uuids.
- Consumers: unaffected if the old text `_id` stays selectable (keep it as a
  column through the transition; drop in the contract phase).
- Risk: medium — mechanical but touches many FKs. Rehearse.

### Stage 2 — Unify `EO_dives` + `EO_courses` → `events`  (the big one)
Mirror fundive's `20260703000000_baseline_schema.sql` `events` shape.
- **Expand migration (transactional):**
  - create `events` (`kind`), `event_addons`/`event_rooms`/`event_destinations`;
  - backfill `events` from `EO_dives` (kind='dive') + `EO_courses` (kind='course'),
    preserving the source `_id` in a `legacy_id` and minting uuid `id`; map columns
    (`EO_dives.time`→`start_time`, `DiveTravel_reference`→`divetravel_id`, text
    refs→uuid via Stage-1 maps); backfill the junctions from `eo_dive_addons`/
    `eo_course_addons`/`eo_dive_rooms`/`eo_dive_destinations`;
  - add `event_id uuid` to `bookings`, `duties`, `admin_notes`, `event_vehicles`,
    `waiver_signatures`, `event_waivers`; backfill `= coalesce(eo_dive_id,
    eo_course_id)` mapped to the new `events.id`; add FKs; keep the old
    `eo_*_id` columns for now;
  - **re-create `EO_dives` / `EO_courses` as read-only VIEWS** over `events`
    (with the legacy column names/shape site-fundivers + Wix expect, incl.
    deriving `start_date/end_date` for courses from `course_days`).
- **app-fundivers code cascade** (deploy WITH this migration): `.from('EO_dives')`
  →`.from('events')` + `kind`; `eo_dive_id`/`eo_course_id`→`event_id`; types;
  edge functions; push worker. (This is fundive's already-done diff — port it in
  reverse-direction as the reference.)
- Consumers after this migration:
  - **site-fundivers + Wix keep reading the `EO_dives`/`EO_courses` views** →
    still work, untouched.
  - **app-fundivers** now reads/writes `events` directly.
- Risk: **high** (largest blast radius). Transactional; rehearse on a prod clone;
  PITR checkpoint; smoke-test all three consumers against the clone.

### Stage 3 — Migrate the read-only consumers off the views
- **site-fundivers:** update `src/lib/events.ts` + `supabase.ts` to `events`+`kind`;
  deploy.
- **Wix:** update `backend/supabase.jsw` (query `events?kind=eq.dive/course`),
  `syncFromSupabase.jsw` (`SYNC_TABLES`, `MULTI_REF_FIELDS`→junctions,
  `DATE_FIELDS`), the dynamic pages; **re-point the Supabase DB Webhooks** at
  `events`; rename/rebind the **Wix CMS collections**; re-publish.
  (Note: webhooks fire on the base table, not the views — this is the Wix step
  where the sync source moves to `events`.)

### Stage 4 — Contract: drop the compatibility scaffolding
Once no consumer reads them: drop the `EO_dives`/`EO_courses` views, the old
`eo_dive_id`/`eo_course_id` child columns, the old junction tables, and (Stage 1)
the legacy text `_id` columns. Optionally rename the reference tables to fundive's
names (`EO_prices`→`prices`, `EO_rooms`→`rooms`, `Other_Addons`→`addons`,
`DiveTravel`→`dive_travel`) — again behind views if any consumer still lags.

---

## Rollback & safety (every stage)
- Rehearse against a **restored prod snapshot**; smoke-test all three consumers.
- **PITR backup checkpoint** immediately before the prod run.
- Migrations are **transactional** where possible; expand keeps old + new side by
  side so a bad app deploy can be rolled back without a DB rollback.
- No stage requires all three consumers to deploy in the same second — the views
  decouple them.

## Sequencing summary
0 drop-cruft (done) → 1 ref-uuid → 2 events-unify + views + app-fundivers deploy →
3 migrate site-fundivers, then Wix, off the views → 4 contract.
