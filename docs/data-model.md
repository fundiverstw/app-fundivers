# Data model

## Table map

```
auth.users (Supabase)
    │ 1-1 via handle_new_user() trigger
    ↓
public.profiles ─────────── one row per diver / staff / admin
    │
    │ 1-many             ┌── EO_dives        (Bubble-imported catalog)
    │                    │── EO_courses
    ↓                    │── EO_prices       (linked by EO_*.price)
public.bookings ──── eo_dive_id XOR eo_course_id (text FK)
    │                    │── EO_rooms        (room types — linked via
    │ 1-many             │                    eo_dive_rooms junction)
    ↓                    │── Other_Addons    (linked via
public.payments          │                    eo_dive_addons /
    (staff ledger)       │                    eo_course_addons junctions)
                         │── cancellation_policies
                         │── DiveTravel      (transport options)
                         └── cert_levels

public.event_memos ────── eo_dive_id XOR eo_course_id  (admin flags)
public.admin_notes ────── per-profile staff notes
public.admin_audit_log ── append-only changelog of admin mutations
public.duties ─────────── staff/admin assignments per event
public.dive_sites ─────── public catalog rendered on /map
public.push_subscriptions / push_notifications_sent  (cron infra)
```

## App-owned tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`), `role` | `role in ('diver','staff','admin')`. Row auto-created by `handle_new_user()` on signup. Personal + cert + sizing + emergency contact + gear-owned + gear sizes + `agreed_to_terms_at`. |
| `bookings` | `id`, `user_id`, `eo_dive_id` \| `eo_course_id`, `status`, `details` (jsonb), `refund_requested_at` | Exactly one of `eo_dive_id` / `eo_course_id` set (XOR CHECK). `details` shape enforced app-side by `BookingDetails` in `src/types/database.ts`. Unique per (user, event). After insert, most columns are immutable for divers — see migration `20260423130000_core_rls_and_booking_immutability.sql`. |
| `payments` | `id`, `user_id`, `booking_id`, `amount`, `status`, `method`, `recorded_by` | Ledger entries, staff-inserted. `status in ('pending','paid','refunded')`. |
| `event_memos` | `id`, `eo_dive_id` \| `eo_course_id`, `tag`, `content`, `resolved_*` | XOR FK to dive/course. Tags: `urgent` / `payment` / `gear` / `logistics` / `cert` / `medical` / `note`. Resolution flags come as a trio (all null or all set, DB-enforced). |
| `diver_notes` | `id`, `profile_id`, `created_by`, `content`, `edited_*` | Per-diver standing facts (allergies, accommodations) — staff/admin can read+insert under their own attribution; admin or own-author can update/delete. `profile_id`/`created_by`/`created_at` frozen by trigger so RLS can't be sidestepped. |
| `admin_notes` | `id`, `profile_id`, `created_by`, `content` | Free-text staff notes attached to a diver's profile. Read/insert open to staff+admin (insert requires `created_by = auth.uid()`); update/delete admin-only. |
| `admin_audit_log` | `id`, `actor_id`, `action`, `target_table`, `target_id`, `before`, `after` | Append-only audit trail for admin mutations. Insert via DB triggers; reads admin-only. |
| `duties` | `id`, `assignee_id`, `role`, `start_date`, `end_date`, `eo_dive_id` \| `eo_course_id` | Staff-or-admin shift assignments. Trigger enforces `assignee_id` references a profile with role in (admin, staff). |
| `vehicles` | `id`, `name`, `passenger_seats`, `active` | Transport-fleet catalog (`passenger_seats` excludes the driver). Staff+admin read, admin write. Stateless capacity input to the logistics ride planner. |
| `event_vehicles` | `id`, `vehicle_id`, `event_date`, `eo_dive_id` \| `eo_course_id` | Which car is allocated to which event on which date. XOR FK to dive/course; **unique `(vehicle_id, event_date)`** makes a car exclusive per day (the availability rule). One row per date for multi-day events. Staff+admin read, admin write. Assigned on the logistics day view. |
| `dive_sites` | `id`, `name`, `lat`, `lng`, `dive_type` | Public catalog rendered on `/map`; readable by all authenticated users. |
| `waiver_signatures` | `id`, `diver_id`, `waiver_code`, `waiver_version`, `signed_name`, `signed_at`, `eo_dive_id` \| `eo_course_id` | Append-only e-signature records. The waiver **catalog + global rules** live in code (`src/config/waivers.ts`), not the DB — these rows only record who signed what, when. Annual waivers leave both event keys null; per-event waivers reference exactly one (at-most-one CHECK). Writes go through the `sign_waiver()` RPC (diver reads own; staff+admin read all). |
| `event_waivers` | `id`, `eo_dive_id` \| `eo_course_id`, `waiver_code`, `mode` | Per-event override of a waiver's global rule: `mode` `require` adds it, `exempt` drops it for one event. XOR FK to dive/course; one override per `(event, waiver_code)`. Read by any authenticated user (the registration form needs it); admin write. Edited on the admin Edit-event form. |
| `cert_levels` | `id`, `agency`, `name`, `prereq_cert_id` | Reference data for the certification picker. Self-referential prerequisite chain. |
| `cancellation_policies` | `_id`, `title`, `cancelation_policy` | Bubble-imported reference data linked from EO event rows via `cancel_policy`. |
| `DiveTravel` | catalog | Transport options surface in the booking form. Bubble-imported, capitalised name preserved. |
| `eo_dive_rooms` / `eo_dive_addons` / `eo_course_addons` | junctions | Modern FK junctions replacing the legacy CSV/JSON-string columns on `EO_dives` / `EO_courses` (those columns still exist for back-compat). |
| `push_subscriptions` | `endpoint` (unique), `user_id`, `p256dh`, `auth` | One row per device. Diver owns their rows (RLS). |
| `push_notifications_sent` | `(user_id, event_id, kind)` composite PK | Idempotency ledger for the push cron. Service-role-only. |

