-- Remap stale prereqs UUIDs (carried over from the prior dataset, which
-- doesn't share ids with our cert_levels seed) to the correct cloud
-- cert_levels rows by code. Inferred from the consistent pattern across
-- the 24 affected rows:
--
--   023b7361-7cc3-4506-8610-13f6e22356e5  →  advanced_open_water
--     (Rescue + Deep Specialty courses, plus most fun dives — all need AOW)
--   4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3  →  open_water
--     (AOW course requires OW; entry-level fun dives like LDB / Lambai)
--   217fe9dd-01fe-4974-9203-8f17d0fac911  →  null
--     (Open Water / EFR / Equipment courses — no entry requirement)
--
-- Idempotent: filters require prereqs to still be a UUID-shape string, so
-- re-running on already-cleaned rows is a no-op.

begin;

-- A small mapping CTE — easier to audit than three separate UPDATEs.
with mapping as (
  select '023b7361-7cc3-4506-8610-13f6e22356e5'::uuid as stale,
         'advanced_open_water'::text as code,
         false as clear_only
  union all
  select '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3'::uuid,
         'open_water',
         false
  union all
  select '217fe9dd-01fe-4974-9203-8f17d0fac911'::uuid,
         null,    -- no cert_levels target — just clear the field
         true
),
resolved as (
  select m.stale,
         m.clear_only,
         cl.id as new_cert_id
    from mapping m
    left join public.cert_levels cl on cl.code = m.code
)
update public."EO_dives" d
   set prereq_cert_id = case when r.clear_only then null else r.new_cert_id end,
       prereqs        = null
  from resolved r
 where d.prereq_cert_id is null
   and d.prereqs ~ '^[0-9a-fA-F-]{36}$'
   and d.prereqs::uuid = r.stale;

with mapping as (
  select '023b7361-7cc3-4506-8610-13f6e22356e5'::uuid as stale,
         'advanced_open_water'::text as code,
         false as clear_only
  union all
  select '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3'::uuid,
         'open_water',
         false
  union all
  select '217fe9dd-01fe-4974-9203-8f17d0fac911'::uuid,
         null,
         true
),
resolved as (
  select m.stale,
         m.clear_only,
         cl.id as new_cert_id
    from mapping m
    left join public.cert_levels cl on cl.code = m.code
)
update public."EO_courses" c
   set prereq_cert_id = case when r.clear_only then null else r.new_cert_id end,
       prereqs        = null
  from resolved r
 where c.prereq_cert_id is null
   and c.prereqs ~ '^[0-9a-fA-F-]{36}$'
   and c.prereqs::uuid = r.stale;

commit;
