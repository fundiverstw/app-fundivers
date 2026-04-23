-- PII retention policy + terms-of-service timestamp.
--
-- Retention: a profile whose most-recent booking (or signup date if no
-- bookings) is older than N months gets its sensitive columns nulled out:
-- id_number, medical_notes, emergency contacts, cert card. The public.
-- purge_stale_pii(months) function does the scrub and returns the row
-- count. Schedule it via pg_cron or a worker later; this migration just
-- installs the function.
--
-- Terms: profiles.agreed_to_terms_at records when the user checked the
-- "I agree to the Terms of Use" box at signup. The handle_new_user trigger
-- reads options.data.agreed_to_terms_at off raw_user_meta_data when the
-- Supabase signUp is called from the browser, so the stamp lands in the
-- profile row at creation time.

begin;

alter table public.profiles add column if not exists agreed_to_terms_at timestamptz;

-- Replace handle_new_user so it copies over the terms-agreement timestamp
-- the client stashed in auth.users.raw_user_meta_data during signUp.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, agreed_to_terms_at)
  values (
    new.id,
    -- raw_user_meta_data is text-keyed jsonb; ISO string → timestamptz.
    (new.raw_user_meta_data ->> 'agreed_to_terms_at')::timestamptz
  );
  return new;
end;
$$;

-- ============================================================
-- PII retention scrub
-- ============================================================

create or replace function public.purge_stale_pii(older_than_months int default 12) returns int
  language plpgsql security definer set search_path = public as $$
declare
  cutoff     timestamptz := now() - make_interval(months => older_than_months);
  stale_ids  uuid[];
  affected   int := 0;
  sid        uuid;
begin
  -- Collect diver profiles inactive for the retention window. "Inactive"
  -- means no bookings newer than the cutoff; profiles that never booked
  -- are aged against profiles.created_at.
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

  -- We'd ideally remove cert-card storage objects here too, but Supabase
  -- blocks direct DELETE on storage.objects from SQL contexts. A follow-up
  -- worker / script can call the Storage API to clean up files under the
  -- stale folders — cert_card_path being nulled below means the app will
  -- no longer surface those files anyway. Loop variable kept for readers:
  foreach sid in array stale_ids loop
    perform sid;  -- placeholder; storage cleanup handled externally
  end loop;

  -- Null sensitive columns on the profiles themselves. Core identity
  -- (full_name, cert info) stays — that's business history, not PII.
  update public.profiles
  set id_number               = null,
      medical_notes           = null,
      emergency_contact_name  = null,
      emergency_contact_phone = null,
      cert_card_path          = null
  where id = any(stale_ids);
  get diagnostics affected = row_count;

  return affected;
end;
$$;

-- Admin-only execution. The definer attribute already bypasses RLS inside
-- the function, but we still gate invocation so a compromised diver
-- account can't accidentally trigger a PII wipe.
revoke all on function public.purge_stale_pii(int) from public;
grant execute on function public.purge_stale_pii(int) to service_role;

commit;
