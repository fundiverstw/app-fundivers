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
| `/admin`                                | —                       | Redirects to `/admin/logistics`, the day board |
| `/admin/home`                           | `DashboardPage`         | Shared home page (divers see the same one at `/dashboard`) — welcome banner, featured trips, and the shortcut tiles, including the admin-only dive-site map. Where the header logo points |
| `/admin/logistics`                      | `AdminLogisticsPage`    | The day board: runs, seats, riders, gear — see [Transport](#transport-runs-seats-riders) |
| `/admin/events`                         | `AdminEventsPage`       | Month view of every event with registration counts |
| `/admin/events/:id`               | `AdminEventDetailPage`  | Registrants, memos, status controls for one event |
| `/admin/events/:id/gear-map`      | `AdminGearMapPage`      | Per-registrant gear/sizing checklist for the event |
| `/admin/accounting`                     | `AdminAccountingPage`   | Revenue by staff + document exports. Staff get the revenue tab only, scoped to themselves — see [Revenue by staff](#revenue-by-staff) |

Write/manage routes — gated by `AdminRoute` (admin only):

| Route | Page | Purpose |
| --- | --- | --- |
| `/admin/new`                            | `AdminManagePage`       | Catalog landing — links to event/room/addon/travel/price editors |
| `/admin/new/event`                      | `AdminNewEventPage`     | Create an event of any `kind` (dive / course / adventure), optionally as a recurring series |
| `/admin/events/:id/edit`          | `AdminEditEventPage`    | Edit event details |
| `/admin/rooms`                          | `AdminRoomsPage`        | Manage `rooms` rows |
| `/admin/addons`                         | `AdminAddonsPage`       | Manage `addons` rows |
| `/admin/travel`                         | `AdminTravelPage`       | Manage `trip_templates` rows |
| `/admin/destinations`                   | `AdminDestinationsPage` | Manage `travel_destinations` rows |
| `/admin/prices`                         | `AdminPricesPage`       | Manage `prices` rows |
| `/admin/payment-methods`                | `AdminPaymentMethodsPage` | How divers can pay: the method list, each one's bank account / payment link / surcharge — see [payments.md § Payment methods](./payments.md#payment-methods) |
| `/admin/contact`                        | `AdminContactPage` | How divers reach the shop: the company email / phone / address / map link, and the ordered list of Contact-tab buttons (LINE, WhatsApp, Telegram, a phone number, …). Replaces what used to be `siteConfig.contact` |
| `/admin/users`                          | `AdminUsersPage`        | Searchable diver directory with full profile cards |
| `/admin/duty`                           | `AdminDutyPage`         | Assign staff/admin to events; fires push to assignee |
| `/admin/notifications`                  | `AdminNotificationsPage` | Compose + send a one-off Web-Push broadcast to all subscribed devices |
| `/admin/backup`                         | `AdminBackupPage`       | Download the whole database as one CSV-per-table ZIP — see [Database backup](#database-backup) |
| `/admin/shutdown`                       | `AdminShutdownPage`     | Guided shut-down: readiness checks, exports, a farewell push, and the ordered switch-off list — see [Closing down](#closing-down) |

All routes are also wrapped by `ProtectedRoute` — see
[authentication.md](./authentication.md#role-gating).

## Event detail

`/admin/events/:id` shows one event, whatever its `kind`. The page has:

- **Registrants** — expandable cards per booking. Expanded view
  includes the diver's profile summary (cert, contact, sizing,
  medical), the full booking details (gear/room/addons), and the
  per-booking payments ledger.
- **Per-registrant actions:**
  - Change `bookings.status` to any of
    `pending` / `confirmed` / `waitlisted` / `cancelled`.
  - **Promoting off the waitlist emails the diver.** `waitlisted` →
    `confirmed` is the only status change that notifies, via the
    `notify-booking-confirmed` edge function. Every other status the
    shop sets follows something the diver just did — they registered,
    they paid, they asked to cancel — but someone on the waitlist is
    waiting on a stranger to drop out, so without a message they find
    out by opening the app on the off chance. The predicate is
    `isWaitlistPromotion` in `src/lib/booking-status.ts`; the send is
    fire-and-forget, so a bounced email surfaces as a toast telling the
    admin to call them, and never rolls back the seat.

    This is the *manual* path only. When a cancellation frees a spot,
    the cron worker offers it to the next person in line and
    `notify-waitlist-offer` emails them a deadline to accept — that
    email asks for an action, this one doesn't, because the shop has
    already handed the seat over.
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

**A ride is never a question about the event's kind.** `event_vehicles`
accepts any event, `event_ride_tally` matches ride days against
`course_days` as explicitly as against a date envelope, and the shop
drives Open Water students out to their shore days. Both register forms
therefore fetch the tally for every kind. They did not always: courses
used to skip the lookup, so a full car showed no warning and the DB
trigger below waitlisted the diver with nothing on screen having said so.

**It is a question about the event.** A dry course — EFR, an Equipment
specialty, an O2 provider course — moves nobody, and asking a diver
registering for one whether they want a ride to the site is a question
with no right answer. The **Transport not needed for this event** switch
in the vehicle section (`EventCarAssignment` on the edit page and the
event's Transportation tab, `CreateEventVehiclePicker` on the new-event
form) writes `events.has_transport`. With it off, both register forms
render no transport fieldset and never fetch the seat tally, the step
stops waiting for an answer, and `create-registration` forces
`details.transportation` to false rather than trusting a request that
answers a question the form never put. It is admin-set rather than
inferred because "not strictly a diving course" is not a fact the kind or
the title carries — and the last helper that guessed transport from the
kind was wrong in both directions.

Turning it off leaves any cars already assigned to the event in place;
the section says how many are still there, so nothing is silently
orphaned and switching back on restores what was picked.

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

## Reading the board with no signal

The next ten days of this board are kept on staff and admin devices, so it
still reads on a boat. It is read-only there, it says on screen when what
you are looking at came off the device rather than the network, and a
diver's medical notes, ID number, date of birth and emergency contacts are
never written to a device at all. See [offline.md](./offline.md).

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

An item the shop stocks in more than one style is a separate line per
style, because they are separate racks: a felt-soled boot does not cover
a diver who asked for rubber. Both styles still size off the same profile
column (boots off `shoe_size`), so `Boots (felt sole) · JP 26` and
`Boots (rubber sole) · JP 26` are two rack slots, not one. See
[forking.md](./forking.md#gear-catalog) for how the catalog declares them.

FunDivers rents one of those two: the rack is felt soles, which is what
grips the algae-covered rock on our shore entries. Rubber soles stay in
the catalog so a diver can record that they own a pair — the board reads
that as a filled slot and packs them no boots, and they can still ask for
felt ones on a dive that wants the grip. Nothing the shop doesn't rent
can be booked, so `Boots (rubber sole)` should never reach a packing
total; if it does, it is a row that predates
`20260817000000_rent_felt_soled_boots_only.sql`.

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

## Event memos (`admin_notes`)

`admin_notes` is the free-form "sticky note" table for operational flags.
Memos surface on the admin event-detail page and the per-diver gear card,
and are **not visible to divers**.

Every memo is:

- Attached to exactly one target — `event_id` **or** `booking_id`, never
  both and never neither (CHECK `admin_notes_target_present`). This is the
  one XOR left in the schema; events themselves are a single table now.
- Tagged with one of: `urgent`, `payment`, `gear`, `logistics`, `cert`,
  `medical`, `note`, `general`. The tag drives the color in the UI, and
  the gear card filters to `gear`-tagged notes on the booking.
- Free-text content, 1–2000 chars.
- **Resolvable** — when resolved, `resolved`, `resolved_by`, and
  `resolved_at` are set as a trio (CHECK `admin_notes_resolved_consistency`).
  Resolved memos stay in the table but are visually separated.

UI: `src/components/admin/AdminNotes.tsx`, which takes a
`target={{ kind: 'event' | 'booking', id }}`.

Standing facts about a **person** go in `diver_notes` instead (allergies,
accommodations — anything true every time they dive, not just on one
event). Those hang off `profile_id`, render on the diver's card at
`/admin/users`, and have `profile_id` / `created_by` / `created_at` frozen
by trigger so the attribution can't be rewritten.

## Users

`/admin/users` is a searchable directory:

- Search matches `name`, `nickname`, `contact_id`, and `phone`.
- Each diver renders as an expandable card showing everything in
  `profiles` except `id` / timestamps:
  personal · emergency contact · certification · sizing · medical notes.
- Expanded state also fetches the diver's bookings + a payment summary
  (paid vs pending totals).
- Badge next to the name shows `diver` / `admin`.
- **Deep link:** `/admin/users?diver=<id>` opens (and scrolls to) that
  diver's card. Every name chip on the Logistics board — the day's
  divers, the on-duty staff, the tentative waitlist — links here, as
  does each diver gear card, so a name read while packing can be
  followed to sizes and contact without retyping it into the search.
  Staff see plain text instead: the directory is admin-only, so the
  link would only bounce them.

## Revenue by staff

`/admin/accounting` carries two tabs: the document exports it always
had, and **Revenue** — what each paid crew member generated over a
season. Staff reach the same route and get only the revenue half,
scoped to themselves; the page renders no tab bar and no exports for
them, and `StaffRevenuePanel` narrows the fetch to the events they
were actually rostered on.

The attribution rule lives in `src/lib/staff-revenue.ts` (pure, and
unit-tested against every branch):

| Kind | instructor | guide | support |
| --- | --- | --- | --- |
| course (anything `isInstructorLed`) | earns | — | — |
| dive / adventure | earns | earns | — |

Two people who both qualify on one event split it evenly.

Who the shop actually *pays* is not recorded anywhere, and deliberately
so: attribution is inferred from the duty roster, so anyone rostered in
an earning role shares the event. A `compensated`-style flag was tried
and dropped — it starts false for every existing profile, and a report
that silently attributes nothing looks exactly like a report with
nothing to attribute. The shop applies its own knowledge of who is on
the payroll when reading the numbers.

Revenue is the event's **base price times its confirmed heads** — the
course fee or the dive fee, per student. Deliberately not the money
received: what a person generated is a property of the work they did,
not of whether an invoice has been settled, and a course whose balance
lands in November did not stop being June's teaching. Deliberately not
the booking's full total either — gear rental, transport and add-ons are
the shop's margin on hire and logistics, not something the instructor
generated by teaching.

Each booking's base comes from the charge snapshot taken at
registration (`bookings.details.charges`, the `base` line), so a later
catalog price change cannot retroactively rewrite what a season
earned, and a group discount is respected per head. Bookings predating
that snapshot fall back to the event's current catalog price
(`prices.starting_at`). See `bookingBase` in `staff-revenue.ts`.

Cancelled events drop out entirely; their money is a refund story the
Audits page tells. Only confirmed bookings count as heads.

Only events whose last day has passed count toward the season figure.
Anything still to come is reported separately as a one-line note, so
"what has this person generated" can't be inflated by a trip that
hasn't happened.

Events that took money with nobody rostered who could earn from them
land in an **Unattributed** block, admin-only, listing the specific
events so duties can be filled in retroactively. Without it the
per-person columns would quietly fail to reconcile with what the shop
actually took.

An admin gets a **crew picker** beside the season picker: "All crew"
shows the comparison table (click a name to expand it in place), or
pick one person for their season alone. The picker lists every
admin/staff profile, not only those with revenue — you have to be able
to select someone before you can learn they earned nothing.

A person's season reads two ways, both expandable rather than flat:

- **By month** — one row per month with its course count, dive count
  and revenue. Clicking the month lists the events behind those counts,
  each linking to its event page.
- **By type** — two rows, Courses and Dives, each opening into its own
  breakdown (OW / AOW / EANx under Courses; the dive names under
  Dives). A group with no work that season is omitted rather than shown
  empty.

Reachable from **Business performance** (`/admin/dashboard`), which
links to it beside the historical-perspective link, and from the
Manage hub. Staff get it as a nav item, since the dashboard is
admin-only.

## Database backup

`/admin/backup` hands an admin a copy of the shop's data to keep off the
Supabase project: every public table as a CSV, zipped, with a
`manifest.csv` of row counts and a `README.txt` saying what is and is not
in there.

The work happens in the `export-database-backup` edge function, which
runs as `service_role` (so RLS never trims a backup) and refuses anyone
whose profile role is not `admin` — staff included, since the archive
carries every diver's personal details, payments and waiver signatures.
It is rate-limited to five a day per admin through the shared
`take_action_slot` limiter.

Two things make it a backup rather than a dump of whatever the schema
happened to look like when someone last edited a list:

- **`backup_table_inventory()`** (migration `20260905000000`) names the
  tables, so a table added tomorrow is in tomorrow's backup. It returns
  each table's columns — an empty table still exports its header — and
  its primary key, which the function pages by (PostgREST caps a read at
  1000 rows, and paging without an ORDER BY can repeat or skip rows).
- **It refuses rather than truncates.** Past `MAX_TOTAL_ROWS` the
  function returns 413 instead of a silently partial archive.

What it is not: a restore point. There is no schema, no function, no
policy, no storage object (certification cards, signed waiver PDFs,
dive-site maps) and no `auth.users` — credentials live outside the
shop's own tables. `make backup-prod` is the pg_dump to take before a
risky migration; this is the copy a shop owner can keep on a laptop and
open in a spreadsheet.

## Closing down

`/admin/shutdown` (Manage → Close down the shop) is the guided path to
switching the app and its infrastructure off. It deletes nothing itself —
the destructive steps live in the Supabase and Cloudflare dashboards,
where they are already guarded — but it is the thing that stands between
an admin and a two-click project deletion:

1. **Readiness checks**, computed live from the database: how recently a
   backup was taken (read from `admin_audit_log`, which
   `export-database-backup` writes to on success), events still on the
   calendar, money owed to the shop, **unspent diver credit** (money the
   shop holds for someone — deleting the project erases the record, not
   the obligation), and how many diver accounts would go. Each warning
   links to the page that resolves it. The arithmetic is
   `src/lib/shutdown-readiness.ts`, pure and unit-tested.
2. **The exports that outlive the project** — links to the CSV backup and
   the bookkeeping / waiver ZIPs, plus a note about retention periods.
3. **A farewell push** to every subscribed device, prefilled, through the
   same `/admin-broadcast` endpoint the notifications page uses
   (`src/lib/push-broadcast.ts`, extracted so the two cannot drift).
4. **The ordered switch-off checklist** — domain, app worker, push
   worker, Turnstile, Supabase project, Gmail app password, repository,
   accounts. Ticks persist in `localStorage`, because closing a shop
   takes more than one sitting.

Two details worth keeping: the figures are read with
`fetchAllRows` (`src/lib/fetch-all.ts`) rather than a plain select,
because PostgREST caps a response at 1000 rows silently and "money still
owed" is not a number to under-report; and the long-form walkthrough —
account closure, DNS, storage buckets, what to keep for tax purposes —
lives in [`shutdown.md`](./shutdown.md), which the page links out to.

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
| Manage the catalog (events / rooms / addons / travel / prices) | no | no | yes |
| Assign duties | no | no | yes |
| Be assigned a duty (trigger gate) | no | yes | yes |
| Read own revenue by season | no | yes | yes |
| Read anyone's revenue / the unattributed bucket | no | no | yes |
| Send broadcast push | no | no | yes |

The actual enforcement lives in RLS policies in the migrations
(`is_admin()` for writes; `is_staff_or_admin()` for the shared reads).
