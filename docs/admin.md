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
| `/admin/events/:type/:id`               | `AdminEventDetailPage`  | Registrants, memos, status controls for one event |
| `/admin/events/:type/:id/gear-map`      | `AdminGearMapPage`      | Per-registrant gear/sizing checklist for the event |

Write/manage routes — gated by `AdminRoute` (admin only):

| Route | Page | Purpose |
| --- | --- | --- |
| `/admin/new`                            | `AdminManagePage`       | Catalog landing — links to event/room/addon/travel/price editors |
| `/admin/new/event`                      | `AdminNewEventPage`     | Create a new dive or course |
| `/admin/events/:type/:id/edit`          | `AdminEditEventPage`    | Edit event details |
| `/admin/rooms`                          | `AdminRoomsPage`        | Manage `EO_rooms` rows |
| `/admin/addons`                         | `AdminAddonsPage`       | Manage `Other_Addons` rows |
| `/admin/travel`                         | `AdminTravelPage`       | Manage `DiveTravel` rows |
| `/admin/prices`                         | `AdminPricesPage`       | Manage `EO_prices` rows |
| `/admin/users`                          | `AdminUsersPage`        | Searchable diver directory with full profile cards |
| `/admin/duty`                           | `AdminDutyPage`         | Assign staff/admin to events; fires push to assignee |
| `/admin/notifications`                  | `AdminNotificationsPage` | Compose + send a one-off Web-Push broadcast to all subscribed devices |

All routes are also wrapped by `ProtectedRoute` — see
[authentication.md](./authentication.md#role-gating).

## Event detail

`/admin/events/:type/:id` shows one dive or course. The page has:

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
