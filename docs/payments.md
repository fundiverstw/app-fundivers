# Payments and credits

<!--
  docs/payments.pdf is generated from this file. Regenerate it after editing:

    npx marked --gfm -i docs/payments.md -o /tmp/body.html
    cat scripts/doc-print.css.html /tmp/body.html > /tmp/doc.html
    printf '</body></html>' >> /tmp/doc.html
    google-chrome --headless --no-pdf-header-footer \
      --print-to-pdf=docs/payments.pdf file:///tmp/doc.html
-->

How money works in FunDive. Rules the code depends on; the reasoning
behind each one lives in comments at the site that implements it.

**FunDive moves no money.** There is no payment processor. Bank
transfers, cash and card happen off-app and are recorded by hand. Account
credit is the one exception — it is internal, and the only "payment" the
app creates itself.

## Two ledgers

Both append-only. Nothing is ever edited in place: a refund is a new
`payments` row, a discount a new `booking_amendments` row.

| Table | Holds |
| --- | --- |
| `payments` | Money received. `pending` / `paid` / `refunded` / `voided`. |
| `credits` | Money owed back to a diver. `open` or `settled`. |

Alongside them, `bookings.details` carries the `total` and `deposit`
**frozen at booking time**, so later price changes never alter what
someone was quoted.

## What a booking owes

```
owed       = details.total + Σ booking_amendments.amount
paid       = Σ payments: 'paid' adds, 'refunded' subtracts, rest ignored
credit     = Σ open credits tied to THIS booking
balance    = owed − paid − credit
depositDue = max(0, min(details.deposit, owed) − paid)
```

`netPaid()` and `booking_net_paid()` are the only implementations of that
signing rule — every screen and every RPC must use one, or they disagree
about a partly refunded booking.

The deposit is **clamped to `owed`**, because a discount can push the
frozen deposit above the remaining balance. Covering it promotes a
`pending` booking to `confirmed`.

A negative balance is **credit to the diver**, whether it came from an
awarded credit or from simply overpaying. There is no separate
"overpaid" concept.

## Credits

Every credit records a `source`: `manual`, `event_cancellation`,
`booking_cancellation_return`, or `carry_forward`. Only the middle two
mean *this booking's money has been given back*, and only they block a
further automatic refund — a goodwill award tied to the same booking must
not.

**Account credit** — the balance a diver sees — is *open credits not tied
to an active booking, plus every overpayment*. So a credit tied to a
cancelled booking is spendable again, and bookings a lead booker pays for
count toward the lead, not the diver.

## Spending credit

One RPC, `apply_credit_to_booking`, because divers cannot write
`payments` or `credits` directly. A diver may spend against their own
booking, a parent against their child's, an admin against anyone's — and
the credit spent is always the booking owner's.

It clamps to what is owed and what is available, consumes credit
oldest-first, carries any remainder forward as a new `carry_forward` row,
records an offsetting `account_credit` payment, and confirms the booking
if that covers the deposit. It refuses a **cancelled** booking outright:
that trip will never happen, so credit spent there would be destroyed.

## Cancellations

Four of them, and only one returns money by itself.

| What happened | Money returned automatically? |
| --- | --- |
| Shop cancels the event | **Yes** — every registrant gets credit worth their full net paid |
| Refund request approved | No |
| Admin cancels one booking | No |
| Diver cancels their own booking | No |

In the bottom three a trigger does return any **account credit** spent on
the booking — that money never left the app. Cash and transfers did, so
only a person can move them back.

Cancelling an event does **not** cancel its bookings. The credit is what
settles things with the diver. Issuing runs after the cancel commits, so
a failure cannot un-cancel the event.

A diver may self-cancel only a `pending` booking with nothing paid and no
refund request outstanding (`canSelfCancel`). This is a product rule, not
a security boundary — the database lets a diver cancel any of their own
bookings — so it must be applied at **every** diver-facing cancel control.

## Money left on a cancelled booking

A cancelled booking's balance short-circuits to **settled**. That means
*nothing further is owed for this trip*, not *the money has been dealt
with*. Its frozen total is not a debt, and netting it would double-count
any cancellation credit.

So when a diver who paid cash cancels, the shop still holds their money
and no other screen shows it. Exactly two endings are correct — record a
`refunded` payment, or issue a credit — and doing both pays them twice.

`/admin/refunds` lists these under **Cancelled bookings still holding
money**, with a button for each ending. It is the only surface that can
see them: balances read settled, account credit skips cancelled bookings,
and the refund queue lists only non-cancelled ones.

## Reporting

Applied account credit is **not revenue**. The cash arrived earlier, on
the booking that generated the credit; counting it again books the same
money twice. `isExternalPayment()` guards every cash-revenue sum, and
credit spent is reported beside cash, never inside it.

Balance math is the opposite and counts it in full — it really did settle
that booking. Staff revenue is different again: base price × confirmed
heads, deliberately not what has been banked.

## Rules that must not break

1. Never edit money rows in place. New row, always.
2. Sum paid through `netPaid` / `booking_net_paid`. Nowhere else.
3. `owed` is `details.total` **plus amendments**, in TypeScript and SQL.
4. Clamp the deposit to `owed` wherever you compare against it.
5. A booking's own credit is never spendable against that booking.
6. A cancelled booking has no live balance and refuses credit.
7. `diverCreditBalance` is the only definition of account credit.
8. Every automatic credit records its `source`.
9. Cash-revenue sums apply `isExternalPayment`. Balance math does not.
10. Constraints, triggers and RLS policies get integration tests.

## Known gaps

- A confirmation PDF's credit line is a prediction: credit is applied
  after the booking lands, but the PDF renders before that.
- `credits.currency` / `payments.currency` default to `TWD`. Every writer
  names a currency explicitly except a group payment recording the first
  money on a booking. Forks on another currency should change the
  defaults in their own baseline.
- Restoring a cancelled event leaves its credits issued.
- Keeping a cancellation fee has no dedicated action, so the booking
  stays on the holding list.
