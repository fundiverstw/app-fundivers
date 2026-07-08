# Packages — partner-shop registration network

A board of dive **packages hosted by partner shops abroad** that FunDivers
vouches for. A diver browses a product, picks a price **tier**, a **preferred
date range** and **add-ons / a room** from our catalog, and **registers**. That
sends a recommendation email — from our shop — to the **partner shop** and the
**diver**, carrying a **cost estimate**. When the diver books at the partner, the
partner pays us a kickback (default 5%). This is a referral network, not a
booking system — the booking and the money happen at the partner shop. The app:

1. **curates** partner shops + their products/tiers (admin),
2. **exposes** published products to divers (the board + register flow), and
3. **tracks** who registered + the kickback we expect vs have been paid.

It's the *push* complement to **Trusted Partners** (`TrustedPartnersPage`), the
*pull* side — a diver names a destination and we email them a vetted shop.

> Sibling feature: **Scheduled Trips** (`ScheduledTripsPage` / `scheduled_trips`)
> are the shop's own dated trips. They share this exact registration flow (the
> generalized `RegisterWizard` + `registration-estimate` + the `listing-ui` admin
> bits) but are single-price, fixed-date, and email the shop (no partner/kickback).
> Packages are the partner-shop, tiered, diver-picks-dates variant.

## Model (`20260708200000_packages_registration.sql`)

This migration replaced the old FD-XXXXXX referral-code system (dropped: the
`referral_code` column, its `package_referrals_set_code`/`gen_referral_code`
trigger, and the `express_package_interest` RPC).

- **`trusted_partners`** — the vouching registry (shared with Trusted Partners).
  `contact_email` / `default_kickback_rate` are internal; the diver-facing
  projection hides them.
