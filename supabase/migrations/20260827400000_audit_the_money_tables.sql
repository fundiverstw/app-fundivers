-- Audit the two tables that hold the money.
--
-- `bookings` and `profiles` have been audited since the baseline. `payments`
-- and `credits` never were, which is exactly backwards: a booking's status is
-- recoverable from context, and a voided payment is not. Asked why three
-- divers hold refund credit against bookings whose payments were voided, the
-- database had nothing to say — not who voided them, not when, not from what
-- state. The rows that move money were the rows nobody was watching.
--
-- Same trigger the other two use, so the same rules apply: nothing is logged
-- for service-role or migration writes (auth.uid() is null) or for a diver
-- acting on their own row, and the before/after images are whole rows. An
-- INSERT of a credit and a void of a payment now both leave a trace naming the
-- staff member who did it.
CREATE OR REPLACE TRIGGER "payments_admin_audit_trg"
  AFTER INSERT OR DELETE OR UPDATE ON "public"."payments"
  FOR EACH ROW EXECUTE FUNCTION "public"."audit_admin_write"();

CREATE OR REPLACE TRIGGER "credits_admin_audit_trg"
  AFTER INSERT OR DELETE OR UPDATE ON "public"."credits"
  FOR EACH ROW EXECUTE FUNCTION "public"."audit_admin_write"();
