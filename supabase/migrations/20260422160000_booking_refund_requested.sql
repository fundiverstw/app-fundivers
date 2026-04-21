-- Refund request flag on bookings. Set by the diver when they want their
-- deposit back; admin approves by flipping the booking to 'cancelled'. Null
-- when no refund has been requested.

begin;

alter table public.bookings
  add column refund_requested_at timestamptz;

commit;
