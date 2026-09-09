-- The four labels the backfill could not place, placed.
--
-- FunDivers' own almanac history, and nobody else's: this is shop data repair,
-- so it lives here and not in the app the shop forked. Eight sightings across
-- four strings, each mapped to the entry a person would have picked:
--
--   lionfish              -> Pterois         (the genus; the diver did not say
--                                             which lionfish, so neither do we)
--   Box Fish              -> Ostraciidae     (already in the catalog as
--                                             "boxfish" — one space apart)
--   batfish               -> Ephippidae
--   small schools of fish -> Actinopterygii  (fish were seen; nothing more was
--                                             claimed, and the rank says so)
--
-- Written label by label rather than as a clever join, because there are four
-- of them and each one is a judgment somebody should be able to read and
-- disagree with.
--
-- Idempotent by construction: it matches on `raw_label`, which the update
-- clears, so a second run finds nothing. Harmless on a database that never
-- carried these strings.
do $$
declare
  v_pair record;
  v_target uuid;
begin
  for v_pair in
    select * from (values
      ('lionfish', 'Pterois'),
      ('box fish', 'Ostraciidae'),
      ('batfish', 'Ephippidae'),
      ('small schools of fish', 'Actinopterygii')
    ) as v(label, scientific_name)
  loop
    select coalesce(accepted_id, id) into v_target
      from public.taxa where lower(scientific_name) = lower(v_pair.scientific_name);

    if v_target is null then
      raise exception 'taxon % is not in the catalog', v_pair.scientific_name;
    end if;

    -- A record that already names the taxon and also carries the loose label
    -- was always one sighting. The label goes; the sighting stays.
    delete from public.almanac_sightings s
      where lower(s.raw_label) = v_pair.label
        and exists (
          select 1 from public.almanac_sightings other
          where other.record_id = s.record_id and other.taxon_id = v_target
        );

    update public.almanac_sightings
       set taxon_id = v_target, raw_label = null
     where lower(raw_label) = v_pair.label;
  end loop;
end;
$$;
