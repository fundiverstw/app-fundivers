# Packages — partner referral network

A curated board of dive **travel packages abroad** that FunDivers vouches for.
When a diver we refer books one of these packages at the partner shop, the
partner pays us a kickback (default 5%). This is a referral network, not a
booking system — the booking and the money happen entirely at the partner shop.
The app only:

1. **curates** partner shops + their packages (admin),
2. **exposes** published packages to divers (the board), and
3. **tracks** the referral and the kickback we're owed.

It's the *push* complement to **Trusted Partners** (`TrustedPartnersPage`), which
is the *pull* side — a diver names a destination and we email them a vetted
shop. Packages proactively publishes specific trips abroad.

> Not to be confused with **Scheduled Trips** (`ScheduledTripsPage` /
> `scheduled_trips`), which are the shop's own dated, in-app-bookable trips.
> Packages are open-ended, booked at the partner shop.

## Why it's separate from bookings / payments / credits

Those tables model "the diver owes the shop, money flows **in**, recorded
manually." A package referral inverts both: the money is owed **by the partner to
us**, and the booking isn't ours to take. Reusing `bookings` would break its
XOR FK (`eo_dive_id` / `eo_course_id` are *internal* events) and pollute the
payment ledger with a reversed flow. So Packages has its own tables.

## Schema (`20260623000000_trip_board.sql`, renamed by `20260707150000_rename_trip_board_to_packages.sql`)

- **`partner_shops`** — the vouching registry. `name`, `country`, `location`,
  `website`, `logo_url`, `vouch_notes` are diver-facing; `contact_name` /
  `contact_email` / `default_kickback_rate` / `active` are internal. (Keeps its
  name across the rename: it's the registry of shops that *host* the packages.)
- **`packages`** — curated packages. Publish lifecycle `status` ∈
  `draft → published → archived`; `published_at` is stamped the first time a
  package goes live (and preserved across re-publishes). `kickback_rate` is the
  rate we expect for this package — **internal, never exposed to divers**.
- **`package_referrals`** — one row per diver-interest; doubles as the lead
  pipeline (`status` ∈ `interested → introduced → booked → completed`, plus
  `cancelled`) and the kickback ledger (`booked_amount`, `kickback_rate`
  snapshot, generated `kickback_amount`, `kickback_status` ∈
  `pending → invoiced → received`).

### Attribution by referral code

Each referral carries a unique `referral_code` (`FD-XXXXXX`, Crockford base32,
no ambiguous I/L/O/U), stamped by the `package_referrals_set_code` **BEFORE
INSERT** trigger — authoritative for every writer, including the express RPC,
so it can never be spoofed or missing. We broker the intro and the code travels
to the partner; when the partner reports "code FD-… booked NT$X," the admin
finds the row by code and records the booking. `kickback_amount` is a generated
column (`round(booked_amount * kickback_rate, 2)`), so the math is in the DB.

A partial unique index (`package_referrals_one_live_idx` on `(package_id,
diver_id) where status <> 'cancelled'`) keeps a diver to one live referral per
package; a cancelled one frees a retry.

## Access model — why the diver-facing reads go through definer functions

Divers must never see the kickback columns, but they do need their own code +
status. So **divers have no RLS policy on any base table** — base tables are
admin-only (`is_admin()` "admin manage" policies). Diver reads are served by two
**SECURITY DEFINER functions** (pinned `search_path`, owned by `postgres`, so
they bypass base RLS) that each expose only safe columns and embed their own
scope:

- **`list_package_board()`** — published packages joined to the partner shop. No
  `kickback_rate`. (`where status = 'published'`.)
- **`list_my_package_referrals()`** — the caller's own referrals with
  package/partner labels, none of the kickback ledger.
  (`where diver_id = auth.uid()`.)

Interest is created only through **`express_package_interest(p_package_id)`** — a
SECURITY DEFINER RPC that validates the package is published, is idempotent
(returns the existing live code rather than erroring on the unique index), and
returns **just the code** so the diver never reads their row's kickback columns.

## Code map

| Concern | File |
| --- | --- |
| Diver reads + express-interest RPC wrapper | `src/lib/packages.ts` |
| Package-date label helper | `src/lib/package-format.ts` |
| Admin shop/package CRUD (+ publish stamp) | `src/lib/package-admin.ts` |
| Admin referral pipeline + kickback rollup | `src/lib/package-referrals.ts` |
| Diver board + detail + "I'm interested" | `src/pages/PackagesPage.tsx`, `src/pages/PackageDetailPage.tsx` |
| Admin home (Packages / Partner shops / Referrals tabs) | `src/pages/admin/AdminPackagesPage.tsx` |
| Referrals pipeline UI | `src/components/admin/AdminReferralsTab.tsx` |

Routes: divers `/packages` + `/packages/:id` (linked from the header plane icon);
admin `/admin/packages` (linked from the Manage hub). The Referrals tab shows
a "N new" badge (count of `interested` referrals) and a per-currency kickback
rollup (received vs outstanding).

## Tests

- `tests/integration/packages.test.ts` — base tables admin-only, the two
  definer functions' scoping + column hiding, `express_package_interest` (auth /
  published / idempotent / writes caller), the one-live-referral index, the
  generated `kickback_amount`, and the admin booking → kickback-received pipeline.
- Unit: `src/lib/packages.test.ts`, `package-admin.test.ts`,
  `package-referrals.test.ts`, `package-format.test.ts`; pages/components have
  render + interaction tests.

## Deferred (not built yet)

- **New-package push to divers** when a package is published, and **new-interest
  push to admins**. The pipeline currently surfaces new interest as an in-app
  badge count; broadcasting reuses the Web Push infra (see
  [push-notifications.md](./push-notifications.md)) but the broadcast policy
  (how often, opt-in) is an open product decision.
- **Partner-facing code-verification portal** — partners report bookings by
  email today; the schema already supports a self-serve portal later with no
  migration.
- **Accounting export integration** — kickback receivables are owed-to-us, not
  diver-ledger transactions, so they stay out of the bookkeeping ZIP for now.
