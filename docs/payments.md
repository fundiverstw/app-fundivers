# Payments and credits

Everything about money: what a diver owes, what they have paid, what the
shop owes them back, and what happens to each of those when something is
cancelled. This is the single reference for the payment and credit
system — if a rule about money is not written here, it is not a rule.

- [The four sources of truth](#the-four-sources-of-truth)
- [What a booking owes](#what-a-booking-owes)
- [The payments ledger](#the-payments-ledger)
- [Recording, voiding and group payments](#recording-voiding-and-group-payments)
- [The credits ledger](#the-credits-ledger)
- [Account credit: the diver's spendable balance](#account-credit-the-divers-spendable-balance)
- [Spending credit](#spending-credit)
- [Cancellation: what happens to the money](#cancellation-what-happens-to-the-money)
- [Why a cancelled booking reads "settled"](#why-a-cancelled-booking-reads-settled)
- [Reconciliation and reporting](#reconciliation-and-reporting)
- [Payment reminders](#payment-reminders)
- [Known gaps and sharp edges](#known-gaps-and-sharp-edges)
- [Invariants](#invariants)

---

## The four sources of truth

There is no single ledger table. A diver's money position is assembled
from four independent, append-only sources:

| Source | Table | Written by | Means |
| --- | --- | --- | --- |
| **Charge snapshot** | `bookings.details` (`total`, `deposit`, `charges`) | The register form, at booking time. Frozen afterward. | What was quoted. |
| **Adjustments** | `booking_amendments` | Admin, signed rows (`+` surcharge / `−` discount). | What changed after booking. |
| **Money received** | `payments` | Admin, or a SECURITY DEFINER RPC. | What actually arrived. |
| **Money owed back** | `credits` | Admin, or a SECURITY DEFINER RPC / trigger. | What the shop owes the diver. |

Nothing is ever edited in place. A refund is a new `payments` row, not a
mutation of the original. A discount is a new `booking_amendments` row,
not a rewrite of `details.total`. That is what makes the Audits page able
to reconstruct history.

The app **does not move money**. There is no payment processor. Bank
transfers, cash and card payments happen off-app and are recorded by hand.
The one exception is account credit, which is purely internal and is the
only "payment" the app creates itself.

## What a booking owes

```
owed        = details.total + Σ booking_amendments.amount
paid        = Σ payments.amount signed by status (see below)
credit      = Σ open credits.amount tied to THIS booking
balance     = owed − paid − credit          (bookingBalance)
depositDue  = max(0, min(details.deposit, owed) − paid)
```

`bookingBalance(owed, paid, credit)` in `src/lib/booking-balance.ts`
returns one of three states:

- `due` — the diver still owes money.
- `settled` — exactly covered.
- `credit` — net in the diver's favor. This covers **both** an awarded
  credit larger than what is owed **and** a plain overpayment. An
  overpayment is money owed back, so it is credit; there is no separate
  "overpaid" state.

**The deposit is clamped to what is owed** (`depositDue`). `details.deposit`
is frozen at booking time and amendments never touch it, so a discount can
push the frozen deposit above the remaining balance. Without the clamp a
diver who paid their whole discounted total would still see a deposit
demanding the difference — money nobody owed — and their booking would
never auto-confirm. Every promotion/demotion rule uses the clamped figure.

### The card/PayPal surcharge

Credit card and PayPal carry a 5% surcharge; cash and bank transfer pass
through at face value. It is computed in `RegisterForm` and folded into
the `total` / `deposit` snapshots — **not** a separate ledger line, though
it does appear as a `surcharge` line in `details.charges` for display.

The surcharge applies only to the amount actually put on the card *now*:

- **Pay full now** → 5% of the whole subtotal.
- **Pay deposit only** → 5% of the **deposit only**. The remainder is paid
  later, off the card, and carries no surcharge. So
  `total = subtotal + 5% × deposit`, and the stored `deposit` is
  surcharge-inclusive (it is what is charged to secure the spot).

`MultiRegisterForm` always pays in full, so its surcharge is always on the
whole subtotal.

## The payments ledger

`public.payments` — one row per movement of money, never edited.

| Column | Notes |
| --- | --- |
| `user_id` | The diver the money is attributed to. Not necessarily who handed it over (see group payments). |
| `booking_id` | Nullable, `ON DELETE SET NULL` — the ledger outlives the booking. |
| `amount` | Always positive. Direction lives in `status`. |
| `status` | `pending` / `paid` / `refunded` / `voided`. |
| `method` | `bank_transfer` / `cash` / `credit_card` / `paypal` / `account_credit`. |
| `note`, `recorded_by` | Free text and the admin who entered it. |

### Status semantics

| Status | Counts toward `paid`? | Meaning |
| --- | --- | --- |
| `pending` | No | Recorded intent; a transfer not yet confirmed. |
| `paid` | **+amount** | Money received. |
| `refunded` | **−amount** | Money sent back. Its own row; the original `paid` row stays. |
| `voided` | No | "This payment never really happened." Kept for the audit trail. |

`netPaid()` / `netPaidByBooking()` in `src/lib/payments.ts` are the single
implementation of that signing rule, and `public.booking_net_paid(uuid)`
is its SQL twin used by the money RPCs. **Every** surface that renders a
paid figure must go through one of them. When they disagree, a partly
refunded booking looks more paid to the RPC than to the screen, and credit
applications silently under-apply with no error to explain it.

`booking_net_paid` is SECURITY DEFINER with no ownership check and is
deliberately revoked from `public`/`anon`/`authenticated` — only the
SECURITY DEFINER RPCs that do their own authorization call it.

### Who may write

RLS: **admins only** insert or update `payments`. Divers may `SELECT`
their own; parents may select their children's; staff may select all.
A diver therefore cannot create a payment row directly — the only path
for a diver to affect the ledger is `apply_credit_to_booking`.

## Recording, voiding and group payments

`recordPayment()` (`src/lib/booking-payments.ts`) inserts one `paid` row,
stamping `method` from `details.payment_method`, and then applies the
**promotion rule**:

> A `pending` booking becomes `confirmed` as soon as the deposit is
> covered — `depositCovered(deposit, owed, paid)`.

`voidPayment()` is the exact mirror: it flips a row to `voided` and, if
that drops paid back below the deposit threshold **and** the booking is
currently `confirmed`, demotes it to `pending`. Bookings an admin
confirmed by hand for unrelated reasons are not demoted — only the
auto-promotion is undone.

Both take an optional `owed` (the amended balance). Without it they fall
back to the raw frozen total and are blind to amendments; callers that
have the amendment rows should always pass it.

`apply_credit_to_booking` and `record_group_payment` reimplement the same
promotion rule in SQL. All three must stay in step.

### Group payments (lead booker)

When a parent registers a family group they can be the single payer. Every
booking in the group is stamped `bookings.payer_id = the lead`.

- `payer_id` is **per booking** on purpose, so an admin can revert one
  diver to paying their own way ("Bill to this diver instead" clears it).
  A `BEFORE` trigger restricts `payer_id` to the diver themselves or their
  `parent_account`, and is authoritative even under the service role.
- The lead's Payments page rolls siblings up by `group_id` into one
  combined owed/paid/balance. A covered diver sees "Covered by [lead]"
  with no balance and no refund or apply-credit controls.
- `record_group_payment(p_lead, p_amount, p_group_id)` (admin-only,
  SECURITY DEFINER) distributes one lump across the group's non-cancelled
  bookings: **deposits first** so every spot confirms, then balances,
  oldest first. It inserts one ordinary `payments` row per touched booking
  (note `Group payment`), so every balance calculation elsewhere is
  unchanged — "group paid" is just their sum.
- It nets each booking's own open credit out before collecting cash, for
  the same reason `apply_credit_to_booking` does: that credit already
  offsets the balance on screen, so charging cash against it too would
  collect the money twice.
- Reverting a diver later does not move already-recorded payments. The
  money was applied to that diver's event.

## The credits ledger

`public.credits` — money the shop owes a diver. The opposite direction
from `payments`, and the mirror-image table.

| Column | Notes |
| --- | --- |
| `user_id` | Whose credit it is. |
| `booking_id` | Nullable, `ON DELETE SET NULL`. Set → the credit offsets *that* booking's balance. Null → general account credit. |
| `amount` | `CHECK (amount > 0)`. |
| `currency` | Defaults to `TWD` at the DB level; `createCredit()` passes `siteConfig.locale.currency`. |
| `status` | `open` or `settled`. Nothing else. |
| `reason` | Why it exists. Shown to the diver and in the audit feed. |
| `settled_at`, `settled_note` | Stamped when it is consumed or paid out. |

**`open`** means spendable and still owed. **`settled`** means resolved —
either paid back out of band or spent on a booking. Settling a credit does
**not** create a payment row: the two sides are recorded as separate
explicit actions so the audit trail shows both. (`apply_credit_to_booking`
is the exception; it does both halves in one transaction, which is what
makes it safe.)

Admins can issue, settle and reopen credits from the credits panel on
`AdminUsersPage`. RLS: admins write; divers read their own; parents read
their children's; staff read all.

### Where credits come from

1. **Event cancellation** — `issueCancellationCredits()`, automatic.
2. **Booking cancellation returning spent credit** — the
   `bookings_return_account_credit_on_cancel` trigger, automatic.
3. **Carry-forward** — the unspent remainder of a credit row that only
   partly covered an application (see [Spending credit](#spending-credit)).
4. **By hand** — an admin issues one for any reason on the Users page.

## Account credit: the diver's spendable balance

The figure on the Profile page and at the top of the Payments page is
**not** simply the sum of open credit rows. `diverCreditBalance()`
(`src/lib/credits.ts`) is:

```
account credit
  = Σ open credits NOT tied to one of the diver's active bookings
  + Σ over each active booking: max(0, paid + openCreditForBooking − owed)
```

In words: **general credit, plus every overpayment.** Two consequences
worth internalizing:

- A credit tied to a **cancelled** booking counts as general credit,
  because cancelled bookings are excluded from the active set. That is how
  a cancellation credit lands back in the spendable pool.
- Paying more than a booking owes is credit. There is no separate
  overpayment concept anywhere in the app.

**Lead-payer exclusion.** Bookings someone else pays for (`payer_id` set to
another person) are dropped from *both* terms. Money recorded under a
child's `user_id` by a group payment belongs to the lead, not the child,
so a child's overpayment must not appear as the child's credit.

Every surface computes this identically — `ProfilePage`
(`fetchDiverCreditBalance`), `PaymentsPage`, `AdminUsersPage`, and
`assembleDiverAuditTrail`. If you add a fourth, use `diverCreditBalance`.

### Spendable pool vs account credit

These are different numbers and the distinction matters:

- **Account credit** (above) includes overpayments, which have no credit
  row to consume.
- **Spendable pool** = `openCreditBalance(credits)` — only actual open
  credit rows, because `apply_credit_to_booking` consumes rows.

An overpayment therefore shows in the diver's account credit but cannot be
applied to another booking by the RPC. Moving it takes an admin: void or
refund the overpayment on the source booking, then issue a credit.

## Spending credit

One RPC does all of it: **`apply_credit_to_booking(p_booking_id, p_amount)`**,
SECURITY DEFINER, because divers cannot write `credits` or `payments`
under RLS. Callers: the per-booking control on `PaymentsPage`, the
registrant card on `AdminEventDetailPage`, the credits panel on
`AdminUsersPage`, and the register form at checkout.

**Who may call it for whom**

| Caller | Allowed against |
| --- | --- |
| The diver | Their own booking |
| A parent (`profiles.parent_account = caller`) | Their child's booking |
| An admin | Anyone's booking |

The credit spent is always the **booking owner's**, never the caller's.
A parent paying for a child spends the child's credit.

**What it does, in one transaction**

1. Refuses a **cancelled** booking outright. A cancelled booking still
   carries a positive frozen `details.total`, so without this guard the
   RPC would compute a fake "balance due" and burn spendable credit into a
   dive that will never happen. The UIs already hide cancelled bookings
   from apply-credit surfaces, but the guard lives in the RPC because that
   is the only place authoritative for every caller (including a stale
   client acting on a booking cancelled after the page loaded).
2. Computes `due = owed − netPaid − credit already tied to this booking`.
   Self-credit is excluded because it already offsets this booking's
   balance on screen; counting it as spendable would double-spend it.
3. Computes the available pool: the diver's open credit **excluding**
   rows tied to this booking.
4. Applies `least(requested, due, available)`. Returns that figure — `0`
   when there is nothing to do. Never raises for "not enough credit".
5. Consumes open rows **oldest first**. A row fully covered is settled.
   The row straddling the boundary is settled in full and its unspent
   remainder is inserted as a **fresh open row** carrying the original
   reason and `booking_id`.
6. Inserts one `payments` row: `method='account_credit'`, `status='paid'`,
   note `Applied account credit`.
7. Promotes a `pending` booking to `confirmed` if the deposit (clamped to
   owed) is now covered.

Callers must refetch afterward — the RPC touches credits, payments and
possibly the booking status.

### Applying credit at registration

The register form offers "apply my credit" (default on) for each diver
whose credit the submit can reach — the primary target plus any family
picks. It calls the same RPC **after** the booking lands, best-effort: the
booking has already succeeded, so a credit hiccup must not fail
registration. `details.credit_applied` snapshots the figure for the
confirmation PDF.

The form only offers a target's credit if it can *read* that target's
credit rows, and the RPC authorizes the spend independently, so the offer
cannot be used to reach someone else's balance.

## Cancellation: what happens to the money

This is the part that trips people up. **There are four different
cancellations and they do not do the same thing to money.**

| # | What happened | Who does it | Booking rows | Money effect |
| --- | --- | --- | --- | --- |
| 1 | **Shop cancels the event** | Admin, event detail page | Bookings stay as they are; the *event* gets `cancelled_at` | **Automatic.** Every non-cancelled registrant gets an open credit worth their full net paid. |
| 2 | **Diver requests a refund, admin approves** | Diver asks, admin approves on the Refunds page or the registrant card | Booking → `cancelled` | **Manual.** Approval only cancels the booking. The refund itself moves off-app; the admin must record a `refunded` payment row. |
| 3 | **Admin cancels one booking** | Admin, registrant card | Booking → `cancelled` | **Manual**, same as #2. |
| 4 | **Diver cancels their own booking** | Diver, Bookings or Calendar page | Booking → `cancelled` | **Manual**, same as #2. |

In **all four**, the `bookings_return_account_credit_on_cancel` trigger
additionally returns any **account credit** that was spent on the booking
(cases 2–4, where the booking row itself flips to `cancelled`).

### 1. Shop cancels the event

`cancelEventAndFollowUp()` (`src/lib/event-cancellation.ts`), used by both
the single-event cancel and "cancel the rest of this series" so the two
cannot drift:

1. Stamp `events.cancelled_at`.
2. Notify every non-cancelled registrant — push, in-app inbox, email.
   Fire-and-forget; a notification failure must never block a
   cancellation that already committed.
3. `issueCancellationCredits()` — for each **non-cancelled** booking on
   the event, insert an open credit worth that booking's **net paid**
   (`paid − refunded`), with a reason naming the event and its date
   formatted in the shop timezone.

Notes:

- Bookings with nothing paid get no credit.
- **Idempotent per booking**: a booking that already carries *any* credit
  row is skipped, so cancel → restore → cancel never double-issues.
- Restoring an event deliberately leaves issued credits alone. An admin
  reopens or settles them by hand on the Users page.
- Crediting runs **after** the cancel has committed, so a failure cannot
  un-cancel the event. The admin gets a toast telling them to issue the
  credits manually.
- The bookings are **not** marked cancelled. They stay `pending` /
  `confirmed` against a cancelled event, and the credit is what makes the
  diver whole.

### 2–4. A booking is cancelled

The only automatic money movement is the trigger
`bookings_return_account_credit_on_cancel` (AFTER UPDATE OF status,
`* → 'cancelled'`):

- It sums payments on the booking with `method = 'account_credit'`, netting
  `paid` against `refunded` so a manual reversal is not double-counted.
- If that is positive **and** the booking carries no credit row yet, it
  inserts a fresh **open** credit tied to the booking, reason
  `Account credit returned for cancelled booking: <event>`.
- Because `diverCreditBalance` treats a credit on a cancelled booking as
  general credit, the money lands straight back in the spendable pool.

**Off-app methods are deliberately not handled.** Bank transfer, cash and
card money moved outside the app, so only a human can move it back. The
app records that with a `refunded` payment row once the transfer is made.

**Consequence — and the thing most likely to confuse an admin:**

> When a diver who paid by bank transfer or cash cancels, **nothing
> happens to their money automatically.** No credit appears. The booking
> shows a settled balance. The paid amount sits on a cancelled booking
> and the shop still holds it.

Resolving it is an explicit admin decision, and there are exactly two
correct endings:

- **Give the money back** → record a `refunded` payment row on that
  booking for the amount returned (Users page or registrant card). Net
  paid goes to zero; the books balance.
- **Keep it as store credit** → issue a credit for the amount on the
  Users page, with a reason naming the cancelled booking. It becomes
  spendable account credit.

Doing neither leaves the money invisible on every screen. Doing **both**
pays the diver twice.

### The refund request flow

1. Diver presses **Request refund** on the Bookings or Payments page. This
   only stamps `bookings.refund_requested_at`.
2. The request appears on `/admin/refunds` (a cross-event queue) and as a
   banner on the registrant card.
3. **Approve** → booking → `cancelled`, diver notified. Money moves
   off-app; record the `refunded` row afterward. Approving drops it off
   the queue because the queue lists only non-cancelled bookings.
4. **Reject** → clears `refund_requested_at`, leaving the booking
   untouched, so an accidental request is fully undone and the diver can
   ask again.

A diver may only self-cancel a booking that is `pending` with nothing
paid; once money is on it, the Bookings page offers **Request refund**
instead. The database backs this with `bookings_guard_diver_status`, which
allows a diver to move their own booking only to `cancelled` (never to
`confirmed`, and never onto a different event).

### Cancellation policies

`cancellation_policies` rows are **text the diver acknowledges at
registration**, attached per event via `events.cancel_policy`. They are
informational: nothing in the code computes a forfeiture, a fee or a
partial refund from them. Whatever the policy says, an admin enacts by
hand with a `refunded` row (full or partial) and/or a credit.

## Why a cancelled booking reads "settled"

`bookingBalance(owed, paid, credit, { cancelled: true })` short-circuits
to `{ net: 0, amount: 0, state: 'settled' }`.

This is deliberate. A cancelled booking keeps its frozen `details.total`,
so netting it normally would show the diver still "owing" the unpaid rest
of an event that will not happen — and, where a cancellation credit exists,
would count the refund twice (once as the credit, once as the paid money
that credit represents).

**"Settled" on a cancelled booking means "nothing further is owed on this
event", not "the money has been dealt with."** Pass `cancelled` at every
site that renders a cancelled booking's balance. Most surfaces exclude
cancelled bookings from balance sums entirely.

The diver's Payments page keeps cancelled bookings in their own read-only
section rather than hiding them, so the payment history — what was paid,
what came back, what credit was returned — stays visible instead of
looking like the money vanished.

## Reconciliation and reporting

| Surface | What it shows | Netting rule |
| --- | --- | --- |
| `/admin/audits` | Per-diver, per-registration merged feed of every payment, credit, amendment and field change, oldest first | Reconciles each registration with the same `bookingBalance()` as the app, so it can never silently disagree. Its `totals` block is deliberately **gross** (paid and refunded listed separately). |
| `/admin/accounting` export | Audit-style CSVs: every payment row regardless of status, each labeled | `paid` positive, `refunded` negative, `voided` shown but excluded from sums. |
| `/admin/dashboard` | Revenue by month/method/event type/nationality/cert level | Same signed rule (`netOf`). |
| Revenue by staff | Base price × confirmed heads | Deliberately **not** `netPaid` — it counts what the work was worth, not what has been banked, and reads only the `base` line of `details.charges`. See [admin.md](./admin.md#revenue-by-staff). |

**Account-credit rows are included in cash-revenue aggregations.** An
`account_credit` payment is an internal transfer, not money arriving, so a
credit that originated from real cash is counted a second time when it is
spent. `revenueByMethod` breaks `account_credit` out as its own line, so
the amount to subtract is visible; the headline revenue figures do not
subtract it. Keep this in mind before quoting a revenue number.

## Payment reminders

The push cron (`selectReminders()` in `src/lib/push-reminders.ts`) fires
at 21, 14, 7, 3 and 1 days before the event, using exactly the rules
above:

- Skips cancelled bookings.
- `balanceDue = max(0, total − netPaid − credit on this booking)`.
- `depositDue > 0` → send the **deposit** message.
- `depositDue == 0 && balanceDue > 0` → send the **balance** message.
- `balanceDue == 0` → send nothing.

The PWA encodes the same rule in `PaymentsPage` and `BookingsPage`. See
[push-notifications.md](./push-notifications.md).

## Known gaps and sharp edges

Documented so nobody rediscovers them as bugs:

1. **No reconciliation surface for money on a cancelled booking.** A
   booking cancelled with net paid > 0, no refund row and no credit is
   invisible everywhere: it is excluded from balance sums, from account
   credit, and from the refunds queue (which lists only non-cancelled
   bookings). Nothing prompts the admin to resolve it. Today the only way
   to find one is the Audits page or the accounting export.

2. **The Calendar page's cancel button is unguarded.** The Bookings page
   correctly offers cancel only for a `pending` booking with nothing paid.
   The Calendar page's event modal offers a one-tap "Cancel booking" for
   any booked event, does not load payments, and has no confirmation step.
   A diver who has paid can cancel from there, landing straight in gap 1.

3. **Cancellation-credit idempotency is coarse.** Both
   `issueCancellationCredits` and the return-on-cancel trigger skip a
   booking that carries *any* credit row, whatever its amount, reason or
   status. A booking with a small unrelated goodwill credit gets no
   cancellation credit at all for the rest of what was paid.

4. **Account credit double-counts in revenue.** See
   [Reconciliation](#reconciliation-and-reporting).

5. **`issueCancellationCredits` does not set `currency`.** Rows fall back
   to the `credits.currency` DB default of `TWD`, while `createCredit()`
   uses `siteConfig.locale.currency`. A shop on another currency ends up
   with a mixed-currency credits table.

6. **The Payments page's "use my credit" button can overstate.** Its label
   is `min(openCreditBalance, totalOwed)`, but `totalOwed` includes
   group bookings the one-tap apply skips, and `openCreditBalance`
   includes credit tied to a booking the RPC will refuse to re-spend on
   itself. The RPC clamps correctly, so the applied amount is right; only
   the promise on the button can be too large.

7. **Credit applied at registration is best-effort.** If the RPC call
   after the booking insert fails, `details.credit_applied` still claims
   the credit was applied and the confirmation PDF shows the after-credit
   balance, while the credit is in fact still open. The failure is only
   logged to the console.

8. **The 5% card/PayPal surcharge is hardcoded.** It sits as a literal
   `0.05` in `RegisterForm`, unlike the other shop-specific money values
   (`business.nitroxCourseFee`, `business.paymentDeadlineFallbackDays`)
   which come from `fundive.config.ts`. A shop whose processor charges a
   different rate has to edit code.

## Invariants

Anything you add to this system has to keep all of these true.

1. **Never edit money rows in place.** New row, always.
2. **Sum paid through `netPaid` / `netPaidByBooking` / `booking_net_paid`.**
   Nowhere else.
3. **`owed` is `details.total` plus amendments.** Never the raw total
   alone, in TypeScript or SQL.
4. **Clamp the deposit to `owed`** wherever you compare against it,
   including the auto-confirm rule.
5. **The three promotion rules stay identical** — `recordPayment`,
   `apply_credit_to_booking`, `record_group_payment` — and `voidPayment`
   mirrors them.
6. **Credit tied to a booking is never spendable against that same
   booking.** It already offsets it.
7. **A cancelled booking has no live balance** and refuses credit.
8. **`diverCreditBalance` is the only definition of account credit,**
   and it always excludes lead-covered bookings.
9. **Guards belong in the RPC or trigger, not only in the UI.** The
   SECURITY DEFINER functions are the sole path a diver can move money,
   and a stale client is a real caller.
10. **Every constraint, trigger and RLS policy here gets an integration
    test** against the live local stack — see `tests/integration/`
    (`credits`, `apply-credit-to-booking`, `balance-consistency`,
    `return-account-credit-on-cancel`, `guard-diver-booking-status`,
    `lead-payer`) and `tests/scenario/event-cancellation.test.ts`.
