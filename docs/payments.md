# Payments

## Core model

Money flows are tracked by two things:

1. **Snapshot on the booking** — when the diver submits
   `RegisterForm`, the final `total` and the `deposit` amount are
   written into `bookings.details`. These values **do not change**
   after booking, so later price tweaks don't retroactively alter what
   was owed.

2. **Ledger of payments** — `public.payments` rows are
   **staff-inserted** records of actual money received. A booking can
   have many payment rows (typically: one deposit payment, then one
   balance payment closer to the event).

Derived quantities used by the UI:

```
paid        = Σ payments.amount where status = 'paid'
depositDue  = max(0, booking.details.deposit − paid)
balanceDue  = max(0, booking.details.total   − paid)
```

All computation lives client-side in
`src/pages/PaymentsPage.tsx` (`refetch()` → `paymentsByBooking`).

### Card / PayPal surcharge

Credit card and PayPal carry a 5% surcharge (bank transfer / cash pass
through at face value). It's computed in `RegisterForm` and folded into
the `total` / `deposit` snapshots — it is **not** a separate ledger line.
The surcharge applies only to the amount actually put on the card *now*:

- **Pay full now** → 5% of the whole subtotal.
- **Pay deposit only** → 5% of the **deposit only**; the remainder (paid
  later, off the card) carries no surcharge. So `total = subtotal + 5% ×
  deposit` and the stored `deposit` is surcharge-inclusive (what's charged
  to secure the spot).

`MultiRegisterForm` always pays in full, so its surcharge is always on the
whole subtotal.

## Payment row semantics

`payments.status` is one of:

| Status | Meaning |
| --- | --- |
| `pending` | Recorded intent / bank transfer not yet confirmed. Does **not** count toward `paid`. |
| `paid` | Money received. Counts toward `paid`. |
| `refunded` | Reversed. Does **not** count toward `paid`. |

`payments.booking_id` is nullable (ON DELETE SET NULL) because the
ledger should survive a booking being cancelled.

## Deposit vs balance messaging

Both the PWA and the push cron use the same rule for which message to
surface, driven by the diver's current paid amount:

- `depositDue > 0` → this is a **deposit** reminder.
- `depositDue == 0 && balanceDue > 0` → this is a **balance**
  reminder.
- `balanceDue == 0` → no reminder.

The push cron encodes this in `selectReminders()` in
`src/lib/push-reminders.ts`. The UI encodes it in
`PaymentsPage.tsx` / `BookingsPage.tsx`.

## Refund flow

1. Diver presses **Request refund** on a booking (either page).
2. App sets `bookings.refund_requested_at = now()`.
3. Admin sees the flag in the event-detail registrant card and either:
   - **Approves** → sets `bookings.status = 'cancelled'` and
     (out-of-band) wires the money back via bank transfer, then records
     a `payments` row with `status = 'refunded'`.
   - **Declines** → clears `refund_requested_at` back to null (there's
     currently no UI for this — clear it manually via Supabase Studio
     if needed).

The app **does not move money itself** — there is no payment processor
wired up. Payments are bank transfers and cash, tracked by hand in the
ledger.

## Credits

`public.credits` tracks money the business owes a diver (the opposite
direction from `payments`). A credit is `open` until it's settled — by
paying the diver back out of band, or by spending it on a booking (see
"Applying credit" below). `openCreditBalance()` is the diver's spendable
balance, surfaced on `ProfilePage` and `PaymentsPage`.

### Applying credit to a booking

Divers can spend their open account credit toward an unpaid booking
themselves (per-booking control on `PaymentsPage`); admins can do it for
any diver from the registrant card on `AdminEventDetailPage` or the
credits panel on `AdminUsersPage`. All three go through one SECURITY
DEFINER RPC, `apply_credit_to_booking(p_booking_id, p_amount)`
(migration `20260620000000`), because divers can't write `credits` or
`payments` under RLS — the RPC is the only path.

The RPC clamps the request to `min(requested, balance due, spendable
pool)` and, in one transaction: consumes open credit rows oldest-first
(settling each; the row that straddles the boundary is settled in full
and its unspent part **carried forward** as a fresh `open` credit),
inserts an offsetting `payments` row with `method='account_credit'` and
`status='paid'`, and confirms a pending booking once the deposit is
covered (same rule as `recordPayment`). Credit already tied to the
target booking is *not* spent — it already offsets that booking's
balance, so the spendable pool excludes it. Returns the amount actually
applied. See `applyCreditToBooking()` in `src/lib/credits.ts`.

### Auto-credit on event cancellation

When an admin cancels an event from the event-detail page
(`AdminEventDetailPage.setCancelledAt`), `issueCancellationCredits()`
issues each non-cancelled registrant an `open` credit worth what they've
actually paid (Σ `payments` where `status='paid'`), with a `reason`
naming the cancelled event. Bookings with nothing paid get no credit.

It's idempotent per booking: a booking that already carries any credit is
skipped, so cancel → restore → cancel never double-issues. Restoring an
event intentionally leaves issued credits untouched — an admin reopens or
settles them by hand on the Users page. Crediting runs after the cancel
has committed, so a failure can't un-cancel the event; the admin gets a
toast telling them to issue the credits manually instead.

## Summary cards

`PaymentsPage` shows three summary cards at the top:

- **Deposits due** — Σ `depositDue` across non-cancelled bookings
- **Balance due** — Σ `balanceDue` across non-cancelled bookings
- **Total paid** — Σ `paid` across non-cancelled bookings

Note that *balance-due already includes the unpaid deposit*. That's
intentional: the balance is "what still needs to be received for this
event in total." Don't sum deposits + balance to get "total owed" —
you'd double-count.

## Related reminders

See [push-notifications.md](./push-notifications.md). The cron fires
payment reminders on a 21/14/7/3/1-day cadence, skipping bookings where
`balanceDue == 0`.
