# Data model

## Table map

```
auth.users (Supabase)
    │ 1-1 via handle_new_user() trigger
    ↓
public.profiles ─────────── one row per diver / staff / admin
    │
    │ 1-many             ┌── events          (ONE table: dives, courses,
    │                    │                    adventures — see `kind`)
    ↓                    │── prices          (linked by events.price)
public.bookings ──── event_id → events(id)
    │                    │── rooms           (via the event_rooms junction)
    │ 1-many             │── addons          (via the event_addons junction)
    ↓                    │── travel_destinations
public.payments          │                   (via the event_destinations junction)
    (staff ledger)       │── cancellation_policies
    │                    │── trip_templates  (reusable trip copy)
    │ 1-many             └── cert_levels
    ↓
public.credits ────────── money the shop owes a diver (see payments.md)

public.admin_notes ────── event_id XOR booking_id  (operational memos)
public.diver_notes ────── per-diver standing facts (allergies, accommodations)
public.admin_audit_log ── append-only changelog of admin mutations
public.duties ─────────── staff/admin assignments per event
public.push_subscriptions / push_notifications_sent  (cron infra)
```

Every child of an event — `bookings`, `duties`, `event_waivers`,
`event_vehicles`, `event_ride_groups`, `notifications` — points at it with a
plain `event_id`. There is no `eo_dive_id` / `eo_course_id` XOR anywhere in
the schema — the only XOR left is `admin_notes`, which pins a memo to
either an event or a booking.

