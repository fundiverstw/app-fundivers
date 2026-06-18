-- The standalone `phone` field is redundant with the preferred-contact pair
-- (contact_method + contact_id), which already captures how to reach a diver.
-- Registration and the profile form no longer collect it, and the admin views
-- that displayed it as a contact fallback now lean on contact_id alone. Drop
-- the column outright — there is no production data to preserve.
--
-- Note: emergency_contact_phone is a different column (an emergency contact's
-- number, not the diver's) and is intentionally left untouched.

begin;

alter table public.profiles
  drop column phone;

commit;
