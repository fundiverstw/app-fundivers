-- Optional alternate-script name on profiles. Lets divers store their
-- name in a non-Latin script (kanji, zhuyin, hangul, etc.) alongside the
-- Latin-letter `full_name`. Surfaces in admin views, the registration
-- PDF, and the confirmation email subject so paperwork in the diver's
-- native script can be matched back to a Romanized profile.

alter table public.profiles
  add column name_alt text;