## App-owned tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`), `role` | `role in ('diver','staff','admin')`. Row auto-created by `handle_new_user()` on signup. Personal + cert + sizing + emergency contact + gear-owned + gear sizes + `agreed_to_terms_at`. |
| `bookings` | `id`, `user_id`, `event_id`, `status`, `details` (jsonb), `refund_requested_at`, `group_id`, `payer_id`, `continues_booking_id`, `attend_days` | `event_id` → `events(id)`. `details` shape enforced app-side by `BookingDetails` in `src/types/database.ts`. One live booking per (user, event). After insert, most columns are immutable for divers — the `bookings_diver_immutable` trigger in the baseline. `continues_booking_id` / `attend_days` carry a course finished across two scheduled courses (see [events-and-bookings.md](./events-and-bookings.md#one-course-several-scheduled-courses)). |
| `payments` | `id`, `user_id`, `booking_id`, `amount`, `status`, `method`, `recorded_by` | Ledger entries, staff-inserted. `status in ('pending','paid','refunded')`. |
| `diver_notes` | `id`, `profile_id`, `created_by`, `content`, `edited_*` | Per-diver standing facts (allergies, accommodations) — staff/admin can read+insert under their own attribution; admin or own-author can update/delete. `profile_id`/`created_by`/`created_at` frozen by trigger so RLS can't be sidestepped. |
| `admin_notes` | `id`, `event_id` \| `booking_id`, `created_by`, `tag`, `content`, `resolved_*` | The operational memo table — a note pinned to one event **or** one booking (CHECK `admin_notes_target_present`: exactly one, the last XOR in the schema). Tags: `urgent` / `payment` / `gear` / `logistics` / `cert` / `medical` / `note` / `general`. Resolution flags come as a trio (all null or all set, DB-enforced). Read/insert open to staff+admin (insert requires `created_by = auth.uid()`); update/delete admin-only. See [admin.md](./admin.md#event-memos-admin_notes). |
| `admin_audit_log` | `id`, `actor_id`, `action`, `target_table`, `target_id`, `before`, `after` | Append-only audit trail for admin mutations. Insert via DB triggers; reads admin-only. |
| `duties` | `id`, `assignee_id`, `role`, `start_date`, `end_date`, `event_id` | Staff-or-admin shift assignments; `role in ('instructor','guide','support')`. Trigger enforces `assignee_id` references a profile with role in (admin, staff). The roster is also what [staff revenue](./admin.md#revenue-by-staff) is attributed from. |
| `vehicles` | `id`, `name`, `passenger_seats`, `active` | Transport-fleet catalog (`passenger_seats` = total physical seats; no seat is reserved for a driver). Staff+admin read, admin write. Stateless capacity input to the logistics ride planner. |
| `event_vehicles` | `id`, `vehicle_id`, `event_id`, `notes` | Which car is allocated to which event. A car may serve any number of events, at most once each (unique `(event_id, vehicle_id)`). Staff+admin read, admin write. Assigned on the logistics day view, the event's Transportation tab and the create/edit event forms. |
| `event_ride_groups` | `(ride_day, event_id)` PK, `group_id` | Which of a day's events **travel together** — the events sharing a `group_id` form one "run" and pool their cars, divers and staff; an event with no row rides alone. `group_id` has no parent table: the group is the set of rows. Staff read, admin write, set by the Shared transport picker on `/admin/logistics`. See [admin.md](./admin.md#transport-runs-seats-riders). |
| `waivers` | `id`, `code`, `version`, `title`, `body` \| `pdf_path`, `language`, `active` | The shop's own waiver catalog — text forms or uploaded PDFs in the `waiver-pdfs` bucket (exactly one of `body` / `pdf_path` set). `code` + `version` are what `waiver_signatures` and `event_waivers` reference. Admin-authored at `/admin/waivers`; the repo ships no waiver content. |
| `waiver_signatures` | `id`, `diver_id`, `waiver_code`, `waiver_version`, `signed_name`, `signed_at`, `event_id`, content snapshot + SHA-256 | Append-only e-signature records; each snapshots the exact waiver text it signed so a later edit can't rewrite history. Annual waivers leave `event_id` null; per-event waivers set it. Writes go through the `sign_waiver()` RPC (server-stamps `signed_at` / `diver_id`), or `admin_record_paper_waiver()` for one signed in person. Diver reads own; staff+admin read all. |
| `event_waivers` | `id`, `event_id`, `waiver_code`, `mode` | Per-event override of a waiver's default rule: `mode` `require` adds it, `exempt` drops it for one event. `event_id` → `events`; one override per `(event_id, waiver_code)`. Read by any authenticated user (the registration form needs it); admin write. Edited on the admin Edit-event form. |
| `scheduled_trips` | `id`, `title`, `destination`, `status`, `price`, `addon_ids`, `room_type_ids` | The shop's own curated, dated trips shown on the diver Scheduled Trips tab. Admin-managed base table (admin-only RLS); divers read published rows via `list_scheduled_trips()`. Carries `addon_ids`/`room_type_ids` (into the shop `addons`/`rooms` catalog) so divers register self-contained for a cost estimate — same flow as `packages`, minus tiers/partner. Distinct from `packages` (travel abroad) and the `events.is_trip` Wix flag. See [packages.md](./packages.md). |
| `scheduled_trip_registrations` | `id`, `scheduled_trip_id`, `diver_id`, `estimated_cost`, `details`, `status` | One row per diver-registration for a scheduled trip; frozen estimate snapshot in `details`. No kickback (the shop's own trip). Admin-only base table; divers create via the `register-scheduled-trip` edge fn and read their own via `list_my_scheduled_trip_registrations()`. Partial unique index keeps one live registration per diver per trip. |
| `cert_levels` | `id`, `code`, `name`, `name_zh`, `rank`, `organization`, `padi_equivalent_id` | Reference data for the certification picker. Events point at one via `events.prereq_cert_id`, and the admin form offers **PADI levels only** — prereqs are encoded as PADI ranks, with `padi_equivalent_id` mapping an agency-specific level onto its PADI peer for the cross-agency comparison (mapping is populated; the comparison isn't wired up yet). |
| `cancellation_policies` | `id`, `title`, `cancellation_policy`, `language`, `active` | Reference data linked from `events.cancel_policy`; the text a diver has to acknowledge at registration. Admin-managed at `/admin/cancellation-policies`. |
| `trip_templates` | `id`, `admin_title`, `included`, `not_included`, `transportation`, `itinerary`, `prerequisites` | Reusable trip copy an event links to via `events.trip_template_id`; surfaces in the event-detail modal and the booking form. |
| `travel_destinations` | `id`, `admin_title`, `country`, `divetype`, `international`, … | Dive-location catalog (Green Island, Palau…). Events are tagged with these via the `event_destinations` junction (EventForm picker); `divetype` drives calendar local-vs-trip colouring ('Shore Diving' = local/green). Admin-managed at `/admin/destinations`. |
| `event_rooms` / `event_addons` / `event_destinations` | junctions | `(event_id, <ref>_id)` links from an event to the `rooms` / `addons` / `travel_destinations` catalogs. They are the **source of truth** — reconciled only through the `set_event_relations` RPC (and `create_events_with_relations` at creation), so a partial write can't leave an event half-linked. |
| `dive_sites` | `id`, `name`, `kind`, `region`, `notes`, `active` | The shop's places, and the reason "Bat Cave" is one thing everywhere: `events.site_id` says where an event goes and `almanac_records.site_id` says what it was like there. `kind` is the events vocabulary narrowed to the kinds that answer `recordsSiteConditions` (dive / adventure — a course runs from the shop), and it's what the almanac's dive/adventure toggle filters on. Unique on `(kind, lower(name))`, so casing can't mint a duplicate. Any authenticated user reads it; admin writes. Curated at `/admin/dive-sites`; `active = false` retires a site without touching its history. |
| `almanac_records` | `id`, `diver_id`, `site_id`, `obs_date`, condition columns, `status`, `approved_by/_at`, `staff_notes` | Crowdsourced conditions at a site on a day — temperatures, visibility, current, wave, weather, wildlife, coral, plus terrain readings for the kinds that answer `hasTerrainConditions`. One record per `(site_id, obs_date, diver_id)`; the page reads them back **by calendar date**, so every site observed on a day sits in one bucket. `authenticated` holds **SELECT only**: a diver files through `submit_almanac_record()` (always lands on `pending`, revisable only while pending), staff rule through `moderate_almanac_record()`, and the crowd reads approved rows through `almanac_records_in_range()`. Divers see their own rows plus every approved one; staff see the queue via `almanac_pending_records()`. The FK to `dive_sites` is `ON DELETE RESTRICT` — a site that carries observations is retired, not deleted. |
| `push_subscriptions` | `endpoint` (unique), `user_id`, `p256dh`, `auth` | One row per device. Diver owns their rows (RLS). |
| `push_notifications_sent` | `(user_id, event_id, kind)` composite PK | Idempotency ledger for the push cron. Service-role-only. |

## The `events` table

Dives, courses and adventures are **one table**, `public.events`,
discriminated by `kind`. There is no dive/course table pair and no
`eo_dive_id` / `eo_course_id` XOR — the Bubble-era `EO_*` tables were
collapsed into `events` and the reference tables renamed (`EO_prices` →
`prices`, `EO_rooms` → `rooms`, `Other_Addons` → `addons`, `DiveTravel` →
`trip_templates`), each with a uuid `id` and the import cruft dropped.

| `events` columns | Notes |
| --- | --- |
| `id` (uuid), `kind`, `admin_title`, `display_title`, `calendar_title` | shared identity. `kind in ('dive','course','adventure')` — the DB's `events_kind_check` |
| `price` → `prices`, `cancel_policy` → `cancellation_policies`, `prereq_cert_id` → `cert_levels`, `trip_template_id` → `trip_templates` | catalog links |
| `capacity`, `fully_booked`, `full_payment_deadline`, `cancel_date`, `cancelled_at`, `dive_days`, `prereqs`, `req_dives`, `featured`, `featured_image`, `is_private`, `series_id` | shared |
| **date-envelope kinds:** `start_date`, `end_date`, `start_time` | dives and adventures carry a scalar start/end envelope |
| **course kinds:** `course_days` (`date[]`, max 4 — see [events-and-bookings.md](./events-and-bookings.md#course_days)), `course_name`, `included`, `schedule` | discrete session days, no envelope |
| **dive-only:** `nitrox_required`, `is_boat_dive` | the genuinely diving-specific flags |
| **dive / adventure:** `is_trip`, `gear_rental`, `notes` | |

`series_id` groups the batch of occurrences a recurrence rule generated
(`event_series`); each occurrence is otherwise fully independent.

### Ask what a kind *does*

**Never branch on `kind === 'dive'`.** The vocabulary and the questions
live in `src/lib/event-kinds.ts` — `usesDateEnvelope`, `usesCourseDays`,
`allowsTransport`, `isInstructorLed`, `hasDiveFlags`, plus the
`DATE_ENVELOPE_KINDS` / `COURSE_DAY_KINDS` value lists that queries filter
on. That file is deliberately import-free so the Deno edge functions and
the push worker share it, and `src/types/database.ts` carries a
compile-time guard pinning it to the DB's `events_kind_check`.

A `kind === 'dive' ? … : …` ternary silently means "course" in its else
branch, so a new kind inherits course behaviour with no compile error and
often no visible symptom — an event that is simply never fetched.

Adding a kind touches three separate DB vocabularies:
`events_kind_check`, `push_notifications_sent_event_type_check` (no FK to
`events`, so a miss only shows up as rejected push rows) and
`waivers.applies_to`.

All dates are interpreted as **shop-local** (`locale.timezone`, no DST).
Normalization into the uniform `AppEvent` shape lives in
`src/lib/events.ts` — `fetchEventsInRange`, `fetchEventsForBookings`,
`fetchUpcomingEventDays`. Use `AppEvent` everywhere in the UI rather than
reading raw `events` rows.

## Other app-owned tables

Documented in their own docs rather than here:

| Table | Covered by |
| --- | --- |
| `credits` | [payments.md](./payments.md) |
| `packages`, `package_tiers`, `package_registrations`, `package_referrals` | [packages.md](./packages.md) |
| `trusted_partners` | [packages.md](./packages.md) (it hosts packages *and* backs the diver directory) |
| `notifications`, `push_subscriptions`, `push_notifications_sent` | [push-notifications.md](./push-notifications.md) |

Not yet written up anywhere: `booking_amendments` (admin adjustments to
what a booking owes — append-only, block-update/delete triggers, so the
client never mutates one), `terms` / `terms_consent_tokens` (the
shop-authored Terms of Use singleton and its one-time acceptance links),
`dive_logs` / `dive_log_export_requests` (the diver logbook and its PDF
export), `waitlist_offers` (the cron's timed offer of a freed spot),
`staff_availability` (busy windows the duty picker reads), `gear_models` /
`gear_model_sizes` (the shop's sizing charts), `event_series` (recurrence
batches), and the abuse ledgers `signup_attempts` / `user_action_attempts`
/ `orphan_auth_users`.

## Row-Level Security

RLS is **on** for every `public.*` table. The important patterns:

- **Two SECURITY DEFINER helpers do the role checks** so policies
  don't recurse into `profiles` RLS:
  - `public.is_admin()` — caller's profile has `role = 'admin'`
  - `public.is_staff_or_admin()` — caller's profile has `role in
    ('admin','staff')`
- **Diver-owned rows** (`bookings`, `payments`, `push_subscriptions`):
  users can read/insert/update/delete rows where `auth.uid() = user_id`.
- **Staff+admin read** on `profiles`, `bookings`, `payments`,
  `admin_notes`, `diver_notes` — broadened from admin-only by the
  `staff_role` migration. Writes on those tables stay admin-only
  except `admin_notes` / `diver_notes` (staff can insert their own).
- **`bookings` is largely immutable** for divers post-insert: the
  trigger `bookings_diver_immutable` (in the squashed baseline) blocks
  diver writes to most columns. Diver can flip `status` to
  `'cancelled'` and stamp `refund_requested_at`; admins can mutate
  anything via the `is_admin()` policy.
- **Service-role bypasses RLS.** The push cron + the
  `create-registration` edge function both use the service-role key
  for this reason — they need to write under multiple users' identities.
- **Tables with no user-facing policies** (`push_notifications_sent`,
  `admin_audit_log`) are service-role-only or admin-only — RLS is on
  but no `for select` to authenticated, so anon/diver reads return
  zero rows.

## Migrations

Forward-only. **Never edit a migration that has been `make push`'d.**
Applied migrations are locked — the registry in `supabase_migrations`
will refuse the push if a checksum changed.

To evolve a table, write a new migration that does `alter table …` or
adds a column / constraint / policy. File naming is
`YYYYMMDDHHMMSS_<slug>.sql`.

### Migration history

The migrations folder is the source of truth — `ls
supabase/migrations/` for the full list. Maintaining a curated table
here drifted out of date faster than any other doc; we no longer try.

The lineage starts with a **single squashed baseline**,
`20260707230000_squashed_baseline.sql`, which captures the whole schema as
of the unified-`events` rebuild: every table above, its RLS policies and
triggers, and the SECURITY DEFINER RPCs (`event_ride_seats`, `sign_waiver`,
`apply_credit_to_booking`, `set_event_relations`, …). A fresh database is
one baseline apply, not a replay of the per-feature history the app grew
during the Bubble-import era. `make repair-history` exists to reconcile a
database whose registry predates the squash.

Everything after it is forward-only. Notable ones:

- `20260709120000_shop_authored_waivers.sql` — moves the waiver catalog out
  of code into the `waivers` table + `waiver-pdfs` bucket, with admin CRUD.
  `20260711200000` adds the content + SHA-256 snapshot on each signature;
  `20260731000000` adds `admin_record_paper_waiver()` for one signed in person.
- `20260711100000_shop_authored_terms.sql` — the `terms` singleton, admin-edited.
  `20260803000000_terms_consent_by_email.sql` adds one-time consent links for
  admin-minted walk-ins who never had a session to accept in.
- `20260720000000_add_adventure_event_kind.sql` — the third kind, and the
  worked example of the three vocabularies it had to touch.
- `20260724000000_ride_groups_shared_transport.sql` — `event_ride_groups`
  (which events travel together on a day) and a rewritten `event_ride_seats()`
  measured across the whole run, returning `seats / staff / capacity / claimed`.
  Drops the old per-vehicle driver-seat reservation, which contradicted the
  admin planner.
- `20260724010000_server_side_ride_waitlist.sql` — `details.ride_waitlisted`
  is recomputed by a BEFORE trigger from `event_ride_tally()` instead of
  trusted from the client, so a full run can't be hidden from the admins.
- `20260804000000_event_series.sql` — recurrence: an `event_series` rule plus
  the batch of `events` it generated (`events.series_id`). The rule stores no
  dates of its own — it is re-anchored on the last occurrence to extend the
  series, so the two can't disagree.
- `20260805000000_create_events_atomically.sql` — `create_events_with_relations()`,
  so an event and its room/add-on/destination junction rows land in one
  transaction instead of a create-then-link sequence that could half-fail.
- `20260811000000_restrict_private_events_to_participants.sql` — private
  events are readable only by staff and the divers booked on them.
- `20260814000000_course_continuation.sql` — `bookings.continues_booking_id`
  and `attend_days`, plus the `create_course_continuation()` RPC that owns the
  rules. See
  [events-and-bookings.md](./events-and-bookings.md#one-course-several-scheduled-courses).

## `BookingDetails` JSONB shape

Defined in `src/types/database.ts` — that file is the source of truth.
DB only enforces `jsonb_typeof(details) = 'object'`. Current shape:

```ts
interface BookingDetails {
  gear?: {
    rent: boolean
    included?: boolean              // event bundles gear (e.g. OW course)
    items?: string[]                // chosen gear items (à-la-carte is the
                                    //   only way gear is rented)
    assistance_note?: string        // diver picked "ask a human"; their note
                                    //   (when set, rent is false)
                                    // no sizes here: what fits a diver lives
                                    //   on their profile, which is what the
                                    //   pack list and the fit lookup read
  }
  room?: { option_id?: string | null; notes?: string | null }
  add_ons?: string[]                // addons.id list
  transportation?: boolean
  payment_method?: 'bank_transfer' | 'credit_card' | 'cash'
  pay_deposit_only?: boolean        // deposit-only-at-registration flag
  nitrox_course_addon?: boolean
  charges?: ChargeLine[]            // itemized snapshot — see below
  total?: number                    // final-charge snapshot
  deposit?: number                  // prices.deposit_amount snapshot
  cancellation_policy_acked_at?: string  // gate for submit when policy attached
}
```

**Design note:** `total`, `deposit`, and `charges` are snapshotted into
the booking so later catalog price changes don't retroactively alter what
the diver owes — the lesson from removing the full-gear-set package, which
had silently rewritten paid divers' amounts because every surface
*recomputed* the breakdown from current prices.
`cancellation_policy_acked_at` is preserved across edits — admin
edits to `notes`/`details` don't reset the diver's prior ack.

**`charges` (`ChargeLine[]`)** — the itemized breakdown behind `total`
(base, per-item gear, room, each add-on, transport, nitrox course, card
surcharge), each `{ kind, label, amount }`. Built once by `buildCharges()`
in `src/lib/booking-charges.ts` at registration and rendered from the
snapshot everywhere: the PDF/email, the diver's Bookings/Payments pages,
and the admin event + per-diver views (via the shared `<ChargeBreakdown>`
and `BookingPaymentsBlock`). Bookings created before this field existed
have no snapshot; `resolveCharges()` reconstructs their lines from the
stored selections using *current* catalog prices (so the figures can
drift) — it never mutates stored rows.
