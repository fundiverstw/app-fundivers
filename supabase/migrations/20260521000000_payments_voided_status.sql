-- Add 'voided' to the payments.status CHECK so admins can revert a row
-- that was marked paid by mistake. Voided rows stay in the table for
-- audit (we never want to silently lose a payment record), but every
-- aggregator filters by status='paid' so they no longer count toward
-- the booking's paid sum. The lib helper that voids also re-evaluates
-- the booking status — a 'confirmed' booking whose remaining paid sum
-- has dropped below the deposit threshold flips back to 'pending'.

alter table public.payments drop constraint payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('pending','paid','refunded','voided'));