- **`packages`** — the parent **product**. Diver-facing: `title`, `destination`,
  `summary`, `description`, `hero_image_url`, `highlights`. References our catalog
  via `addon_ids[]` / `room_type_ids[]` (same catalog the event register form
  uses — `addons` / `rooms`). Internal: `kickback_rate` (the "percent set when
  making the package", never exposed to divers), `status` (`draft → published →
  archived`, `published_at` stamped on first publish). **No dates or single
  price** — dates are diver-picked, price lives on tiers.
- **`package_tiers`** — Package A/B/C: `name`, `price`, `currency`, `sort_order`.
  One product has many tiers.
- **`package_registrations`** — one row per diver-registration; doubles as the
  kickback ledger. Carries `tier_id`, `preferred_start`/`preferred_end`, a frozen
  `details` snapshot (chosen tier, per-day add-on lines, per-night room line, the
  `charges` ChargeLine[] and estimate total), `estimated_cost` /
  `estimated_currency`, `notes` (diver free-text), `status`
  (`registered → completed`, or `cancelled`), and the kickback columns:
  `kickback_rate` (snapshot), generated `kickback_amount`
  (`round(estimated_cost * kickback_rate, 2)`), `kickback_status`
  (`expected → paid`, `paid_at`). A partial unique index
  (`package_registrations_one_live_idx` on `(package_id, diver_id) where status
  <> 'cancelled'`) keeps a diver to one live registration per product; a cancel
  frees a retry.

## Cost estimate

`src/lib/package-estimate.ts` — the estimate is **non-binding**; the final cost
is set by the partner shop. From the diver's preferred range: `nights` = the
span, `days` = `nights + 1`. `buildPackageCharges()` produces `ChargeLine[]`
(reusing the bookings `ChargeLine` shape): the tier base, each **add-on × days**,
and the **room × nights**. The client uses it for the live preview; the edge
function recomputes it authoritatively. The two copies (client
`src/lib/package-estimate.ts` and Deno
`supabase/functions/_shared/package-estimate.ts`) are duplicated because the Vite
bundle and Deno can't share a module cleanly — `package-estimate.test.ts`
asserts they stay in sync.

## Registration + email (`supabase/functions/register-package/`)

Registration is **logged-in app users only** and goes through the
`register-package` edge function (mirrors `create-registration`'s split:
`index.ts` Deno glue + pure `_shared` helpers). It:

1. verifies the Bearer JWT (no guest path),
2. validates the product is published and the tier / add-ons / room belong to it,
3. **recomputes the estimate server-side** (never trusts a client total — the
   kickback is keyed on it),
4. snapshots the `kickback_rate` and inserts one `package_registrations` row
   (service role). The one-live index makes a double-tap idempotent (returns the
   existing row), and
5. emails the partner shop (**from** us, **cc** us, **reply-to** the diver) and
   the diver, via `buildPackageRegistrationEmail` — the recommendation greeting
   plus the selected items, the estimate, and the "final cost is set by the
   partner shop" disclaimer. Email is best-effort; a mail failure never loses the
   registration.

## Access model — diver-facing reads go through definer functions

Divers must never see the kickback columns, so **base tables are admin-only**
(`is_admin()` "admin manage" policies) and diver reads go through **SECURITY
DEFINER functions** (pinned `search_path`, owned by `postgres`):

- **`list_package_board()`** — published products whose partner is **active**,
  joined to the partner, plus `min_price`, `tier_count` and the catalog id
  arrays. No `kickback_rate`.
- **`list_package_tiers(p_package_id)`** — a published product's tiers.
- **`list_my_package_registrations()`** — the caller's own rows (`diver_id =
  auth.uid()`) with labels + estimate, none of the kickback ledger.
- **`cancel_my_package_registration(p_id)`** — a diver cancels their own row
  (base table is admin-only), freeing the one-live index for a retry.

## Code map

| Concern | File |
| --- | --- |
| Diver reads + register / cancel wrappers | `src/lib/packages.ts` |
| Estimate math (client) | `src/lib/package-estimate.ts` |
| Preferred-range date label | `src/lib/package-format.ts` |
| Admin product + tier CRUD | `src/lib/package-admin.ts` |
| Admin registrations + kickback rollup | `src/lib/package-registrations.ts` |
| Diver board + detail | `src/pages/PackagesPage.tsx`, `src/pages/PackageDetailPage.tsx` |
| Diver register wizard | `src/components/register/PackageRegisterForm.tsx` |
| Admin home (Packages / Registrations tabs) | `src/pages/admin/AdminPackagesPage.tsx` |
| Registrations roster + kickback tally | `src/components/admin/AdminRegistrationsTab.tsx` |
| Register + email edge fn | `supabase/functions/register-package/` + `_shared/package-*.ts` |

Routes: divers `/packages` + `/packages/:id`; admin `/admin/packages` (from the
Manage hub). The Registrations tab is the "who registered" roster (the Manage
tracking surface) and shows a running **expected vs paid** kickback tally per
currency, with a per-registration "Mark kickback paid" action.

## Tests

- `tests/integration/packages.test.ts` — base tables admin-only; the definer
  functions' scoping + column hiding (incl. `min_price`/`tier_count`); the
  one-live index; diver-owned cancel; the generated `kickback_amount`.
- Unit: `src/lib/packages.test.ts`, `package-admin.test.ts` (tier reconciliation),
  `package-registrations.test.ts` (expected/paid rollup), `package-estimate.test.ts`
  (day/night multipliers + client/server parity), `package-format.test.ts`,
  `supabase/functions/_shared/package-registration-email.test.ts` (parse + email);
  pages/components have render + interaction tests.

## Deferred (not built yet)

- **Push on new registration** (reuse Web Push infra) — the tab surfaces new
  registrations as a badge count today.
- The greeting's "Other notes" vs "Diver notes" — implemented as a single
  diver-notes field; can split into an admin/internal note later.
- **Accounting export** — kickback receivables stay out of the bookkeeping ZIP.
