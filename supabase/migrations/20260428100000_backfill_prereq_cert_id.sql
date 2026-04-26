-- Backfill: rows where the legacy free-text `prereqs` column is a bare
-- cert_levels UUID get that value lifted into the new prereq_cert_id FK
-- column, and `prereqs` is cleared. From this migration forward,
-- prereq_cert_id is the source of truth for the structured prerequisite;
-- `prereqs` is reserved for free-form notes (e.g. "20+ logged dives").
--
-- Idempotent: re-running the same migration on an already-backfilled
-- row is a no-op because the WHERE filters require prereqs to still
-- contain a UUID-shape string and prereq_cert_id to still be NULL.

begin;

update public."EO_dives" d
   set prereq_cert_id = d.prereqs::uuid,
       prereqs        = null
 where d.prereq_cert_id is null
   and d.prereqs ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   and exists (select 1 from public.cert_levels c where c.id = d.prereqs::uuid);

update public."EO_courses" c
   set prereq_cert_id = c.prereqs::uuid,
       prereqs        = null
 where c.prereq_cert_id is null
   and c.prereqs ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   and exists (select 1 from public.cert_levels c2 where c2.id = c.prereqs::uuid);

commit;
