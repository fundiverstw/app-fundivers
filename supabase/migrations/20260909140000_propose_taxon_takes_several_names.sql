-- A diver proposing an animal can give it more than one name.
--
-- `propose_taxon` took a single `p_common_name`, which asked the diver for the
-- one thing they call it. That is not how anybody knows a fish: it is a
-- lionfish and a turkeyfish and a firefish, and the whole point of hanging
-- names off a taxon is that a name is a label, not the identity. A form with
-- one box quietly made the diver pick a favorite, and the names they dropped
-- are exactly the ones the next diver would have searched for.
--
-- Names are inserted `on conflict do nothing`, so one that already belongs to
-- another taxon in that language leaves the catalog's mapping standing: within
-- a language a name means one animal, and a proposal is not the place that
-- gets overturned. The taxon is still created and still usable.
drop function if exists public.propose_taxon(text, text, uuid, text, text);

create function public.propose_taxon(
  p_rank text,
  p_scientific_name text,
  p_parent_id uuid default null,
  p_common_names text[] default null,
  p_lang text default null
)
returns uuid
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_name text := btrim(p_scientific_name);
  v_taxon_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(accepted_id, id) into v_taxon_id
    from public.taxa where lower(scientific_name) = lower(v_name);

  if v_taxon_id is null then
    insert into public.taxa (rank, scientific_name, parent_id, status, proposed_by)
      values (p_rank, v_name, p_parent_id, 'pending', auth.uid())
      returning id into v_taxon_id;
  end if;

  if p_lang is not null then
    -- None of them primary on the way in: the flag is unique per taxon and
    -- language, and a set of rows that each asked "is there a primary yet?"
    -- against the state before the insert would all answer no and collide.
    insert into public.taxon_names (taxon_id, lang, name, is_primary)
    select v_taxon_id, p_lang, candidate, false
      from (
        select distinct btrim(n) as candidate
        from unnest(coalesce(p_common_names, array[]::text[])) as n
        where btrim(n) <> ''
      ) named
    on conflict do nothing;

    -- Then one of them is raised, if the taxon had none in that language. An
    -- entry whose names are all non-primary renders by whichever row came back
    -- first, which is not a decision anybody made.
    update public.taxon_names
       set is_primary = true
     where id = (
       select id from public.taxon_names
        where taxon_id = v_taxon_id and lang = p_lang
        order by created_at, name
        limit 1
     )
     and not exists (
       select 1 from public.taxon_names
        where taxon_id = v_taxon_id and lang = p_lang and is_primary
     );
  end if;

  return v_taxon_id;
end;
$$;

revoke all on function public.propose_taxon(text, text, uuid, text[], text) from public, anon;
grant execute on function public.propose_taxon(text, text, uuid, text[], text) to authenticated, service_role;
