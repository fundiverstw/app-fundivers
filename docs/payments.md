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

Every row names the session that wrote it — `recorded_by`, `created_by`,
`settled_by`, `cancelled_by` — and the accounting views resolve those to
names, so a disputed figure traces to a person rather than to "the app".
The trigger-stamped ones (`settled_by`, `cancelled_at`, `cancelled_by`)
are derived from the transition and ignore whatever a caller sends, so
none can be forged or backdated.

Alongside them, `bookings.details` carries the `total` and `deposit`
**frozen at booking time**, so later price changes never alter what
someone was quoted.

## Every payment names a transaction

A row that moved real money carries a `reference`: a receipt number, a
bank transfer id, a PayPal or other online transaction id. Without one,
"Paid 3,600" is a claim nobody can check against a bank statement, and a
diver holding a receipt has nothing to match it to.

`payments_reference_required` enforces it. Three kinds of row are exempt
for the same reason — there is no external transaction to point at:
`account_credit` (moves no money; the cash arrived earlier), `pending` (a
promise, not a receipt), and `voided` (an admin taking back a mistake).

The constraint is `NOT VALID`: payments predating it keep an honest blank
rather than a back-dated fiction, and every write from here on is checked.
Divers see the reference on their own payment list — their half of the
receipt.

**"Mark deposit paid" records no payment at all** — it confirms a spot and
moves no figure — so it has nothing to reference; the audit log still
names who pressed it.

## Payment methods

How a diver can pay is shop data, not a code enum. Each row in
`payment_methods` carries a stable `key` — the value written to
`bookings.details.payment_method`, never reused for a different method —
plus everything the diver is shown: the `label`, an optional one-line
`blurb`, the transfer details (`bank_name`, `bank_branch`, `bank_code`,
`account_number`, `account_holder`, `swift_bic`), a `pay_url` for online
payment, free-form `notes`, and `sort_order` / `active` for what appears
on the register form and in what order.

Admins edit them at **Manage → Payment methods**
(`/admin/payment-methods`). The bank fields are structured columns rather
than one free-text blob so the app can label them in the deployment's
language; only the values are shop-authored, and those are never
translated.

Two flags change how a method behaves rather than how it reads:

| Flag | Effect |
| --- | --- |
| `collects_invoice_email` | The register form asks where to send the invoice, and the "How to pay" block echoes that address back |
| `shows_shop_contact`     | Appends the shop's phone / address / map from `fundive.config.ts`, so paying in person needs no duplicated contact details |

**The surcharge is per-method.** `surcharge_percent` is what the diver is
both shown and billed — it replaced a single shop-wide
`business.cardSurchargePercent` that applied to a hardcoded card/PayPal
pair. A shop can now charge 3% on cards, nothing on a domestic transfer,
and whatever it likes on a method it invented.

