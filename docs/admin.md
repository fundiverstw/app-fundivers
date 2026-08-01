# Admin

Admins (`profile.role === 'admin'`) and staff
(`profile.role === 'staff'`) share the admin shell at `/admin/*`.
Staff is a read-mostly subset; everything that mutates catalog or
user data is admin-only. The shells (`AppShell` / `AdminShell`) are
mirror images — same visual language, separate nav, with a toggle to
swap.

## Routes

Read-only event surfaces — gated by `StaffOrAdminRoute` (staff +
admin):

| Route | Page | Purpose |
| --- | --- | --- |
| `/admin`                                | `DashboardPage`         | Shared dashboard (divers see it at `/dashboard`); admin variant pulls operational counts |
| `/admin/events`                         | `AdminEventsPage`       | Month view of every event with registration counts |
| `/admin/events/:id`               | `AdminEventDetailPage`  | Registrants, memos, status controls for one event |
| `/admin/events/:id/gear-map`      | `AdminGearMapPage`      | Per-registrant gear/sizing checklist for the event |

Write/manage routes — gated by `AdminRoute` (admin only):

| Route | Page | Purpose |
| --- | --- | --- |
| `/admin/new`                            | `AdminManagePage`       | Catalog landing — links to event/room/addon/travel/price editors |
| `/admin/new/event`                      | `AdminNewEventPage`     | Create a new dive or course |
| `/admin/events/:id/edit`          | `AdminEditEventPage`    | Edit event details |
| `/admin/rooms`                          | `AdminRoomsPage`        | Manage `EO_rooms` rows |
| `/admin/addons`                         | `AdminAddonsPage`       | Manage `Other_Addons` rows |
| `/admin/travel`                         | `AdminTravelPage`       | Manage `trip_templates` rows |
| `/admin/destinations`                   | `AdminDestinationsPage` | Manage `travel_destinations` rows |
| `/admin/prices`                         | `AdminPricesPage`       | Manage `EO_prices` rows |
| `/admin/users`                          | `AdminUsersPage`        | Searchable diver directory with full profile cards |
| `/admin/duty`                           | `AdminDutyPage`         | Assign staff/admin to events; fires push to assignee |
| `/admin/notifications`                  | `AdminNotificationsPage` | Compose + send a one-off Web-Push broadcast to all subscribed devices |

All routes are also wrapped by `ProtectedRoute` — see
[authentication.md](./authentication.md#role-gating).

## Event detail

`/admin/events/:id` shows one dive or course. The page has:

- **Registrants** — expandable cards per booking. Expanded view
  includes the diver's profile summary (cert, contact, sizing,
  medical), the full booking details (gear/room/addons), and the
  per-booking payments ledger.
- **Per-registrant actions:**
  - Change `bookings.status` to any of
    `pending` / `confirmed` / `waitlisted` / `cancelled`.
  - **Mark deposit paid** — shown on pending bookings. A pure status
    shortcut: confirms the booking (deposit received off-app) and does
    **not** record a payment or change the owed/paid balance. Record the
    actual amount received via the payments ledger; the owed/paid figures
    only ever move from recorded payments + amendments.
  - **Approve refund** — visible when `refund_requested_at` is set.
    Sets `status = 'cancelled'`. The actual refund transfer happens
    out-of-band; record it by inserting a `payments` row with
    `status = 'refunded'`.
- **Event memos** — see below.

### Boat manifest export

The **Export diver info** button opens a modal for the vessel details
(boat name, registration, footer notes — pre-filled and remembered in
`localStorage` since the chartered boat varies per trip), then calls the
`export-event-divers` edge function. The function emails an `.xlsx`
matching the Taiwanese recreational-fishing-vessel passenger form
(娛樂漁業漁船出海人員名冊) to the shop inbox, BCCing the requesting admin.

- Rows: every **pending** or **confirmed** booking (cancelled and
  waitlisted divers are excluded), followed by the **staff on duty** for
  the event (the `duties` rows — instructors / guides / support). Staff
  are deduped by person (a course duty is one row per day) and anyone
  already listed as a booked diver is skipped, so no one appears twice.
