# Events & bookings

## Event data flow

Two catalog tables drive everything shown on the calendar:

- `EO_dives` — single-session dives.
- `EO_courses` — multi-day courses, sometimes with a detached
  "special" session (see [#special_date](#special_date)).

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

### `special_date`

A course row can carry `special_date` — a separate session that's
visually distinct from the main date range. `courseToEvents()` in
`src/lib/events.ts` mirrors Wix's original calendar emission by fanning
one course row out into 1–2 segments:

| Relationship | Segments emitted |
| --- | --- |
| `special_date` is null | `[start .. end]` |
| `special_date == end_date` | `[start]` + `[end]` |
| `special_date` is ±1 day from `start_date` | merged `[start..special]` + `[end]` |
| `special_date` is ±1 day from `end_date` | `[start]` + merged `[end..special]` |
| Far apart | `[start..end]` + lone `[special]` |

Every segment shares the course `_id`, so clicking any of them opens
the same booking target.

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
      + gear_cost       (0 / daily × days if full-set / per-item × days if à-la-carte)
      + room_cost       (selected EO_rooms.added_price)
      + addons_cost     (∑ Other_Addons.price for selected ids)
      + transport_fee   (1,300 TWD if ticked)
      + nitrox_course   (6,000 TWD if required-and-not-certified and ticked)
total *= 1.05           (if payment_method === 'credit_card')
```

All constants live at the top of `RegisterForm.tsx`:
`GEAR_FULLSET_DAILY`, `GEAR_ALACARTE_PRICES`, `TRANSPORT_FEE`,
`NITROX_COURSE_FEE`. Change them there, not in a config table.

### What gets written

One row into `public.bookings`:

- `user_id`, `status: 'pending'`
- `eo_dive_id` XOR `eo_course_id` set from the event type
- `notes` — free-text field from the form
- `details` JSONB — see
  [data-model.md § BookingDetails](./data-model.md#bookingdetails-jsonb-shape)
  - `total` snapshot (final charged amount)
  - `deposit` snapshot (copied from `event.deposit_amount`)

The unique index `bookings_user_dive_uniq` / `bookings_user_course_uniq`
prevents a diver from double-booking the same event — if they try,
Supabase returns a conflict and the form shows an error.

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
