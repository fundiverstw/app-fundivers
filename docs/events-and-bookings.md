# Events & bookings

## Event data flow

Two catalog tables drive everything shown on the calendar:

- `EO_dives` — single-session dives.
- `EO_courses` — courses that run on an explicit list of days
  (see [#course_days](#course_days)).

Both use **text** `_id`, `start_date`, `end_date`, and time columns.
Normalization into a uniform `AppEvent` type happens in
`src/lib/events.ts`:

- `fetchEventsInRange(fromDate, toDate)` — calendar month views.
- `fetchEventsForBookings(diveIds, courseIds)` — bookings / payments
  pages that need to show event info alongside a booking row.

Every UI surface reads `AppEvent`, not raw `EO_*` rows.

### `AppEvent` shape (abbreviated)

```ts
{
  id: string                 // the EO_dives/EO_courses _id
  type: 'dive' | 'course'
  title: string              // dive_title || title || fallback
  start_time: string         // ISO timestamp (Taipei-local composed from text cols)
  end_time:   string | null
  price:      number | null
  deposit_amount: number | null
  currency:   'TWD'
  has_rooms / room_type_ids / has_addons / addon_ids / gear_rental_info / nitrox_required / dive_days
}
```

## Calendar rendering

`CalendarPage` (`src/pages/CalendarPage.tsx`) shows a month grid plus a
"This month" list below. The rendering has two quirks:

1. **Overscan.** It fetches events for `visible_month ± 7 days` so
   multi-day bars entering or leaving the month don't get truncated.

2. **Track-stacking** (`src/lib/calendar-layout.ts`):
   - Events are sorted ascending by `start_time`; longer events get
     lower tracks.
     - For each event, `assignTracks()` picks the lowest `track` index
     with no overlap against already-placed events.
   - Each cell caps at 3 visible tracks; overflow renders as `+N more`.
   - A bar that spans a week boundary is split: the left half ends at
     Sunday with `isEnd=true`, and a new segment starts Monday with
     `isStart=true` and `showTitle=true`. That way the title re-renders
     per visual row.

3. **Today marker.** Today's cell wears a `rose-900/30` background and
   a red day number.

### `course_days`

A course runs on an explicit list of dates: `EO_courses.course_days`
(a `date[]`, max 4 — DB CHECK `eo_courses_course_days_len`). Admins
enter each day in the event form. `courseToEvents()` in
`src/lib/events.ts` sorts + dedupes the list, groups **consecutive**
calendar days into one continuous segment, and emits one `AppEvent`
per run — exactly how a multi-day dive's `start_date..end_date` range
renders. Non-adjacent days emit separate pills.

| `course_days` | Segments emitted |
| --- | --- |
| `{05-10}` | `[05-10]` (single-day pill) |
| `{05-10, 05-11, 05-12}` | `[05-10 .. 05-12]` (one continuous bar) |
| `{05-10, 05-12}` | `[05-10]` + `[05-12]` |
| `{05-09, 05-10, 05-16}` | `[05-09 .. 05-10]` + `[05-16]` |

`start_date` / `end_date` are kept as the min/max **envelope** of
`course_days` so range fetches (`fetchEventsInRange` overlaps on the
envelope) and per-booking span lookups (`fetchEventsForBookings`) cover
every day the course exists on. Every segment shares the course `_id`,
so clicking any of them opens the same booking target.

## Register flow

Clicking an event in the calendar opens `RegisterForm`
(`src/components/register/RegisterForm.tsx`) — a three-step modal:

1. **Event info** — confirm title, dates, base price. Disabled if the
   event is `fully_booked`.
2. **Extras** — gear, room, add-ons, transport, nitrox course.
3. **Payment** — payment method + notes, final price summary.

### Price composition

```
total = base_price
      + gear_cost       (0 if included; otherwise à-la-carte only:
                         ∑ per-item × days for the chosen items)
      + room_cost       (selected EO_rooms.added_price)
      + addons_cost     (∑ Other_Addons.price for selected ids)
      + transport_cost  (event.transport_price if surcharge>0 and ticked;
                         else 0 — surcharge=0 means transport is bundled
                         and we render "Included with base price")
      + nitrox_course   (6,000 TWD if required-and-not-certified and ticked)
total *= 1.05           (if payment_method === 'credit_card')
```

Gear prices (`GEAR_ALACARTE_PRICES`) live in `src/lib/gear.ts`;
`NITROX_COURSE_FEE` lives in `src/lib/booking-charges.ts` (shared by both
register forms and the display-time recompute). Gear is à-la-carte only —
there is no full-set package. **Transport** moved out of the constants in
migration `20260430030000_eo_prices_transport_int.sql`: it's now a
per-event integer on the linked `EO_prices.transport` row, surfaced
on `AppEvent` as `transport_price`.

`buildCharges()` in `src/lib/booking-charges.ts` turns these into an
itemized `ChargeLine[]` that is both shown in the form summary and
snapshotted onto the booking as `details.charges`, so the breakdown is
frozen against later price changes (see
[data-model.md § BookingDetails](./data-model.md#bookingdetails-jsonb-shape)).

### What gets written

The form does **not** write to `bookings` directly. It invokes the
`create-registration` Supabase Edge Function
(`supabase/functions/create-registration/index.ts`) which atomically:

1. (Guest path only) Creates the auth user with `email_confirm: true`
   so a typo'd address is rejected loudly instead of silently dropped.
2. Updates `profiles` from `profile_patch`.
3. Inserts one row into `public.bookings` (under service-role, so RLS
   doesn't apply at this stage):
   - `user_id`, `status: 'pending'`
   - `eo_dive_id` XOR `eo_course_id` set from the event type
   - `notes` — free-text field from the form
   - `details` JSONB — see
     [data-model.md § BookingDetails](./data-model.md#bookingdetails-jsonb-shape)
     (`total`, `deposit`, and the itemized `charges` are snapshots).
4. Builds a registration PDF (`supabase/functions/_shared/pdf.ts`) and
   sends it via Gmail SMTP to `fundiverstw@gmail.com` and the diver —
   unless `suppress_email` is set (group registration; see below).
5. Returns `{ booking_id, session? }` — `session` populated on the
   guest path so the SPA can `setSession()` without a second
   round-trip.

If the booking insert fails on the guest path the function rolls back
the just-created auth user so the diver can retry cleanly.

The **admin edit path** (`existingBooking` set) skips the edge
function and updates `bookings.notes` / `bookings.details` directly
under the admin's RLS — no PDF, no account creation.

### Group registrations — one consolidated PDF

When a parent registers several divers together (the single-event
family picker in `RegisterForm`, or the multi-event cart in
`MultiRegisterForm`), every booking still goes through its own
`create-registration` call and shares a `group_id`. The difference is
email: each grouped call passes `suppress_email: true`, so
`create-registration` creates the booking but sends **no** per-diver
PDF. Once all the bookings land, the client calls
`send-group-summary` once with the shared `group_id`.

`send-group-summary`
(`supabase/functions/send-group-summary/handler.ts`) authorizes the
caller (must be a booked diver or the group's `payer_id`), reads every
booking in the group, and builds **one** consolidated PDF
(`buildGroupPdfBase64` in `_shared/pdf.ts`): a left column of field
labels plus one column per diver, two divers to a page, with a
group-total band summing every booking's `details.total`. It emails
that single PDF to the shop and the lead — N divers, one email each
way, instead of N separate PDFs. Solo registrations (one booking) are
unchanged: they still get the per-diver `buildPdfBase64` PDF.

This is why the **cost summary** on `RegisterForm`'s payment step shows
a *group total* (per-diver figure × diver count) when the lead pays for
everyone: each sibling booking carries the same per-diver `total`, so
what the lead owes is the sum.

The unique indexes `bookings_user_dive_uniq` /
`bookings_user_course_uniq` prevent a diver from double-booking the
same event — Supabase returns a conflict and the form shows an error.

## BookingsPage — the diver's view

`src/pages/BookingsPage.tsx` renders the diver's own bookings as
expandable cards, grouped into **Upcoming** and **Past / Cancelled**.
Each card shows:

- Title + start date + status badge
- Total, deposit (with ✓ or "due"), paid-so-far
- Breakdown (gear, room, add-ons, notes)

**Available actions per booking:**

- **Cancel booking** — only if `status === 'pending'` and
  `paidSum < deposit`. Sets `status = 'cancelled'`.
- **Request refund** — only if `paidSum >= deposit` and
  `refund_requested_at IS NULL`. Stamps the timestamp; the admin
  approves / denies in
  [admin.md § Event detail](./admin.md#event-detail).

## Non-obvious rules

- Bookings are **never deleted** by the app — status becomes
  `cancelled` instead. This preserves the payments ledger.
- Payment `method` on the booking is the diver's declared preference;
  the actual `payments.method` may differ (recorded by staff).
- `BookingDetails.deposit` can be missing or 0 when the event carries
  no `deposit_amount`. In that case `PaymentsPage` shows no
  "Deposit due" line for that booking.