- Columns are the official Chinese form (編號 / 姓名 / 身分證字號 / 出生
  年月日 / 性別 / 潛水執照等級 / 潛水總支數 / 國家 / 備註). The sheet is
  Unicode, so no font embedding is needed. The 姓名 column is the diver's
  legal `name` (exactly as on their ID) — the informal nickname is omitted,
  since the manifest must match identity documents.
- A staff member's role is written into the 備註 (remark) column,
  localized to Chinese (`instructor`→`教練`, `guide`→`導潛`,
  `support`→`支援`); booked divers leave 備註 blank.
- Gender and nationality are best-effort localized to Chinese
  (`male`→`男`, `American`→`美國`); unrecognized free-text values pass
  through untouched. See `_shared/event-divers-manifest.ts` (pure,
  unit-tested) for the mappings and `_shared/event-divers-xlsx.ts` for
  the SheetJS serialization.
- The function returns `{ diver_count, staff_count }`; the toast shows
  both (e.g. "7 divers + 2 staff").

## Transport: runs, seats, riders

Everything on the Logistics day view (`/admin/logistics`) is planned per
**run** — the set of events that travel together. Two dives at the same
site share a van; a course at the pool and a dive at Bat Cave cannot,
and no field in the schema can tell them apart. So the shop states it:
the **Shared transport** picker in the day's Overall board writes
`event_ride_groups` rows (one per `(ride_day, event_id)`; events sharing
a `group_id` ride together). An event with no row rides alone.

Given the runs, every count follows, and each of these is counted
**once**:

- **Seats** — `passenger_seats` over the run's *distinct* cars. A van
  assigned to both events of a run is one van with one set of seats.
- **Riders** — the divers who asked for a ride plus every on-duty staff
  member. There is no driver concept: staff take ordinary seats
  (`docs`-worthy consequence: a 7-seat van with 2 staff aboard has 5
  seats left for divers). Someone on duty who is also booked as a diver
  is one body.
- **Nothing is pooled across runs.** Two runs are planned separately, so
  slack in one never covers a shortfall in the other.

The board flags what can't physically happen: one car taken by two runs,
or one person (staff or diver) expected on two runs at once.

The same arithmetic backs the diver-facing "N ride seats left" on the
registration form, via the `event_ride_seats` RPC — `capacity = seats −
staff`, `claimed` = distinct divers holding a ride anywhere on the run.

A ride requested when the run is full is not refused: the booking goes
through flagged `details.ride_waitlisted`, and every admin gets an "add a
car" notification. That flag is **computed by the database** on insert and
on any details edit (`bookings_set_ride_waitlist`), not taken from the
client — a forged `false` would otherwise hide a full run from the shop,
and a stray `true` would page every admin about a ride nobody asked for.
A diver who already holds a ride somewhere on the run keeps it; a second
booking on the same run is the same body in the same seat.
The planner itself is pure and unit-tested in
`src/lib/vehicle-planning.ts` (`planFleet` for one run, `planRuns` for a
day); grouping lives in `src/lib/ride-groups.ts`.

## Gear: the packed tick list

Opening a sized gear chip on the Overall board ("BCD ×3") expands it into
the sizes the day needs and, under each size, one **toggle per diver's
piece**. Tapping a name flips it to packed; the size line then reads
"1/3 packed", or "all packed" once the size is done.

State is device-local (`localStorage`, `src/lib/gear-packed.ts`), stored
one entry per day and expired after the newest 14 days. That is a
deliberate limit, and the panel says so in the hint text: **the list does
not sync between phones.** It's a scratchpad for the person loading the
van during one packing session, not a record anyone reads back later, and
a checkbox that needed a round trip per tap would be worse at that job.
Making it shared would mean a table, RLS and realtime — a different
feature.

A piece is keyed `${bookingId}|${item}`; the size is **not** in the key,
so correcting a diver's size on their gear card doesn't lose the tick.
The set lives on `AdminLogisticsPage` rather than inside `GearChips`
because the seated and waitlist chip sets share one day's list — two
owners would clobber each other's writes.

