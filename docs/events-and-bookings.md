# Events & bookings

## Event data flow

**One table drives the calendar:** `events`, discriminated by `kind`
(`dive` | `course` | `adventure`). Dives and adventures carry a
`start_date` / `end_date` envelope; courses run on an explicit list of days
(see [#course_days](#course_days)). Which shape a kind uses is a question
you ask — `usesDateEnvelope(kind)` / `usesCourseDays(kind)` from
`src/lib/event-kinds.ts` — never a `kind === 'dive'` test. See
[data-model.md](./data-model.md#ask-what-a-kind-does).

Normalization into a uniform `AppEvent` type happens in
`src/lib/events.ts`:

- `fetchEventsInRange(fromDate, toDate)` — calendar month views.
- `fetchEventsForBookings(eventIds)` — bookings / payments pages that need
  to show event info alongside a booking row.
- `fetchUpcomingEventDays()` — the dashboard's next-days strip.

Both range queries filter on `DATE_ENVELOPE_KINDS` / `COURSE_DAY_KINDS`
rather than naming kinds, so a new kind joins the right query the moment
it answers `usesDateEnvelope`. Every UI surface reads `AppEvent`, not raw
`events` rows.

### `AppEvent` shape (abbreviated)

```ts
{
  id: string                 // events.id (uuid)
  type: EventKind            // 'dive' | 'course' | 'adventure'
  title: string              // display_title || admin_title || fallback
  calendar_title: string | null   // short label for the calendar grid pill
  start_time: string         // ISO timestamp (shop-local, composed from the row)
  end_time:   string | null
  start_time_hhmm: string | null  // 'HH:mm', null when no time is set
  price:      number | null
  deposit_amount: number | null
  transport_price: number | null
  currency:   string         // locale.currency
  capacity / confirmed_count / fully_booked / cancelled_at / is_private
  has_rooms / room_type_ids / has_addons / addon_ids / gear_rental_info / nitrox_required / dive_days
  details?: EventDetails | null   // the calendar modal's descriptive block
}
```

`src/types/database.ts` is the full, commented definition.

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

A course runs on an explicit list of dates: `events.course_days`
(a `date[]`, 1–4 entries — DB CHECK `events_course_has_days`, which also
enforces that a `kind = 'course'` row has them at all). Admins
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
(`src/components/register/RegisterForm.tsx`) — a four-step modal:

1. **Event info** — confirm title, dates, base price. Disabled if the
   event is `fully_booked`.
2. **About you** — name, date of birth, nationality, gender, height,
   weight, contact, certification. Every one of them optional (see
   below).
3. **Extras** — gear, room, add-ons, transport, nitrox course.
4. **Payment** — payment method + notes, final price summary.

### What the form insists on

Not personal details. Name, date of birth, nationality, gender, contact
handle, certification and gear sizes are all asked for and none of them
block the booking — the shop chases what it still needs later, and
`src/lib/profile-completeness.ts` says what that is. Four things do gate:

- **An account.** A guest supplies an email, a password (8+) and the
  terms checkbox, and solves the Turnstile captcha.
- **Evidence for a claim.** Naming a cert level, or ticking nitrox /
  deep, demands the card photo — or, for the main cert, the "I'll bring
  the physical card" acknowledgment. Claiming nothing demands nothing.
- **The booking's own decisions.** Whether a ride is needed, and whether
  gear is rented — the shop can't reserve a seat or pack a set on a
  blank.
- **Acknowledgments.** Event prerequisites the diver doesn't meet, and
  the cancellation policy.

`supabase/functions/_shared/registration-eligibility.ts` is the
server-side mirror, so a crafted request is held to the same short list.
The on-behalf-of paths (admin, parent) relax the first three further
still.

### Gear sizes

Height and weight are asked of every diver on step 2, whatever the event
— they are what `src/lib/gear-sizing.ts` matches a wetsuit and a BCD
against on the logistics board, and the diver who needs the fit is often
the one who never sees a rental question. Shoe size is narrower: it is
asked only when something goes on a foot, and only when the profile
hasn't already got one.

A gear-included course — Discover Scuba / Try Dive, Open Water, anything
`isGearIncludedCourse` recognises — is a diver who owns nothing, so the
form assumes the full set (`FULL_GEAR_SET`) rather than asking, and the
booking records `gear: { rent: false, included: true }`. That assumption
is exactly why the size question still has to be put: nobody chose the
items, but the shop still has to pack ones that fit. `needsShoeSize()`
in `src/lib/logistics.ts` answers the question for both register flows,
of the à-la-carte selection in one and of the assumed full set in the
other.

### Price composition

```
total = base_price
      + gear_cost       (0 if included; otherwise à-la-carte only:
                         ∑ per-item × days for the chosen items)
      + room_cost       (selected rooms.added_price)
      + addons_cost     (∑ addons.price for selected ids)
      + transport_cost  (event.transport_price if surcharge>0 and ticked;
                         else 0 — surcharge=0 means transport is bundled
                         and we render "Included with base price")
      + nitrox_course   (business.nitroxCourseFee if required-and-not-
                         certified and ticked)
total *= 1 + business.cardSurchargePercent/100
                        (if payment_method === 'credit_card')
```

Every figure in that formula is shop config, not a literal: gear prices
(`GEAR_ALACARTE_PRICES` in `src/lib/gear.ts`) and `NITROX_COURSE_FEE` (in
`src/lib/booking-charges.ts`) both read `business.*` from
`fundive.config.ts`. Gear is à-la-carte only — there is no full-set
package. **Transport** is a per-event integer on the linked
`prices.transport` row, surfaced on `AppEvent` as `transport_price`.

`buildCharges()` in `src/lib/booking-charges.ts` turns these into an
itemized `ChargeLine[]` that is both shown in the form summary and
snapshotted onto the booking as `details.charges`, so the breakdown is
frozen against later price changes (see
[data-model.md § BookingDetails](./data-model.md#bookingdetails-jsonb-shape)).

### What gets written

The form does **not** write to `bookings` directly. It invokes the
`create-registration` Supabase Edge Function
(`supabase/functions/create-registration/handler.ts`) which atomically:

1. Resolves `event_id` against `events` (and rejects an event that has
   already happened) before doing anything expensive.
2. (Guest path only) Creates the auth user with `email_confirm: true`
   so a typo'd address is rejected loudly instead of silently dropped.
3. Updates `profiles` from `profile_patch`.
4. Inserts one row into `public.bookings` (under service-role, so RLS
   doesn't apply at this stage):
   - `user_id`, `status: 'pending'`
   - `event_id` — the single FK to `events`. The request body also carries
     `event_type` (the `kind`), which the function uses for the
     has-it-passed check and to read the right dates for the emailed copy
     (`usesCourseDays(event_type)` picks `course_days` over the envelope)
   - `notes` — free-text field from the form
   - `details` JSONB — see
     [data-model.md § BookingDetails](./data-model.md#bookingdetails-jsonb-shape).
     `total` / `deposit` / `charges` are snapshots, and the function
     **recomputes `total` and `deposit` server-side** from the event's
     linked `prices` row (`computeBookingMoney`) rather than trusting the
     client's figures — they are what `apply_credit_to_booking` and
     `record_group_payment` read, so a crafted request must not be able to
     set its own.
5. Builds a registration PDF (`supabase/functions/_shared/pdf.ts`) and
   sends it via Gmail SMTP to `contact.email` from the config and to the
   diver — unless `suppress_email` is set (group registration; see below).
6. Returns `{ booking_id, session? }` — `session` populated on the
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

The partial unique index `bookings_one_active_per_user_idx`
(`(user_id, event_id)` where the booking isn't cancelled) prevents a diver
from double-booking the same event — Supabase returns a conflict and the
form shows an error. Cancelled rows are excluded, so a diver who cancelled
can register again.

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

## One course, several scheduled courses

A student who starts Open Water on the 10th and finishes it with the
course three weeks later is **one course, two events**. Migration
`20260814000000_course_continuation.sql` adds the two columns that say
so:

| Column | Meaning |
| --- | --- |
| `bookings.continues_booking_id` | The earlier booking this one continues. The earlier booking holds the money; the continuation is always zero-cost (`details.total = 0`, one stated zero charge line, `details.course_continuation = true`). `NULL` on a normal booking. |
| `bookings.attend_days` | Which of the event's `course_days` this diver is actually there for. `NULL` — every existing booking, and every diver doing the whole course — means **all of them**. |

Created only by the admin, from the target course's page
("Continue a course here" → `CourseContinuationModal`), which calls the
`create_course_continuation` RPC. The RPC is where the rules live, not
the form: admin-only, both events must be courses, the days must belong
to the target course's `course_days`, the diver must not already be
booked on it, and a continuation cannot itself be continued (a third leg
points at the original booking, so "where is the money?" stays a lookup
rather than a walk). It optionally trims the *original* booking's
`attend_days` in the same call — the days the student actually attended
before they stopped.

`attend_days` is what keeps the day-level views honest. Every "who is
here today" read — `fetchDayGearRows`, the logistics day loader — filters
through `bookingsOnDay()` (`src/lib/course-continuation.ts`), so a
student booked for the last two days of a course is not counted, or
packed for, on the first two. A `NULL` attend_days always answers "yes,
present", which is what keeps every pre-existing booking correct.

Capacity is deliberately unchanged: a continuing student occupies a real
seat on the second course and counts toward it like any other registrant.