The client previews the surcharge, but `create-registration` recomputes it
from the row it reads server-side, so a crafted request cannot nominate a
cheaper rate than the shop published (see
[§ What a booking owes](#what-a-booking-owes)).

One renderer builds the "How to pay" block for both the register form and
the emailed PDF: `paymentMethodInstructions()` in
`src/lib/payment-method-format.ts`, which is import-free so the Deno edge
functions share it. The two thin bindings that inject the catalog and the
shop contact are `src/lib/payment-instructions.ts` and
`supabase/functions/_shared/payment-instructions.ts`; a parity test pins
them together. Blank transfer rows are omitted, and a transfer method with
nothing published yet says details are coming rather than showing a diver
an empty account.

Deleting a method is the one destructive edit: bookings keep the key they
recorded, but their "How to pay" details stop resolving — the PDF then
omits the block and no surcharge is recomputed. Untick **Active** instead
to retire a method while keeping old bookings whole.

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

## Credits, charges and refunds

`credits` is a **signed** account ledger. A positive row is a credit — money
the shop owes the diver. A negative row is one of the two ways that debt ends
without the diver booking anything: a charge (`source = 'admin_charge'`) —
money the diver owes the shop for something with no event behind it, a mask
off the rack or a lost fin — or a refund (`source = 'admin_refund'`) — credit
the shop has handed back in cash or by transfer. One table, because every
balance in the app is already `sum(amount) where status = 'open'`, so a signed
row nets itself into all of them at once.

**A charge and a refund are the same arithmetic and opposite stories.** Both
write the same negative untied row, and they stay separate sources because
`buildDiverStatement` is where the difference has to survive: a payout the
shop made must not read as goods the diver bought. Admins reach them from the
same place — Balance → *Issue charge* / *Issue refund* on a diver's card —
and both require a reason. A refund names how the money went back ("bank
transfer #4821"); the form warns, and does not refuse, when the amount exceeds
the credit the diver holds.

Only credit with **no booking behind it** is refunded this way. A cancelled
booking's money goes back as a `refunded` payment row against that booking
(the refunds page), which keeps it netted out of that event's take.

Two constraints keep the sign honest: only `admin_charge` and `admin_refund`
may be negative and they must be, and neither is ever tied to a booking — a
charge against a specific trip is a `booking_amendments` surcharge. Both net
out of the spendable pool but are never consumed by the credit sweep, which
drains only positive rows; consuming one would erase it *and* hand the money
back.

**Nothing closes a ledger row by hand.** Closing is automatic — the
apply-credit RPC settles what it spends, the restore-reclaim trigger settles
what it takes back. Correcting a balance means issuing the opposite row, with
a required reason, so both halves stay on the statement instead of one
disappearing behind a note.

Every row records a `source`: `manual`, `event_cancellation`,
`booking_cancellation_return`, `carry_forward`, `return_reclaimed`,
`admin_charge`, or `admin_refund`.
Only `event_cancellation` and `booking_cancellation_return`
(`RETURN_SOURCES`) mean *this booking's money is given back right now*,
and only they block a further automatic refund — a goodwill award, a
carry-forward remainder or a reclaimed return must not.

**Cancelling and restoring is a round trip.** The cancel hands the
booking's account credit back; restoring takes it back again, because the
credit backs the booking once more — settling what is still open, and
reducing the booking's account-credit payment by anything already spent
elsewhere. Reclaimed rows become `return_reclaimed` so the two triggers
agree on state: without that, a second cancel skips refunding *and* a
second restore reclaims the same money twice.

**Account credit** — the balance a diver sees — is *open ledger rows not
tied to an active booking, plus every overpayment*, floored at zero. So a credit tied to a
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

## Discounts

A discount is **shop-authored, offered per event, asked for by the diver and
worth nothing until an admin approves it.** Three tables, one per moment:

| Table | Holds |
| --- | --- |
| `discounts` | What the shop offers at all — a label, who qualifies, and either a percent or a flat amount |
| `event_discounts` | Which of them an event puts on its register form |
| `booking_discounts` | One diver asking for one of them on one booking, and what an admin decided |

**The money is not in any of them.** Approving writes a negative
`booking_amendments` row, so the balance, the diver's statement, the deposit
clamp, the refund queue and the accounting export pick it up with no new
arithmetic — `owed` is still `details.total + amendments` and nothing else. A
discount that edited `details.total` would rewrite the quote the diver
accepted, which is the one thing that snapshot exists to prevent.

So the register form quotes the **undiscounted** price and says so. A request
changes no figure, and the diver's Payments page tells them which of theirs are
still waiting — a balance that looks untouched is then a balance that is
waiting, not one that ignored them.

`decide_booking_discount` is the only thing in the app that turns a discount
into money, and it is admin-only, matching the `booking_amendments` insert
policy it writes through. It computes the amount itself: a percent of the
booking's **frozen total** (not of what other amendments have left — "10% off"
means 10% of the trip), rounded to whole units, then **clamped to what is still
owed**. Never past zero: handing money back is a credit row with a reason,
decided deliberately, not the rounding consequence of a half-price row meeting
an already-reduced balance. It refuses a cancelled booking, for the same reason
`apply_credit_to_booking` does.

Approving can also **confirm a pending booking**: a discount lowers what is
owed, which can cover the deposit for the first time, and there is no later
payment to trigger the promotion. Same rule as `apply_credit_to_booking`,
against the deposit clamped to owed.

Asking is `request_booking_discount` — the diver, the parent who manages them,
or staff. `booking_discounts_validate` is where the rules actually live, so the
RPC and the service_role insert that `create-registration` makes cannot drift
apart: the booking must be live, the discount active, and a diver may only ask
for what the event offers. **An admin may apply any active discount to any
booking** — that is the post-registration path, and requiring them to attach it
to the event first would change what every other diver on that event is
offered.

An admin applying one this way still records a **request**, decided with the
same Approve / Reject as one a diver ticked. The extra click is the point: two
ways for money to come off a booking, one of them not recorded as a decision,
is exactly what the approval step exists to prevent.

A trigger notifies every admin the moment a request lands, and the badge in the
admin header counts the undecided ones. One live request per discount per
booking; a **rejected** one may be asked again, since the usual reason for a
rejection is a diver who could not produce the card rather than one who is not
a student.

## Cancellations

Four of them, and only one returns money by itself.

| What happened | Credited automatically |
| --- | --- |
| Shop cancels the event | **Full net paid**, to every registrant |
| Diver asked to cancel **on or before** the event's cancel-by date | **Full net paid** |
| Diver asked **after** the cancel-by date | Only the **account credit** they had spent |
| Admin cancels a booking nobody asked about | Only the **account credit** |

Whatever is not credited stays on the booking for a human — a forfeiture
never happens automatically.

### The one deposit that does not come back

`cancellation_policies.deposit_refundable` is the exception, and the only
one. When it is false, the event's frozen deposit is withheld from the
credit and the diver gets the rest.

It marks a deposit the shop has already spent and cannot recover: a PADI
eLearning code bought the moment a student registers, a prepaid room.
Refunding that is not returning the diver's money, it is paying them out
of the shop's own.

The flag rides with the **policy**, not the event, so the text a diver
acknowledged at registration and the money the trigger returns cannot
drift apart. Three of the shop's policies say it in words already —
*Course with Elearning*, *Local Multi-day Trip*, *International Trip* —
and those are the three the migration backfills.

The withholding applies to the late branch too. A non-refundable deposit
is gone whatever it was paid with — PADI does not refund the code because
the payment happened to be store credit — and capping both branches keeps
out the perverse case where cancelling late returns more than cancelling
in time. The kept amount is clamped to `owed` as well as to net paid,
mirroring `depositDue`: keeping 5,000 of a 3,000 booking is a windfall,
not a deposit.

When the deposit is the only thing left on the booking, the trigger
stamps `cancellation_settled_at` itself, with no `cancellation_settled_by`
— no person decided it, the policy did. Without that stamp the money
would be invisible: the return credit already keeps the booking off the
holding list, so nobody would ever be told what was kept.

**A shop cancellation still refunds in full**, deposit included.
`issueCancellationCredits` does not read the flag, on purpose: the policy
text promises a diver whose course the *shop* called off that they keep
the eLearning to use at any PADI shop, which is a different settlement
from keeping their money.

**The deadline is `events.cancel_date`, and the moment that counts is
`refund_requested_at`** — when the *diver* asked, not when an admin
approved, so a slow approval cannot cost them their refund. An event with
no cancel-by date has no deadline to miss. `cancellation_in_time()`
decides, judging the shop's calendar day via `shop_timezone()` — SQL
cannot read `fundive.config.ts`, so a fork restates the zone there and an
integration test fails the build if the two disagree.

Account credit is the one thing the app can always hand back on its own,
because it never left the app. Cash and transfers did, so only a person
can move those.

### Who a cancellation credit goes to

Whoever the money belonged to. A booking with `payer_id` set is paid by
someone else — `bookings_validate_payer` allows only the diver or their
parent account — and the app already treats that money as the payer's:
`diverCreditBalance` drops those bookings from the diver's spendable pool
and counts them toward the lead. The credit follows the same rule, so a
parent who paid gets the refund back rather than watching it land in their
child's spendable balance with nothing on the parent's own statement.

**Account credit is the exception, and it splits the refund in two.**
Store credit spent on a booking came out of the *booking owner's* pool —
`apply_credit_to_booking` only ever consumes `v_booking.user_id`'s rows,
whoever triggered it — so returning it to the payer would move one
person's credit to another. The account-credit part goes back to the
owner, everything else to the payer, and with no `payer_id` the two halves
are the same person and it stays one row.

The restore path follows the same money: `bookings_reclaim_returned_credit`
`_on_restore` finds rows by `booking_id`, which is owner-agnostic, and
mints any unspent tail under the row it came off rather than under the
booking owner.

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
and no other screen shows it. Three endings are correct, and exactly one
must be chosen:

| Ending | Recorded as |
| --- | --- |
| Money went back | A `refunded` payment |
| Diver keeps it as credit | An open credit, `booking_cancellation_return` |
| Shop keeps it (a cancellation fee) | `bookings.cancellation_settled_at` |

The first two move money. The third does not — the cash is already
counted as revenue on that event — so it records an acknowledgment
instead. Without one, a kept fee is indistinguishable from money nobody
has dealt with, and its row would never leave the list.

**The list carries the remainder, not the whole payment.** A cancellation
can be part settled: a late canceller gets their account credit back and
their cash does not, a policy withholds a non-refundable deposit and
returns the rest. `selectUnreconciled` subtracts what a cancellation
credit already handed back, so the figure an admin acts on is the figure
still open. Testing whether a return credit merely *existed* was right
while a cancellation was all-or-nothing and wrong the moment one could be
part-returned — a diver who paid 7,000 cash and 3,000 account credit and
cancelled late got the 3,000 back, and the row then vanished carrying
7,000 nobody had decided about, hidden by exactly the credit that proved
only part of it was settled.

The kept amount is **shown to the diver** on the booking it came off, and
to staff on the same booking's payments block. It is derived from what is
still on the booking rather than stored, so a later refund cannot
contradict it: `cancellationKept()` is net paid less whatever was handed
back as a cancellation credit. Counting the returned credit at any status
matters — a diver spending it elsewhere settles the row but changes
nothing about what was kept — and a booking that was partly credited and
partly kept, which is exactly what a non-refundable deposit produces,
would otherwise report the whole net paid as kept. The diver's Payments
page shows it only for bookings whose credits that viewer may read — a
lead booker who is not the owner's parent sees no credit rows at all, and
reading that silence as "nothing came back" would report their whole
payment as kept. Settling is staff-only, enforced by
`bookings_guard_diver_status` — the self-update RLS policy gates the row,
not the columns, so without that a diver could erase their own stranded
money from the list.

`/admin/refunds` lists these under **Cancelled bookings still holding
money**, with a button per ending. It is the only surface that can see
them: balances read settled, account credit skips cancelled bookings, and
the refund queue lists only non-cancelled ones.

## Reading a diver's balance

The diver profile shows one figure and the history that produced it — a
statement, each line carrying the change it made and the balance standing
after it (`buildDiverStatement`).

**Credit-positive**: a positive balance is money the shop owes the diver.
The closing balance is deliberately **unclamped**, the one place it
differs from `diverCreditBalance` — that function answers "how much can
this diver spend", so it floors each active booking at zero. A diver
1,000 short on one dive and 500 ahead on another can spend 500, not −500;
a statement cannot floor anything or its lines stop adding up. Both are
shown, and they agree unless some active booking is underpaid.

Three rules make it reconcile. A cancelled booking's charge **and
payments** are reversed at `cancelled_at`, and anything recorded against
it afterwards has no effect; a credit tied to a cancelled booking still
counts, because that is how a refund-as-credit reaches the diver; and a
booking a lead booker pays for is dropped, being the lead's money. Which
leaves the identity the summary block is built on: `balance = paid −
charged + open credit`.

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
10. A discount is money only once an admin approves it, and only as an
    amendment.

10. A money-moving payment names its real-world transaction, and
    attribution is stamped from the act, never taken from the caller.
11. The ledger is signed; only `admin_charge` and `admin_refund` are
    negative, and neither is ever tied to a booking.
12. Constraints, triggers and RLS policies get integration tests.
