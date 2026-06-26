-- Scrub the shop's real bank-transfer details (account number, account-holder
-- name, branch) out of the DiveTravel trip-description content.
--
-- Why: the seed migration (20260429100000_seed_dive_travel.sql) imported these
-- from Wix inside marketing HTML, so the real account number "1305 4100 1904",
-- the holder "Wong, Dennis", and the branch render in trip descriptions — and
-- sync to the public Wix site. That is personal/financial data that must not
-- ship in the open-sourced repo or stay on the public site. Bank-transfer
-- payers are now told the details arrive by email (see payment-instructions.ts),
-- so the inline copy is obsolete.
--
-- Forward-only: the seed migration is immutable (its file/history is handled
-- separately in the pre-publish scrub), so this rewrites the live rows. The
-- UPDATE fires the wix_sync triggers, which propagates the cleaned descriptions
-- to the Wix CMS too. NULLs are preserved; only rows containing a literal are
-- touched.

update public."DiveTravel" set
  admin_title    = replace(replace(replace(replace(admin_title,    '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  included       = replace(replace(replace(replace(included,       '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  not_included   = replace(replace(replace(replace(not_included,   '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  transportation = replace(replace(replace(replace(transportation, '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  description    = replace(replace(replace(replace(description,    '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  tagline        = replace(replace(replace(replace(tagline,        '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  tagline_text   = replace(replace(replace(replace(tagline_text,   '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  details        = replace(replace(replace(replace(details,        '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  prerequisites  = replace(replace(replace(replace(prerequisites,  '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', ''),
  itinerary      = replace(replace(replace(replace(itinerary,      '1305 4100 1904', 'provided by email'), 'Wong, Dennis', 'FunDivers'), 'Shuang He', 'provided by email'), '雙和', '')
where (coalesce(admin_title,'') || coalesce(included,'') || coalesce(not_included,'') ||
       coalesce(transportation,'') || coalesce(description,'') || coalesce(tagline,'') ||
       coalesce(tagline_text,'') || coalesce(details,'') || coalesce(prerequisites,'') ||
       coalesce(itinerary,'')) ~ '1305 4100 1904|Wong, Dennis|Shuang He|雙和';
