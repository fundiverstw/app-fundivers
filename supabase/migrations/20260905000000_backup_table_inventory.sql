-- What a whole-database CSV backup has to enumerate.
--
-- The admin "Back up database" export writes one CSV per table. A list of
-- table names kept in application code would be a list someone has to remember
-- to extend, and the day it is forgotten the backup quietly stops covering the
-- new table — the one failure mode a backup must not have. So the database
-- names its own tables.
--
-- Three things come back per table, because a faithful CSV needs all three:
--   columns     — every column in declaration order, so an EMPTY table still
--                 exports a header row and a restore knows the shape.
--   key_columns — the primary key, in index order. PostgREST pages the rows
--                 (1000 at a time), and paging without an ORDER BY may repeat
--                 or skip rows between pages; ordering by the key makes the
--                 page boundaries stable.
--   relkind 'r' only — ordinary tables. Views are derived from these, so
--                 carrying them would duplicate rows in the archive and invite
--                 a restore that writes into something it cannot write into.
create or replace function public.backup_table_inventory()
returns table (table_name text, columns text[], key_columns text[])
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  select
    c.relname::text,
    (
      select array_agg(a.attname::text order by a.attnum)
      from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    ),
    coalesce((
      select array_agg(a.attname::text order by k.ord)
      from pg_index i
      cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
      where i.indrelid = c.oid and i.indisprimary
    ), '{}'::text[])
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by c.relname;
$$;

comment on function public.backup_table_inventory() is
  'Every public base table with its columns and primary key, for the admin database backup (export-database-backup).';

-- Service-role only. The inventory is a schema map: harmless on its own, but
-- nothing a browser client has any reason to ask for, and the export function
-- that needs it already runs as service_role.
alter function public.backup_table_inventory() owner to postgres;
revoke all on function public.backup_table_inventory() from public, anon, authenticated;
grant execute on function public.backup_table_inventory() to service_role;