## Gear: the next-day diff

A shop running back-to-back weekend days doesn't want to haul every set
back to base to dry only to load it again the next morning. The Overall
board's **Next-day gear** button opens the overlap between the day on
screen and the one after it: what stays on the van, what still has to
come off the rack, and what goes home to dry.

The unit of reuse is the **size**, not the item — three BCDs out today
only cover tomorrow if they are the sizes tomorrow wears — so the diff
is computed per `(item, size)` via the same `gearSizeBreakdown` the
size-expanding chips use. One-size kit (regulators, masks, computers)
matches on quantity alone.

Two rules keep it honest:

- **Only back-to-back days.** The button is offered when the *very next
  calendar day* has events. Across a gap the kit would be dried and
  racked anyway, so a carry-over suggestion would be unactionable.
- **An unknown size never carries over, and never enters the columns.**
  A diver with no size on file can't be promised a match, so their
  pieces are held out of all three columns and listed once under
  **Sizes to confirm** with the names to ask. Counting them as "also
  pack" *and* "back to the shop" was the first attempt, and it read as
  a broken diff: one unsized diver puts a line in every sized item they
  rent (BCD, wetsuit, fins, boots at once), and because everyone who IS
  sized quietly cancels out into "Stays out", the unsized minority was
  the only thing left visible.

Both sides count **seated** rows only, matching every other prep total:
a waitlisted diver's gear isn't packed today, so it can't be kept out
for tomorrow. `gearDayDiff` in `src/lib/logistics.ts` is pure and
unit-tested; the panel is `src/components/admin/NextDayGearDiff.tsx`.

## Event memos

`event_memos` is a free-form "sticky note" table for operational flags.
Memos surface on the admin event-detail page and are **not visible to
divers**.

Every memo is:

- Attached to exactly one of `eo_dive_id` / `eo_course_id` (XOR check).
- Tagged with one of: `urgent`, `payment`, `gear`, `logistics`,
  `cert`, `medical`, `note`. The tag drives the colour in the UI.
- Free-text content, 1–2000 chars.
- **Resolvable** — when resolved, `resolved`, `resolved_by`, and
  `resolved_at` are set as a trio (DB CHECK enforces this). Resolved
  memos stay in the table but are visually separated.

UI: `src/components/admin/EventMemos.tsx`. Admins create memos, tag
them, and flip resolved when handled.

## Users

`/admin/users` is a searchable directory:

- Search matches `name`, `nickname`, `contact_id`, and `phone`.
- Each diver renders as an expandable card showing everything in
  `profiles` except `id` / timestamps:
  personal · emergency contact · certification · sizing · medical notes.
- Expanded state also fetches the diver's bookings + a payment summary
  (paid vs pending totals).
- Badge next to the name shows `diver` / `admin`.

## Role-view toggle

Admins can switch between diver and admin shells without logging out:

- `AppShell` (diver) shows a "View as admin" link when
  `profile.role === 'admin'`.
- `AdminShell` shows a "View as diver" link regardless.

Both are just navigation — they don't change the user's role or
privileges. It exists so an admin can look at the diver experience
with their own test bookings.

## Permissions cheat-sheet

| What | Diver | Staff | Admin |
| --- | --- | --- | --- |
| Read own profile / bookings / payments | yes | yes | yes |
| Read any profile / bookings / payments | no | yes | yes |
| Create / update own bookings | yes | yes | yes |
| Insert / update payments | no | no | yes |
| Create / resolve event memos | no | no | yes |
| Read & insert `admin_notes` (own attribution) | no | yes | yes |
| Update / delete `admin_notes` | no | no | yes |
| Manage `EO_*` catalog (new/edit/rooms/addons/travel/prices) | no | no | yes |
| Assign duties | no | no | yes |
| Be assigned a duty (trigger gate) | no | yes | yes |
| Send broadcast push | no | no | yes |

The actual enforcement lives in RLS policies in the migrations
(`is_admin()` for writes; `is_staff_or_admin()` for the shared reads).
