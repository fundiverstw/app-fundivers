-- Legal-brief items #3 (audit M5) and #4: write an admin_audit_log
-- entry for every PII purge run, and broaden the column set to match
-- what the user-facing terms text actually promises.
--
-- What changes vs the previous purge_stale_pii body:
--   1. Nulls nitrox_card_path and deep_card_path on the profile (the
--      old version only nulled cert_card_path; the terms text says
--      "cert-card photo" generically, so all three are honored).
--   2. Nulls bookings.notes for the stale users' bookings — that
--      column is diver-supplied free text and historically holds
--      medical / personal info that the structured `details` jsonb
--      does not.
--   3. Writes one synthetic admin_audit_log row per purge run with
--      actor_id null (service-role context), action 'delete' (closest
--      enum value), target_table 'profiles', target_id 'pii_purge'
--      (rollup marker), and the cutoff + affected counts + the
--      scrubbed profile ids in `before` jsonb.
--
-- The storage objects themselves (under <user_id>/ folders in the
-- cert-cards, nitrox-cards, deep-cards buckets) are still NOT removed
-- by this function — Supabase blocks DELETE on storage.objects from
-- SQL contexts. A follow-up cleanup worker is the right place; this
-- comment + the audit-log payload's profile_ids gives it the input
-- list.

begin;

create or replace function public.purge_stale_pii(older_than_months int default 12) returns int
  language plpgsql security definer set search_path = public as $$
declare
  cutoff             timestamptz := now() - make_interval(months => older_than_months);
  stale_ids          uuid[];
  profiles_affected  int := 0;
  bookings_affected  int := 0;
begin
  select array_agg(p.id) into stale_ids
  from public.profiles p
  left join lateral (
    select max(created_at) as last_booked
    from public.bookings b where b.user_id = p.id
  ) b on true
  where p.role = 'diver'
    and coalesce(b.last_booked, p.created_at) < cutoff;

  if stale_ids is null or array_length(stale_ids, 1) is null then
    return 0;
  end if;

  update public.profiles
  set id_number               = null,
      medical_notes           = null,
      emergency_contact_name  = null,
      emergency_contact_phone = null,
      cert_card_path          = null,
      nitrox_card_path        = null,
      deep_card_path          = null
  where id = any(stale_ids);
  get diagnostics profiles_affected = row_count;

  update public.bookings
  set notes = null
  where user_id = any(stale_ids)
    and notes is not null;
  get diagnostics bookings_affected = row_count;

  insert into public.admin_audit_log (actor_id, action, target_table, target_id, before, after)
  values (
    null,
    'delete',
    'profiles',
    'pii_purge',
    jsonb_build_object(
      'cutoff',                   cutoff,
      'older_than_months',        older_than_months,
      'profile_ids',              to_jsonb(stale_ids),
      'profiles_scrubbed',        profiles_affected,
      'booking_notes_scrubbed',   bookings_affected
    ),
    null
  );

  return profiles_affected;
end;
$$;

commit;
