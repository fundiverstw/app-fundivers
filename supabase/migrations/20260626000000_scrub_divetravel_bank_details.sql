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
-- Forward-only: the seed migration is immutable, so this rewrites the live rows.
-- The UPDATE fires the wix_sync triggers, propagating the cleaned descriptions
-- to the Wix CMS too. NULLs are preserved; only rows whose value contains a
-- literal are touched.
--
-- Schema-adaptive: the local and cloud DiveTravel schemas have drifted (cloud
-- is missing some of the text columns the local seed adds), so we introspect
-- and scrub only the columns that actually exist on the target database.

do $$
declare
  col text;
  candidates text[] := array[
    'admin_title', 'included', 'not_included', 'transportation', 'description',
    'tagline', 'tagline_text', 'details', 'prerequisites', 'itinerary'
  ];
begin
  foreach col in array candidates loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'DiveTravel'
        and column_name  = col
        and data_type in ('text', 'character varying')
    ) then
      execute format($f$
        update public."DiveTravel"
        set %1$I = replace(replace(replace(replace(%1$I,
              '1305 4100 1904', 'provided by email'),
              'Wong, Dennis',   'FunDivers'),
              'Shuang He',      'provided by email'),
              '雙和',           '')
        where %1$I ~ '1305 4100 1904|Wong, Dennis|Shuang He|雙和'
      $f$, col);
    end if;
  end loop;
end $$;
