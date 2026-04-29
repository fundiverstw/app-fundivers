# Data model

## Table map

```
auth.users (Supabase)
    │ 1-1 via handle_new_user() trigger
    ↓
public.profiles ────────────────── one row per diver / admin
    │
    │ 1-many                   ┌──── EO_dives   (Bubble-imported catalog)
    │                          │
    ↓                          │── EO_courses
public.bookings ── eo_dive_id XOR eo_course_id (text FK)
    │                          │── EO_prices  (linked by EO_dives.price)
    │ 1-many                   │── EO_rooms   (linked via CSV room_types)
    ↓                          │── Other_Addons (linked via JSON other_addons)
public.payments                └──
    (staff-recorded ledger)

public.event_memos ── eo_dive_id XOR eo_course_id   (admin flags per event)
public.push_subscriptions ── per device
public.push_notifications_sent ── cron idempotency ledger
```

## App-owned tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`), `role` | `role in ('diver','admin')`. Row auto-created by `handle_new_user()` on signup. Contains personal + certification + sizing + emergency contact. |
| `bookings` | `id`, `user_id`, `eo_dive_id` \| `eo_course_id`, `status`, `details` (jsonb), `refund_requested_at` | Exactly one of `eo_dive_id` / `eo_course_id` set (XOR CHECK). `details` shape enforced app-side by `BookingDetails` in `src/types/database.ts`. Unique per (user, event). |
| `payments` | `id`, `user_id`, `booking_id`, `amount`, `status`, `method`, `recorded_by` | Ledger entries, staff-inserted. `status in ('pending','paid','refunded')`. |
| `event_memos` | `id`, `eo_dive_id` \| `eo_course_id`, `tag`, `content`, `resolved_*` | Same XOR pattern as bookings. Tags: `urgent` / `payment` / `gear` / `logistics` / `cert` / `medical` / `note`. Resolution flags come as a trio (all null or all set, DB-enforced). |
| `push_subscriptions` | `endpoint` (unique), `user_id`, `p256dh`, `auth` | One row per device. Diver owns their rows (RLS). |
| `push_notifications_sent` | `(user_id, event_id, kind)` composite PK | Idempotency ledger for the push cron. Service-role-only. |

## `EO_*` catalog tables (Bubble-imported)

These came from a Bubble.io database. **Treat them as read-mostly
reference data** — the diver app only reads them; admin surfaces can
edit specific columns.

| Table | Primary key | Date/time fields |
| --- | --- | --- |
| `EO_dives` | `_id` (text) | `start_date` / `end_date` / `time` are **text** (`'YYYY-MM-DD'`, `'HH:MM:SS.sss'`) |
| `EO_courses` | `_id` (text) | same shape, plus `special_date` (see [events-and-bookings.md](./events-and-bookings.md#special_date)) |
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

- **Diver-owned rows** (`bookings`, `payments`, `push_subscriptions`):
  users can read/insert/update/delete rows where `auth.uid() = user_id`.
- **Admin-wide read** for `bookings`, `payments`, `profiles`,
  `event_memos`: admins get `for select` (and some `for all`) via an
  `exists (… profiles where id = auth.uid() and role = 'admin')`
  subquery.
- **Service-role bypasses RLS.** The push cron uses the service-role
  key exactly for this reason; no user token could legitimately scan
  every diver's upcoming bookings.
- **Tables with no user-facing policies** (`push_notifications_sent`)
  are service-role-only — RLS is on but no policies exist, so
  unprivileged clients get zero rows.

## Migrations

Forward-only. **Never edit a migration that has been `make push`'d.**
Applied migrations are locked — the registry in `supabase_migrations`
will refuse the push if a checksum changed.

To evolve a table, write a new migration that does `alter table …` or
adds a column / constraint / policy. File naming is
`YYYYMMDDHHMMSS_<slug>.sql`.

### Migration history

| File | Purpose |
| --- | --- |
| `20260416111642_initial_schema.sql`            | Baseline: profiles + activities + bookings + payments + RLS |
| `20260421130941_remote_schema.sql`             | Import EO\_\* Bubble catalog tables |
| `20260421150000_swap_activities_for_eo_events.sql` | Replace `activities` with XOR FKs to EO\_dives / EO\_courses |
| `20260421160000_drop_events_view.sql`          | Remove the interim `events` UNION view |
| `20260421170000_profile_fields_and_roles.sql`  | Narrow role → (diver, admin); add cert/contact/sizing fields |
| `20260422100000_bookings_details.sql`          | Add `details jsonb` to bookings |
| `20260422110000_event_memos.sql`               | Staff memo flags per event |
| `20260422160000_booking_refund_requested.sql`  | Add `refund_requested_at` |
| `20260422170000_eo_id_defaults.sql`            | `gen_random_uuid()::text` default on EO\_\*.\_id |
| `20260422180000_push_notifications.sql`        | `push_subscriptions` + `push_notifications_sent` |

## `BookingDetails` JSONB shape

Defined in `src/types/database.ts`. DB only enforces
`jsonb_typeof(details) = 'object'`; the TypeScript type is the source of
truth.

```ts
interface BookingDetails {
  gear?: { rent: boolean; mode?: 'full'|'a-la-carte'|'provided'; items?: string[]; size_overrides?: {...} }
  room?: { option_id?: string|null; notes?: string|null }
  add_ons?: string[]                       // EO Other_Addons._id list
  transportation?: boolean
  payment_method?: 'bank_transfer'|'credit_card'|'cash'
  nitrox_course_addon?: boolean
  total?: number                           // computed at booking time (final charge)
  deposit?: number                         // copied from EO_prices.deposit_amount at booking time
}
```

**Design note:** `total` and `deposit` are snapshotted into the booking
so later price changes don't retroactively alter what the diver owes.
