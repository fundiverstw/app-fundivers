-- ============================================================
-- Grandfather existing accounts for the annual waivers
-- ============================================================
-- When waiver tracking ships, every existing diver would suddenly show as
-- "missing" their annual liability + medical waivers — even though the shop
-- already has signed paper forms on file for them. To avoid nagging current
-- customers, backfill a grandfather signature for each profile that exists at
-- deploy time, for each ANNUAL waiver. They count as current for a year (the
-- normal annual window) and then re-sign in-app like everyone else.
--
-- This is a point-in-time backfill, so the annual waiver codes/versions are
-- hardcoded to today's catalog (src/config/waivers.ts: padi_liability v1,
-- diver_medical v1). Per-event waivers (continuing_education) are NOT
-- grandfathered — those are signed per enrollment going forward.
--
-- Mirrors the agreed_to_terms backfill in
-- 20260603000000_terms_consent_versioning.sql. Only accounts that exist now are
-- covered; anyone who signs up after this migration runs goes through the normal
-- signing flow. signed_name marks the row as grandfathered for audit honesty.

insert into public.waiver_signatures
  (diver_id, waiver_code, waiver_version, signed_name, signed_at)
select p.id, w.code, w.version, '(grandfathered)', now()
from public.profiles p
cross join (values
  ('padi_liability', 1),
  ('diver_medical',  1)
) as w(code, version)
where not exists (
  select 1 from public.waiver_signatures s
  where s.diver_id = p.id and s.waiver_code = w.code
);
