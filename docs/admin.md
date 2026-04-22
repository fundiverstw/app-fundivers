# Admin

Admins (`profile.role === 'admin'`) see the same diver UI **plus** an
admin shell at `/admin/*`. The shells are mirror images — same visual
language, separate nav, and a toggle to swap between them.

## Routes

| Route | Page | Purpose |
| --- | --- | --- |
| `/admin`                         | `AdminDashboard`       | Counts (divers, bookings, unpaid payments) + quick links |
| `/admin/events`                  | `AdminEventsPage`      | Month view of every event with registration counts |
| `/admin/events/:type/:id`        | `AdminEventDetailPage` | Registrants, memos, status controls for one event |
| `/admin/users`                   | `AdminUsersPage`       | Searchable diver directory with full profile cards |

All gated by `AdminRoute` — see [authentication.md](./authentication.md#role-gating).

## Event detail

`/admin/events/:type/:id` shows one dive or course. The page has:

- **Registrants** — expandable cards per booking. Expanded view
  includes the diver's profile summary (cert, contact, sizing,
  medical), the full booking details (gear/room/addons), and the
  per-booking payments ledger.
- **Per-registrant actions:**
  - Change `bookings.status` to any of
    `pending` / `confirmed` / `waitlisted` / `cancelled`.
  - **Approve refund** — visible when `refund_requested_at` is set.
    Sets `status = 'cancelled'`. The actual refund transfer happens
    out-of-band; record it by inserting a `payments` row with
    `status = 'refunded'`.
- **Event memos** — see below.

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

- Search matches `full_name`, `contact_id`, and `cert_number`.
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

| What | Diver | Admin |
| --- | --- | --- |
| Read own profile | ✅ | ✅ |
| Read any profile | ❌ | ✅ |
| Read own bookings | ✅ | ✅ |
| Read any bookings | ❌ | ✅ |
| Create / update own bookings | ✅ | ✅ |
| Insert / update payments | ❌ | ✅ (`Staff can manage payments`) |
| Create / resolve event memos | ❌ | ✅ |
| Manage EO_* catalog | ❌ | *(not yet wired — use Supabase Studio)* |

The actual enforcement lives in RLS policies in the migrations.
