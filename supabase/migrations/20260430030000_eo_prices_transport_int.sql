-- EO_prices.transport carries the per-tier transportation surcharge in
-- NTD (bigint). The original Wix import landed it as `text` (see
-- 20260421130941_remote_schema.sql); cloud already had it converted to
-- bigint by the time this migration was authored. This migration brings
-- local in sync without losing data on either side:
--
--   * if the column is missing  → add it as bigint (nullable)
--   * if the column is text     → cast via regex; non-numeric values
--                                  null out (the legacy text was free-form
--                                  copy unrelated to the price)
--   * if already bigint/numeric → no-op
--
-- NULL or 0 means transportation is included in the base price; the
-- registration form hides the "Need transportation" checkbox in that
-- case and renders "Transportation included in base price" instead.

begin;

do $$
declare
  current_type text;
begin
  select data_type into current_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'EO_prices' and column_name = 'transport';

  if current_type is null then
    alter table public."EO_prices" add column transport bigint;
  elsif current_type = 'text' then
    alter table public."EO_prices"
      alter column transport type bigint
      using case when transport ~ '^\s*[0-9]+\s*$' then btrim(transport)::bigint else null end;
  end if;
  -- already bigint / numeric: no-op
end$$;

notify pgrst, 'reload schema';

commit;
