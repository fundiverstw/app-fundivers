-- An account refund: the shop hands a diver back, in cash or by transfer, the
-- store credit they were holding.
--
-- The app could already record every other ending for money the shop owes.
-- Credit tied to a cancelled booking can be refunded as a `refunded` payment
-- row against that booking (see AdminRefundsPage). What had no home was the
-- credit with no booking behind it -- a goodwill award, a carry-forward
-- remainder, the balance left after a diver stopped diving with the shop. An
-- admin paying that out either left the credit standing (the diver keeps
-- spendable credit they have already been given in cash) or issued an
-- `admin_charge` for it, which says the diver bought something and makes the
-- shop's own payout read as a sale.
--
-- Arithmetically a refund IS a charge: a negative row on the same signed
-- ledger, never tied to a booking, netting itself into every balance in the
-- app for free. The two are separated only by what they mean, which is the
-- whole point -- a charge is money the diver owes for goods, a refund is money
-- the shop has already given back. `buildDiverStatement` labels them apart and
-- an admin reading a balance can tell one from the other.
--
-- The sign and tie constraints therefore widen rather than change: the set of
-- sources allowed to be negative, and the set forbidden a booking_id, both
-- gain `admin_refund` and nothing else crosses over.
--
-- `apply_credit_to_booking` needs no change. It nets the whole open ledger
-- into its available pool (so a refund correctly reduces what a diver can
-- spend) and drains only rows with `amount > 0` (so it can never "spend" a
-- refund back into a booking).

ALTER TABLE "public"."credits" DROP CONSTRAINT IF EXISTS "credits_source_check";

ALTER TABLE "public"."credits"
  ADD CONSTRAINT "credits_source_check" CHECK ("source" = ANY (ARRAY[
    'manual'::"text",
    'event_cancellation'::"text",
    'booking_cancellation_return'::"text",
    'carry_forward'::"text",
    'return_reclaimed'::"text",
    'admin_charge'::"text",
    'admin_refund'::"text"
  ]));

ALTER TABLE "public"."credits" DROP CONSTRAINT IF EXISTS "credits_amount_check";

ALTER TABLE "public"."credits"
  ADD CONSTRAINT "credits_amount_check" CHECK (
    CASE WHEN "source" IN ('admin_charge', 'admin_refund')
         THEN "amount" < 0 ELSE "amount" > 0 END
  );

-- Same name as in 20260823130000: it is the one constraint for "a negative row
-- is never tied to a booking", and a second constraint beside it would let the
-- two disagree. A refund is untied for the charge's reason and one of its own:
-- `openCreditForBooking` shows a tied credit as an offset against that
-- booking's balance, and a negative one there would read as the diver owing
-- more for the trip than they were charged.
ALTER TABLE "public"."credits" DROP CONSTRAINT IF EXISTS "credits_charge_untied";

ALTER TABLE "public"."credits"
  ADD CONSTRAINT "credits_charge_untied" CHECK (
    "source" NOT IN ('admin_charge', 'admin_refund') OR "booking_id" IS NULL
  );

COMMENT ON COLUMN "public"."credits"."amount" IS
  'Signed. Positive = money the shop owes the diver (a credit). Negative = money that is no longer owed: goods the diver bought (source admin_charge) or credit paid back to them (source admin_refund).';