## `EO_*` catalog tables (Bubble-imported)

These came from a Bubble.io database. **Treat them as read-mostly
reference data** — the diver app only reads them; admin surfaces can
edit specific columns.

| Table | Primary key | Date/time fields |
| --- | --- | --- |
| `EO_dives` | `_id` (text) | `start_date` / `end_date` / `time` are **text** (`'YYYY-MM-DD'`, `'HH:MM:SS.sss'`) |
| `EO_courses` | `_id` (text) | same shape, plus `course_days` (`date[]`, max 4 — the days the course runs on; see [events-and-bookings.md](./events-and-bookings.md#course_days)) |
| `EO_prices` | `_id` (text) | `starting_at` (price), `deposit_amount` |
| `EO_rooms` | `_id` (text) | `added_price`, `currency` |
| `Other_Addons` | `_id` (text) | `price`, `currency` |

**Quirks:**

- `_id` is text, not UUID. Migration `20260422170000_eo_id_defaults.sql`
  added a `gen_random_uuid()::text` default so new rows auto-generate;
  legacy rows keep their Bubble IDs.
- `EO_dives.room_types` is a **CSV text** of `EO_rooms._id` values.
- `EO_dives.other_addons` / `EO_courses.other_addons` is a **JSON
  string array** of `Other_Addons._id` values.
- All dates are interpreted as **Asia/Taipei local** (no DST).

Normalization into the uniform `AppEvent` shape lives in
`src/lib/events.ts`. Use that everywhere in the UI rather than reading
raw `EO_*` rows.

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
  `event_memos`, `admin_notes` — broadened from admin-only by the
  `staff_role` migration. Writes on those tables stay admin-only
  except `admin_notes` (staff can insert their own).
- **`bookings` is largely immutable** for divers post-insert: the
  trigger `bookings_diver_immutable` (in
  `20260423130000_core_rls_and_booking_immutability.sql`) blocks
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

Notable milestones to skim if you're new to the schema:

- `20260416111642_initial_schema.sql` — baseline (profiles, bookings,
  payments, RLS, `handle_new_user` trigger).
- `20260421150000_swap_activities_for_eo_events.sql` — replaced the
  initial `activities` table with the XOR FKs to `EO_dives` /
  `EO_courses` we use today.
- `20260422180000_push_notifications.sql` — push subscriptions +
  idempotency ledger.
- `20260423000000_duties.sql` — staff/admin shift assignments.
- `20260624000000_vehicles.sql` — transport-fleet catalog.
- `20260627000000_event_vehicles.sql` — per-event car allocation
  (exclusive per date via unique `(vehicle_id, event_date)`).
- `20260628000000_event_ride_seats.sql` — `event_ride_seats()` SECURITY
  DEFINER RPC: an event's ride-seat capacity (distinct assigned cars) and
  claimed count (transportation=true bookings), readable by any diver so the
  registration form can gate the "I need a ride" option.
- `20260629000000_waivers.sql` — waiver tracking: `waiver_signatures`
  (append-only e-signatures), `event_waivers` (per-event require/exempt
  overrides), and the `sign_waiver()` SECURITY DEFINER RPC (server-stamps
  `signed_at`/`diver_id` so signatures can't be backdated, same pattern as
  `accept_current_terms`). The waiver catalog + global applicability rules live
  in `src/config/waivers.ts`, not the DB, so each shop customizes them in code.
- `20260423130000_core_rls_and_booking_immutability.sql` — the
  bookings-immutable-once-inserted trigger; the policy that makes
  divers' bookings tamper-resistant by design.
- `20260423140000_admin_audit_log.sql` — audit trail.
- `20260427000000_dive_sites.sql` — dive sites for `/map`.
- `20260428000000_cert_levels.sql` — certification reference data.
- `20260429000000_dive_travel_and_cancellation_policies.sql` —
  transport + cancellation policy reference data.
- `20260429240000_staff_role.sql` — added the `staff` role and
  `is_staff_or_admin()` helper.
- `20260430040000_eo_dive_rooms_junction.sql` — modern junction for
  the legacy CSV `room_types` column on `EO_dives`.

## `BookingDetails` JSONB shape

Defined in `src/types/database.ts` — that file is the source of truth.
DB only enforces `jsonb_typeof(details) = 'object'`. Current shape:

```ts
interface BookingDetails {
  gear?: {
    rent: boolean
    included?: boolean              // event bundles gear (e.g. OW course)
    mode?: 'a-la-carte'             // gear is rented à-la-carte only
    items?: string[]                // chosen gear items
    assistance_note?: string        // diver picked "ask a human"; their note
                                    //   (when set, rent is false)
    size_overrides?: { height_cm?, weight_kg?, shoe_size? }
  }
  room?: { option_id?: string | null; notes?: string | null }
  add_ons?: string[]                // Other_Addons._id list
  transportation?: boolean
  payment_method?: 'bank_transfer' | 'credit_card' | 'cash'
  pay_deposit_only?: boolean        // deposit-only-at-registration flag
  nitrox_course_addon?: boolean
  charges?: ChargeLine[]            // itemized snapshot — see below
  total?: number                    // final-charge snapshot
  deposit?: number                  // EO_prices.deposit_amount snapshot
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
