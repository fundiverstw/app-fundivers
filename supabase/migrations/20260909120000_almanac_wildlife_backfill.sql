-- The free text that was already there, moved onto the taxa.
--
-- Every string a diver ever typed into the wildlife box is read once, matched
-- against the catalog the previous migration seeded, and written back as a
-- sighting. What matches becomes a real one; what does not becomes a
-- `raw_label` sighting, which is the same string held somewhere staff can map
-- it from in one action instead of a column nobody can query.
--
-- Nothing is thrown away and nothing is guessed at. The match is exact on the
-- scientific name or on a common name in ANY language — a Japanese diver's
-- "アオウミガメ" and an English one's "green sea turtle" land on the same taxon,
-- which is the whole point of the exercise — with one concession to English
-- plurals, because "turtles" and "mantas" are what people actually type.
--
-- A label that matches two different taxa is left unmatched on purpose. That
-- is the ambiguity this schema exists to surface, and resolving it by picking
-- the lower id would bury it again.

with labels as (
  select r.id as record_id, btrim(w) as label
  from public.almanac_records r
  cross join lateral unnest(r.wildlife) as w
  where btrim(w) <> ''
),
normalized as (
  select record_id, label,
         lower(label) as key,
         regexp_replace(lower(label), 's$', '') as singular
  from labels
),
candidates as (
  select lower(t.scientific_name) as key, coalesce(t.accepted_id, t.id) as taxon_id
  from public.taxa t
  union
  select lower(n.name), coalesce(t.accepted_id, t.id)
  from public.taxon_names n
  join public.taxa t on t.id = n.taxon_id
),
lookup as (
  select key, min(taxon_id::text)::uuid as taxon_id
  from candidates
  group by key
  having count(distinct taxon_id) = 1
),
matched as (
  select n.record_id, n.label, m.taxon_id
  from normalized n
  left join lateral (
    select l.taxon_id
    from lookup l
    where l.key = n.key or l.key = n.singular
    -- An exact hit beats a de-pluralized one, so "manta" cannot be pulled off
    -- its own entry by a "mantas" that stems to something else.
    order by (l.key = n.key) desc
    limit 1
  ) m on true
),
identified as (
  insert into public.almanac_sightings (record_id, taxon_id)
  select distinct record_id, taxon_id from matched where taxon_id is not null
  on conflict do nothing
  returning 1
)
insert into public.almanac_sightings (record_id, raw_label)
select distinct record_id, label from matched where taxon_id is null
on conflict do nothing;


-- The column goes with the data. Leaving it would leave two answers to "what
-- did this record say was in the water", one of which nothing updates any more
-- — and a stale duplicate of exactly the field this whole change exists to
-- make trustworthy is the worst thing to leave behind.
alter table public.almanac_records drop column wildlife;
