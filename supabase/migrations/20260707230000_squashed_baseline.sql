-- ============================================================
-- Squashed baseline (was 138 incremental migrations).
-- Schema (structure + RLS + functions + storage policies) + the
-- migration-seeded REFERENCE DATA those migrations carried.
-- NEVER edit in place once pushed.
-- ============================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."accept_current_terms"("p_version" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'must be authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_version is null or p_version < 1 then
    raise exception 'agreed_to_terms_version must be a positive integer'
      using errcode = 'check_violation';
  end if;
  update public.profiles
     set agreed_to_terms_at      = now(),
         agreed_to_terms_version = p_version
   where id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."accept_current_terms"("p_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_waitlist_offer"("p_offer_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_booking_id uuid;
  v_user_id    uuid;
  v_status     text;
  v_expires_at timestamptz;
  v_event_id   uuid;
  v_capacity   int;
  v_taken      int;
begin
  select o.booking_id, b.user_id, o.status, o.expires_at, b.event_id
    into v_booking_id, v_user_id, v_status, v_expires_at, v_event_id
  from public.waitlist_offers o
  join public.bookings b on b.id = o.booking_id
  where o.id = p_offer_id;

  if v_booking_id is null then raise exception 'offer not found'; end if;
  if v_user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status <> 'pending' then raise exception 'offer is no longer pending (status=%)', v_status; end if;
  if v_expires_at < now() then raise exception 'offer has expired'; end if;

  if v_event_id is not null then
    select capacity into v_capacity from public.events where id = v_event_id;
    select count(*) into v_taken from public.bookings
      where event_id = v_event_id and status in ('pending', 'confirmed');
  end if;
  if v_capacity is not null and v_taken >= v_capacity then
    raise exception 'event is at capacity (% of %); offer cannot be accepted', v_taken, v_capacity
      using errcode = 'check_violation';
  end if;

  update public.waitlist_offers set status = 'accepted' where id = p_offer_id;
  update public.bookings        set status = 'pending'  where id = v_booking_id;
end;
$$;


ALTER FUNCTION "public"."accept_waitlist_offer"("p_offer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_user"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only'
      using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot delete your own account'
      using errcode = 'check_violation';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;


ALTER FUNCTION "public"."admin_delete_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_credit_to_booking"("p_booking_id" "uuid", "p_amount" numeric) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_caller    uuid    := auth.uid();
  v_is_admin  boolean := public.is_admin();
  v_booking   public.bookings%rowtype;
  v_owed      numeric;
  v_paid      numeric;
  v_self_cred numeric;
  v_due       numeric;
  v_avail     numeric;
  v_apply     numeric;
  v_deposit   numeric;
  v_remaining numeric;
  v_take      numeric;
  c           record;
begin
  if v_caller is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;

  -- A diver may only spend against their own booking; admins, anyone's.
  if v_booking.user_id <> v_caller and not v_is_admin then
    raise exception 'not your booking' using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;

  -- owed = frozen total snapshot + signed amendment ledger.
  v_owed := coalesce((v_booking.details ->> 'total')::numeric, 0)
          + coalesce((select sum(amount) from public.booking_amendments
                      where booking_id = p_booking_id), 0);

  v_paid := coalesce((select sum(amount) from public.payments
                      where booking_id = p_booking_id and status = 'paid'), 0);

  -- Credit already tied to THIS booking is shown as an offset against its
  -- balance everywhere in the UI, so the spendable "balance due" nets it out
  -- and we never re-spend it. The pool we consume is the diver's OTHER open
  -- credit (general credits + credits from other/cancelled bookings).
  v_self_cred := coalesce((select sum(amount) from public.credits
                           where booking_id = p_booking_id
                             and user_id = v_booking.user_id
                             and status = 'open'), 0);

  v_due := v_owed - v_paid - v_self_cred;
  if v_due <= 0 then
    return 0;
  end if;

  v_avail := coalesce((select sum(amount) from public.credits
                       where user_id = v_booking.user_id
                         and status = 'open'
                         and booking_id is distinct from p_booking_id), 0);
  if v_avail <= 0 then
    return 0;
  end if;

  v_apply := least(p_amount, v_due, v_avail);

  -- Consume open credit rows oldest-first. A row fully covered by the
  -- remaining need is settled; the row that straddles the boundary is
  -- settled in full and its unspent part carried forward as a new open row.
  v_remaining := v_apply;
  for c in
    select id, amount, reason, booking_id, currency, created_by
    from public.credits
    where user_id = v_booking.user_id
      and status = 'open'
      and booking_id is distinct from p_booking_id
    order by created_at asc, id asc
  loop
    exit when v_remaining <= 0;
    v_take := least(c.amount, v_remaining);

    update public.credits
    set status       = 'settled',
        settled_at   = now(),
        settled_note = 'Applied ' || c.currency || ' ' || v_take
                       || ' to booking ' || p_booking_id
                       || case when c.amount > v_take
                               then '; ' || c.currency || ' ' || (c.amount - v_take)
                                    || ' carried forward'
                               else '' end
    where id = c.id;

    if c.amount > v_take then
      insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by)
      values (v_booking.user_id, c.booking_id, c.amount - v_take, c.currency, c.reason, 'open', c.created_by);
    end if;

    v_remaining := v_remaining - v_take;
  end loop;

  insert into public.payments (user_id, booking_id, amount, status, method, note, recorded_by)
  values (
    v_booking.user_id, p_booking_id, v_apply,
    'paid', 'account_credit', 'Applied account credit', v_caller
  );

  -- Crossing the deposit threshold confirms a pending spot, matching
  -- recordPayment()'s promotion rule.
  v_deposit := coalesce((v_booking.details ->> 'deposit')::numeric, 0);
  if v_booking.status = 'pending' and (v_paid + v_apply) >= v_deposit then
    update public.bookings set status = 'confirmed' where id = p_booking_id;
  end if;

  return v_apply;
end;
$$;


ALTER FUNCTION "public"."apply_credit_to_booking"("p_booking_id" "uuid", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_admin_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Skip logging for service-role / migrations (auth.uid() is null), for
  -- the diver acting on their own row, and for the trigger's own internal
  -- calls if any (defensive).
  if auth.uid() is null or not public.is_admin() then
    return coalesce(new, old);
  end if;

  insert into public.admin_audit_log (actor_id, action, target_table, target_id, before, after)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce((new).id::text, (old).id::text),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."audit_admin_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_no_mutations"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  raise exception 'admin_audit_log rows are immutable'
    using errcode = 'insufficient_privilege';
end;
$$;


ALTER FUNCTION "public"."audit_log_no_mutations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_self_gear_size_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_staff_or_admin() then
    if new.fin_size     is distinct from old.fin_size
       or new.bcd_size     is distinct from old.bcd_size
       or new.wetsuit_size is distinct from old.wetsuit_size then
      raise exception 'Gear sizes can only be set by staff or admins'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."block_self_gear_size_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_self_privileged_profile_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.role           is distinct from old.role
     or new.status        is distinct from old.status
     or new.parent_account is distinct from old.parent_account then
    raise exception
      'role, status, and parent_account are admin-managed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."block_self_privileged_profile_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bookings_block_diver_detail_edits"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.details is not distinct from old.details then
    return new;
  end if;

  -- auth.uid() is null under service-role / superuser contexts (migrations,
  -- workers, dashboard SQL editor). Those callers are trusted to edit freely.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    raise exception 'bookings.details is locked after submission; contact staff to change it'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."bookings_block_diver_detail_edits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bookings_validate_payer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_parent uuid;
begin
  if new.payer_id is not null and new.payer_id <> new.user_id then
    select parent_account into v_parent from public.profiles where id = new.user_id;
    if v_parent is null or v_parent <> new.payer_id then
      raise exception 'payer_id must be the diver themselves or their parent account'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."bookings_validate_payer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capacity_suffix"("p_capacity" integer, "p_fully_booked" boolean, "p_confirmed" integer) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  v_remaining int;
begin
  if coalesce(p_fully_booked, false) then
    return ' (fully booked -- register for waitlist)';
  end if;
  if p_capacity is null then
    return '';
  end if;
  v_remaining := greatest(0, p_capacity - coalesce(p_confirmed, 0));
  if v_remaining = 0 then return ' (fully booked -- register for waitlist)'; end if;
  if v_remaining = 1 then return ' (1 spot open)'; end if;
  if v_remaining = 2 then return ' (2 spots open)'; end if;
  return '';
end;
$$;


ALTER FUNCTION "public"."capacity_suffix"("p_capacity" integer, "p_fully_booked" boolean, "p_confirmed" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cascade_profile_delete_to_auth_users"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  delete from auth.users where id = old.id;
  return old;
end;
$$;


ALTER FUNCTION "public"."cascade_profile_delete_to_auth_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."diver_notes_freeze_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.profile_id is distinct from old.profile_id then
    raise exception 'diver_notes.profile_id is immutable';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'diver_notes.created_by is immutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'diver_notes.created_at is immutable';
  end if;
  return new;
end
$$;


ALTER FUNCTION "public"."diver_notes_freeze_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."duties_enforce_assignee_is_admin"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.assignee_id and role in ('admin','staff')
  ) then
    raise exception 'duties.assignee_id must reference a profile with role in (admin, staff) (got %)', new.assignee_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."duties_enforce_assignee_is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."duties_enforce_no_busy_overlap"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  duty_end date := coalesce(new.end_date, new.start_date);
begin
  if exists (
    select 1 from public.staff_availability sa
    where sa.user_id = new.assignee_id
      and sa.start_date <= duty_end
      and sa.end_date   >= new.start_date
  ) then
    raise exception 'duties: assignee % is marked busy during % .. %', new.assignee_id, new.start_date, duty_end
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."duties_enforce_no_busy_overlap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eo_event_normalize_display_title"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_base      text;
  v_confirmed int;
begin
  v_base := public.strip_capacity_suffix(new.display_title);
  v_confirmed := public.event_confirmed_count_one(new.id);
  new.display_title := v_base || public.capacity_suffix(
    new.capacity, coalesce(new.fully_booked, false), v_confirmed
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."eo_event_normalize_display_title"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."event_confirmed_count_one"("p_event_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select count(*)::int from public.bookings
  where status = 'confirmed' and event_id = p_event_id;
$$;


ALTER FUNCTION "public"."event_confirmed_count_one"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."event_confirmed_counts"("p_event_ids" "uuid"[]) RETURNS TABLE("event_id" "uuid", "n" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select event_id, count(*)::int
  from public.bookings
  where status = 'confirmed' and event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
  group by event_id;
$$;


ALTER FUNCTION "public"."event_confirmed_counts"("p_event_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."event_ride_seats"("p_event_id" "uuid") RETURNS TABLE("capacity" integer, "claimed" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with fleet as (
    select v.passenger_seats
    from (select distinct vehicle_id from public.event_vehicles where event_id = p_event_id) ev
    join public.vehicles v on v.id = ev.vehicle_id
  ),
  crew as (
    select count(distinct assignee_id)::int as staff_count
    from public.duties
    where event_id = p_event_id
  )
  select
    greatest(
      0,
      coalesce((select sum(passenger_seats)::int from fleet), 0)
        - greatest(
            (select count(*)::int from fleet),
            (select staff_count from crew)
          )
    ) as capacity,
    coalesce((
      select count(*)::int
      from public.bookings
      where status <> 'cancelled'
        and (details->>'transportation') = 'true'
        and event_id = p_event_id
    ), 0) as claimed;
$$;


ALTER FUNCTION "public"."event_ride_seats"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."express_package_interest"("p_package_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_diver  uuid := auth.uid();
  v_status text;
  v_code   text;
begin
  if v_diver is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.packages where id = p_package_id;
  if v_status is null then
    raise exception 'package not found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'published' then
    raise exception 'package is not open for interest' using errcode = 'check_violation';
  end if;

  select referral_code into v_code from public.package_referrals
    where package_id = p_package_id and diver_id = v_diver and status <> 'cancelled'
    limit 1;
  if v_code is not null then
    return v_code;
  end if;

  insert into public.package_referrals (package_id, diver_id)
    values (p_package_id, v_diver)
    returning referral_code into v_code;
  return v_code;
end;
$$;


ALTER FUNCTION "public"."express_package_interest"("p_package_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_referral_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  code text;
  i int;
begin
  loop
    code := 'FD-';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.package_referrals where referral_code = code);
  end loop;
  return code;
end;
$$;


ALTER FUNCTION "public"."gen_referral_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_booking_cancellation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.waitlist_offers set status = 'expired'
     where booking_id = new.id and status = 'pending';
    if old.status in ('pending', 'confirmed') and new.event_id is not null then
      perform public.offer_next_waitlist_spot(new.event_id);
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_booking_cancellation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  consented  bool := new.raw_user_meta_data ? 'agreed_to_terms_at';
  client_ver int  := nullif(new.raw_user_meta_data ->> 'agreed_to_terms_version', '')::int;
begin
  insert into public.profiles (id, email, agreed_to_terms_at, agreed_to_terms_version)
  values (
    new.id,
    new.email,
    case when consented then now() else null end,
    case when consented then coalesce(client_ver, 1) else null end
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_user"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  )
$$;


ALTER FUNCTION "public"."is_active_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff_or_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','staff')
  )
$$;


ALTER FUNCTION "public"."is_staff_or_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_my_package_referrals"() RETURNS TABLE("id" "uuid", "package_id" "uuid", "referral_code" "text", "status" "text", "created_at" timestamp with time zone, "package_title" "text", "package_destination" "text", "partner_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    r.id, r.package_id, r.referral_code, r.status, r.created_at,
    p.title, p.destination, tp.name
  from public.package_referrals r
  join public.packages p           on p.id = r.package_id
  join public.trusted_partners tp  on tp.id = p.trusted_partner_id
  where r.diver_id = auth.uid()
$$;


ALTER FUNCTION "public"."list_my_package_referrals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_package_board"() RETURNS TABLE("id" "uuid", "title" "text", "destination" "text", "summary" "text", "description" "text", "start_date" "date", "end_date" "date", "price" numeric, "currency" "text", "hero_image_url" "text", "highlights" "text"[], "booking_url" "text", "published_at" timestamp with time zone, "trusted_partner_id" "uuid", "partner_name" "text", "partner_country" "text", "partner_location" "text", "partner_website" "text", "partner_logo_url" "text", "partner_vouch_notes" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    p.id, p.title, p.destination, p.summary, p.description,
    p.start_date, p.end_date, p.price, p.currency,
    p.hero_image_url, p.highlights, p.booking_url, p.published_at,
    tp.id, tp.name, tp.country, tp.location, tp.website, tp.logo_url, tp.vouch_notes
  from public.packages p
  join public.trusted_partners tp on tp.id = p.trusted_partner_id
  where p.status = 'published'
$$;


ALTER FUNCTION "public"."list_package_board"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_scheduled_trips"() RETURNS TABLE("id" "uuid", "title" "text", "destination" "text", "summary" "text", "description" "text", "start_date" "date", "end_date" "date", "price" numeric, "currency" "text", "hero_image_url" "text", "highlights" "text"[], "published_at" timestamp with time zone, "event_id" "uuid", "event_kind" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    s.id, s.title, s.destination, s.summary, s.description,
    s.start_date, s.end_date, s.price, s.currency,
    s.hero_image_url, s.highlights, s.published_at,
    s.event_id, e.kind
  from public.scheduled_trips s
  left join public.events e on e.id = s.event_id
  where s.status = 'published'
$$;


ALTER FUNCTION "public"."list_scheduled_trips"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_trusted_partners"() RETURNS TABLE("id" "uuid", "name" "text", "region" "text", "blurb" "text", "website" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id, name, coalesce(location, country) as region, vouch_notes as blurb, website
  from public.trusted_partners
  where active and contact_email is not null
  order by name
$$;


ALTER FUNCTION "public"."list_trusted_partners"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_orphan_auth_user"("p_user_id" "uuid", "p_email" "text", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.orphan_auth_users (user_id, email, reason)
  values (p_user_id, p_email, p_reason);
end;
$$;


ALTER FUNCTION "public"."log_orphan_auth_user"("p_user_id" "uuid", "p_email" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maybe_set_application_submitted_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.application_submitted_at is null
     and new.name           is not null and length(btrim(new.name))         > 0
     and new.date_of_birth   is not null
     and new.cert_level      is not null and length(btrim(new.cert_level))   > 0
     and new.contact_method  is not null
     and new.contact_id      is not null and length(btrim(new.contact_id))   > 0
  then
    new.application_submitted_at := now();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."maybe_set_application_submitted_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_parent_account"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select parent_account from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."my_parent_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_admins_ride_waitlist"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_event_id text;
  v_title    text;
  v_diver    text;
  v_body     text;
begin
  if coalesce(new.details->>'ride_waitlisted', '') <> 'true' then
    return new;
  end if;
  if coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.details->>'ride_waitlisted', '') = 'true' then
    return new;
  end if;

  v_event_id := new.event_id::text;
  select coalesce(display_title, admin_title) into v_title
  from public.events where id = new.event_id;

  select nullif(trim(name), '') into v_diver
  from public.profiles where id = new.user_id;

  v_body := coalesce(v_diver, 'A diver')
    || ' requested a ride for ' || coalesce(v_title, 'an event')
    || ', but the shop ride is full — add a car or arrange transport.';

  insert into public.notifications (user_id, title, body, url, kind, event_id)
  select p.id, 'Ride waitlist request', v_body, '/admin/logistics', 'ride_waitlist', v_event_id
  from public.profiles p
  where p.role = 'admin';

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_admins_ride_waitlist"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."offer_next_waitlist_spot"("p_event_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_booking_id uuid;
  v_offer_id   uuid;
begin
  select b.id into v_booking_id
  from public.bookings b
  where b.status = 'waitlisted' and b.event_id = p_event_id
    and not exists (select 1 from public.waitlist_offers o where o.booking_id = b.id and o.status = 'pending')
  order by b.created_at asc
  limit 1;
  if v_booking_id is null then return null; end if;
  insert into public.waitlist_offers (booking_id) values (v_booking_id)
    on conflict (booking_id) where status = 'pending' do nothing
  returning id into v_offer_id;
  return v_offer_id;
end;
$$;


ALTER FUNCTION "public"."offer_next_waitlist_spot"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."package_referrals_set_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.referral_code is null or new.referral_code = '' then
    new.referral_code := public.gen_referral_code();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."package_referrals_set_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiles_email_mirror_auth"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  new.email := (select email from auth.users where id = new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."profiles_email_mirror_auth"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiles_enforce_one_level_family"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_grandparent uuid;
begin
  if new.parent_account is not null then
    select parent_account into v_grandparent
    from public.profiles where id = new.parent_account;
    if v_grandparent is not null then
      raise exception 'parent_account must itself be a top-level diver (one-level family trees only)'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.profiles where parent_account = new.id) then
      raise exception 'cannot set parent_account on a diver who already has their own children'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."profiles_enforce_one_level_family"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_stale_pii"("older_than_months" integer DEFAULT 12) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."purge_stale_pii"("older_than_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_group_payment"("p_lead" "uuid", "p_amount" numeric, "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_caller    uuid    := auth.uid();
  v_remaining numeric;
  v_applied   numeric := 0;
  v_alloc     jsonb   := '{}'::jsonb;
  v_owed      numeric;
  v_paid      numeric;
  v_due       numeric;
  v_deposit   numeric;
  v_dep_due   numeric;
  v_so_far    numeric;
  v_take      numeric;
  v_method    text;
  b           record;
begin
  if v_caller is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;

  v_remaining := p_amount;

  -- Pass 1: cover each sibling's outstanding deposit, oldest first.
  for b in
    select id, details from public.bookings
    where payer_id = p_lead and status <> 'cancelled'
      and (p_group_id is null or group_id = p_group_id)
    order by created_at asc, id asc
  loop
    exit when v_remaining <= 0;
    v_paid := coalesce((select sum(amount) from public.payments
                        where booking_id = b.id and status = 'paid'), 0);
    v_owed := coalesce((b.details ->> 'total')::numeric, 0)
            + coalesce((select sum(amount) from public.booking_amendments
                        where booking_id = b.id), 0);
    v_due := v_owed - v_paid;
    if v_due <= 0 then continue; end if;
    v_deposit := coalesce((b.details ->> 'deposit')::numeric, 0);
    v_dep_due := least(greatest(v_deposit - v_paid, 0), v_due);
    if v_dep_due <= 0 then continue; end if;
    v_take := least(v_dep_due, v_remaining);
    v_alloc := jsonb_set(v_alloc, array[b.id::text],
                         to_jsonb(coalesce((v_alloc ->> b.id::text)::numeric, 0) + v_take));
    v_remaining := v_remaining - v_take;
  end loop;

  -- Pass 2: apply the rest against remaining balances, oldest first.
  for b in
    select id, details from public.bookings
    where payer_id = p_lead and status <> 'cancelled'
      and (p_group_id is null or group_id = p_group_id)
    order by created_at asc, id asc
  loop
    exit when v_remaining <= 0;
    v_paid := coalesce((select sum(amount) from public.payments
                        where booking_id = b.id and status = 'paid'), 0);
    v_owed := coalesce((b.details ->> 'total')::numeric, 0)
            + coalesce((select sum(amount) from public.booking_amendments
                        where booking_id = b.id), 0);
    v_so_far := coalesce((v_alloc ->> b.id::text)::numeric, 0);
    v_due := v_owed - v_paid - v_so_far;
    if v_due <= 0 then continue; end if;
    v_take := least(v_due, v_remaining);
    v_alloc := jsonb_set(v_alloc, array[b.id::text],
                         to_jsonb(v_so_far + v_take));
    v_remaining := v_remaining - v_take;
  end loop;

  -- Settle: one payment row per allocated booking; confirm pending spots
  -- whose deposit is now covered.
  for b in
    select id, user_id, status, details from public.bookings
    where payer_id = p_lead and status <> 'cancelled'
      and (p_group_id is null or group_id = p_group_id)
    order by created_at asc, id asc
  loop
    v_take := coalesce((v_alloc ->> b.id::text)::numeric, 0);
    if v_take <= 0 then continue; end if;
    v_method := b.details ->> 'payment_method';

    insert into public.payments (user_id, booking_id, amount, status, method, note, recorded_by)
    values (b.user_id, b.id, v_take, 'paid', v_method, 'Group payment', v_caller);
    v_applied := v_applied + v_take;

    v_paid := coalesce((select sum(amount) from public.payments
                        where booking_id = b.id and status = 'paid'), 0);
    v_deposit := coalesce((b.details ->> 'deposit')::numeric, 0);
    if b.status = 'pending' and v_paid >= v_deposit then
      update public.bookings set status = 'confirmed' where id = b.id;
    end if;
  end loop;

  return v_applied;
end;
$$;


ALTER FUNCTION "public"."record_group_payment"("p_lead" "uuid", "p_amount" numeric, "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_signup_attempt"("p_ip_hash" "bytea") RETURNS TABLE("in_last_60s" integer, "in_last_24h" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.signup_attempts (ip_hash) values (p_ip_hash);
  return query
    select
      count(*) filter (where created_at > now() - interval '60 seconds')::int,
      count(*) filter (where created_at > now() - interval '24 hours')::int
    from public.signup_attempts
    where ip_hash = p_ip_hash;
end;
$$;


ALTER FUNCTION "public"."record_signup_attempt"("p_ip_hash" "bytea") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_event_display_title"("p_event_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_current   text;
  v_capacity  int;
  v_fully     boolean;
  v_confirmed int;
  v_new_title text;
begin
  if p_event_id is null then return; end if;
  select display_title, capacity, coalesce(fully_booked, false)
    into v_current, v_capacity, v_fully
  from public.events where id = p_event_id;
  if v_current is null and v_capacity is null and not v_fully then return; end if;
  v_confirmed := public.event_confirmed_count_one(p_event_id);
  v_new_title := public.strip_capacity_suffix(coalesce(v_current, ''))
              || public.capacity_suffix(v_capacity, v_fully, v_confirmed);
  update public.events set display_title = v_new_title
   where id = p_event_id and display_title is distinct from v_new_title;
end;
$$;


ALTER FUNCTION "public"."refresh_event_display_title"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_gear_model_sizes"("p_model_id" "uuid", "p_sizes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  delete from public.gear_model_sizes where model_id = p_model_id;

  insert into public.gear_model_sizes
    (model_id, label, height_min, height_max, weight_min, weight_max, shoe_min, shoe_max, chest, waist, hip, sort_order)
  select
    p_model_id,
    s->>'label',
    nullif(s->>'height_min','')::numeric, nullif(s->>'height_max','')::numeric,
    nullif(s->>'weight_min','')::numeric, nullif(s->>'weight_max','')::numeric,
    nullif(s->>'shoe_min','')::numeric,   nullif(s->>'shoe_max','')::numeric,
    nullif(s->>'chest',''), nullif(s->>'waist',''), nullif(s->>'hip',''),
    coalesce(nullif(s->>'sort_order','')::int, (ord - 1)::int)
  from jsonb_array_elements(coalesce(p_sizes, '[]'::jsonb)) with ordinality as t(s, ord)
  where coalesce(s->>'label','') <> '';
end;
$$;


ALTER FUNCTION "public"."replace_gear_model_sizes"("p_model_id" "uuid", "p_sizes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_dive_log_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.dive_number is null then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));
    select coalesce(max(dive_number), 0) + 1
      into new.dive_number
      from public.dive_logs
      where user_id = new.user_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_dive_log_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_event_relations"("p_event_id" "uuid", "p_room_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_addon_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_destination_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.event_rooms where event_id = p_event_id;
  insert into public.event_rooms (event_id, room_id)
    select p_event_id, unnest(p_room_ids) on conflict do nothing;

  delete from public.event_addons where event_id = p_event_id;
  insert into public.event_addons (event_id, addon_id)
    select p_event_id, unnest(p_addon_ids) on conflict do nothing;

  delete from public.event_destinations where event_id = p_event_id;
  insert into public.event_destinations (event_id, destination_id)
    select p_event_id, unnest(p_destination_ids) on conflict do nothing;
end;
$$;


ALTER FUNCTION "public"."set_event_relations"("p_event_id" "uuid", "p_room_ids" "uuid"[], "p_addon_ids" "uuid"[], "p_destination_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_waitlisted_when_event_full"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_full      boolean := false;
  v_capacity  int;
  v_confirmed int;
begin
  if new.status = 'pending' and new.event_id is not null then
    select coalesce(fully_booked, false), capacity into v_full, v_capacity
      from public.events where id = new.event_id;
    if not v_full and v_capacity is not null then
      select count(*)::int into v_confirmed
        from public.bookings where status = 'confirmed' and event_id = new.event_id;
      if v_confirmed >= v_capacity then v_full := true; end if;
    end if;
    if v_full then new.status := 'waitlisted'; end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_waitlisted_when_event_full"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sign_waiver"("p_code" "text", "p_version" integer, "p_signed_name" "text", "p_event_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'must be authenticated' using errcode = 'insufficient_privilege'; end if;
  if p_code is null or char_length(p_code) = 0 then raise exception 'waiver code is required' using errcode = 'check_violation'; end if;
  if p_version is null or p_version < 1 then raise exception 'waiver version must be a positive integer' using errcode = 'check_violation'; end if;
  if p_signed_name is null or char_length(btrim(p_signed_name)) = 0 then raise exception 'signed name is required' using errcode = 'check_violation'; end if;

  insert into public.waiver_signatures
    (diver_id, waiver_code, waiver_version, signed_name, signed_at, event_id)
  values
    (auth.uid(), p_code, p_version, btrim(p_signed_name), now(), p_event_id)
  returning id into new_id;
  return new_id;
end;
$$;


ALTER FUNCTION "public"."sign_waiver"("p_code" "text", "p_version" integer, "p_signed_name" "text", "p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."staff_availability_enforce_owner_role"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.user_id and role in ('admin','staff')
  ) then
    raise exception 'staff_availability.user_id must reference a profile with role in (admin, staff) (got %)', new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."staff_availability_enforce_owner_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strip_capacity_suffix"("p_title" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  select regexp_replace(
    coalesce(p_title, ''),
    '\s*\((?:\d+\s*spots?\s*open|fully booked\s*[-–—]+\s*register for waitlist)\)\s*$',
    '',
    'i'
  );
$_$;


ALTER FUNCTION "public"."strip_capacity_suffix"("p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_profile_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_profile_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_dive_log_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_dive_log_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_staff_availability_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_staff_availability_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_bookings_refresh_event_title"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if TG_OP = 'INSERT' then
    if new.event_id is not null then perform public.refresh_event_display_title(new.event_id); end if;
  elsif TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      if coalesce(new.event_id, old.event_id) is not null then
        perform public.refresh_event_display_title(coalesce(new.event_id, old.event_id));
      end if;
    end if;
  elsif TG_OP = 'DELETE' then
    if old.event_id is not null then perform public.refresh_event_display_title(old.event_id); end if;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."trg_bookings_refresh_event_title"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_diver_gear_sizes"("diver_id" "uuid", "fin_size" "text", "bcd_size" "text", "wetsuit_size" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_staff_or_admin() then
    raise exception 'staff or admin required'
      using errcode = 'insufficient_privilege';
  end if;
  update public.profiles
  set fin_size     = nullif(btrim(coalesce(update_diver_gear_sizes.fin_size,     '')), ''),
      bcd_size     = nullif(btrim(coalesce(update_diver_gear_sizes.bcd_size,     '')), ''),
      wetsuit_size = nullif(btrim(coalesce(update_diver_gear_sizes.wetsuit_size, '')), '')
  where id = update_diver_gear_sizes.diver_id;
end;
$$;


ALTER FUNCTION "public"."update_diver_gear_sizes"("diver_id" "uuid", "fin_size" "text", "bcd_size" "text", "wetsuit_size" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wix_sync_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  tok       text;
  payload   jsonb;
begin
  select decrypted_secret into tok
    from vault.decrypted_secrets
   where name = 'wix_sync_token'
   limit 1;

  if tok is null then
    raise warning 'wix_sync_token missing from vault; skipping Wix sync for %.% (tg_op=%)',
      tg_table_schema, tg_table_name, tg_op;
    return coalesce(new, old);
  end if;

  -- Mirrors the Supabase database-webhook payload shape that
  -- supabase_functions.http_request produced. wix/backend/
  -- http-functions.js → post_supabaseWebhook reads
  -- type / table / record / old_record off this body.
  payload := jsonb_build_object(
    'type',       tg_op,
    'table',      tg_table_name,
    'schema',     tg_table_schema,
    'record',     case when tg_op <> 'DELETE' then to_jsonb(new) end,
    'old_record', case when tg_op <> 'INSERT' then to_jsonb(old) end
  );

  perform net.http_post(
    url := 'https://fundiverstw.com/_functions/supabaseWebhook',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-token', tok
    ),
    timeout_milliseconds := 5000
  );

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."wix_sync_notify"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."addons" (
    "admin_title" "text",
    "price" bigint,
    "display_title" "text",
    "currency" "text",
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."addons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "target_table" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "before" "jsonb",
    "after" "jsonb",
    CONSTRAINT "admin_audit_log_action_check" CHECK (("action" = ANY (ARRAY['insert'::"text", 'update'::"text", 'delete'::"text"])))
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "booking_id" "uuid",
    "tag" "text" NOT NULL,
    "content" "text" NOT NULL,
    "resolved" boolean DEFAULT false NOT NULL,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "event_id" "uuid",
    CONSTRAINT "admin_notes_content_check" CHECK ((("char_length"("content") >= 1) AND ("char_length"("content") <= 2000))),
    CONSTRAINT "admin_notes_resolved_consistency" CHECK (((("resolved" = true) AND ("resolved_by" IS NOT NULL) AND ("resolved_at" IS NOT NULL)) OR (("resolved" = false) AND ("resolved_by" IS NULL) AND ("resolved_at" IS NULL)))),
    CONSTRAINT "admin_notes_tag_check" CHECK (("tag" = ANY (ARRAY['urgent'::"text", 'payment'::"text", 'gear'::"text", 'logistics'::"text", 'cert'::"text", 'medical'::"text", 'note'::"text", 'general'::"text"]))),
    CONSTRAINT "admin_notes_target_present" CHECK ((((("event_id" IS NOT NULL))::integer + (("booking_id" IS NOT NULL))::integer) = 1))
);


ALTER TABLE "public"."admin_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_amendments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "amount" integer NOT NULL,
    "note" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_amendments_amount_check" CHECK (("amount" <> 0)),
    CONSTRAINT "booking_amendments_note_check" CHECK ((("length"("btrim"("note")) > 0) AND ("length"("note") <= 1000)))
);


ALTER TABLE "public"."booking_amendments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "notes" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "refund_requested_at" timestamp with time zone,
    "group_id" "uuid",
    "payer_id" "uuid",
    "event_id" "uuid" NOT NULL,
    CONSTRAINT "bookings_details_is_object" CHECK (("jsonb_typeof"("details") = 'object'::"text")),
    CONSTRAINT "bookings_event_present" CHECK (("event_id" IS NOT NULL)),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text", 'waitlisted'::"text"])))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cancellation_policies" (
    "id" "uuid" NOT NULL,
    "title" "text",
    "cancellation_policy" "text"
);


ALTER TABLE "public"."cancellation_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cert_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "name_zh" "text",
    "rank" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization" "text" NOT NULL,
    "padi_equivalent_id" "uuid",
    CONSTRAINT "cert_levels_rank_positive" CHECK (("rank" > 0))
);


ALTER TABLE "public"."cert_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "booking_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_by" "uuid",
    "settled_at" timestamp with time zone,
    "settled_note" "text",
    CONSTRAINT "credits_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "credits_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'settled'::"text"])))
);


ALTER TABLE "public"."credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dive_log_export_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dive_log_export_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dive_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "dive_number" integer NOT NULL,
    "dived_on" "date" NOT NULL,
    "site" "text" NOT NULL,
    "dive_type" "text",
    "max_depth_m" numeric(4,1),
    "dive_time_min" integer,
    "visibility_m" numeric(4,1),
    "water_temp_c" numeric(3,1),
    "air_temp_c" numeric(3,1),
    "weather" "text",
    "wave_height_m" numeric(3,1),
    "weight_kg" numeric(3,1),
    "gear_used" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "gas_mix" "text",
    "tank_size_l" numeric(3,1),
    "start_pressure_bar" integer,
    "end_pressure_bar" integer,
    "buddy_name" "text",
    "instructor_name" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dive_logs_depth_chk" CHECK ((("max_depth_m" IS NULL) OR (("max_depth_m" >= (0)::numeric) AND ("max_depth_m" <= (200)::numeric)))),
    CONSTRAINT "dive_logs_dive_time_chk" CHECK ((("dive_time_min" IS NULL) OR (("dive_time_min" >= 0) AND ("dive_time_min" <= 480)))),
    CONSTRAINT "dive_logs_dive_type_chk" CHECK ((("dive_type" IS NULL) OR ("dive_type" = ANY (ARRAY['shore'::"text", 'boat'::"text", 'training'::"text", 'drift'::"text", 'night'::"text", 'wreck'::"text", 'other'::"text"])))),
    CONSTRAINT "dive_logs_gas_mix_chk" CHECK ((("gas_mix" IS NULL) OR ("gas_mix" = ANY (ARRAY['air'::"text", 'EAN32'::"text", 'EAN36'::"text", 'other'::"text"])))),
    CONSTRAINT "dive_logs_pressure_chk" CHECK (((("start_pressure_bar" IS NULL) OR (("start_pressure_bar" >= 0) AND ("start_pressure_bar" <= 350))) AND (("end_pressure_bar" IS NULL) OR (("end_pressure_bar" >= 0) AND ("end_pressure_bar" <= 350)))))
);


ALTER TABLE "public"."dive_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."diver_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_by" "uuid",
    "edited_at" timestamp with time zone,
    CONSTRAINT "diver_notes_content_check" CHECK ((("char_length"("content") >= 1) AND ("char_length"("content") <= 2000)))
);


ALTER TABLE "public"."diver_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."duties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "assignee_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "notes" "text",
    "event_id" "uuid",
    CONSTRAINT "duties_date_order" CHECK ((("end_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "duties_notes_check" CHECK ((("notes" IS NULL) OR (("char_length"("notes") >= 1) AND ("char_length"("notes") <= 2000)))),
    CONSTRAINT "duties_role_check" CHECK (("role" = ANY (ARRAY['instructor'::"text", 'guide'::"text", 'support'::"text"])))
);


ALTER TABLE "public"."duties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_addons" (
    "event_id" "uuid" NOT NULL,
    "addon_id" "uuid" NOT NULL
);


ALTER TABLE "public"."event_addons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_destinations" (
    "event_id" "uuid" NOT NULL,
    "destination_id" "uuid" NOT NULL
);


ALTER TABLE "public"."event_destinations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_rooms" (
    "event_id" "uuid" NOT NULL,
    "room_id" "uuid" NOT NULL
);


ALTER TABLE "public"."event_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "vehicle_id" "uuid" NOT NULL,
    "notes" "text",
    "event_id" "uuid" NOT NULL,
    CONSTRAINT "event_vehicles_event_present" CHECK (("event_id" IS NOT NULL)),
    CONSTRAINT "event_vehicles_notes_check" CHECK ((("notes" IS NULL) OR (("char_length"("notes") >= 1) AND ("char_length"("notes") <= 2000))))
);


ALTER TABLE "public"."event_vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_waivers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "waiver_code" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "event_id" "uuid" NOT NULL,
    CONSTRAINT "event_waivers_event_present" CHECK (("event_id" IS NOT NULL)),
    CONSTRAINT "event_waivers_mode_check" CHECK (("mode" = ANY (ARRAY['require'::"text", 'exempt'::"text"]))),
    CONSTRAINT "event_waivers_waiver_code_check" CHECK ((("char_length"("waiver_code") >= 1) AND ("char_length"("waiver_code") <= 100)))
);


ALTER TABLE "public"."event_waivers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "legacy_id" "uuid",
    "kind" "text" NOT NULL,
    "admin_title" "text",
    "display_title" "text",
    "calendar_title" "text",
    "price" "uuid",
    "dive_days" bigint,
    "prereq_cert_id" "uuid",
    "cancel_date" "date",
    "cancel_policy" "uuid",
    "fully_booked" boolean DEFAULT false NOT NULL,
    "capacity" integer,
    "full_payment_deadline" "date",
    "cancelled_at" timestamp with time zone,
    "featured_image" "text",
    "prereqs" "text",
    "featured" boolean DEFAULT false NOT NULL,
    "req_dives" integer,
    "start_date" "date",
    "end_date" "date",
    "start_time" time without time zone,
    "course_days" "date"[],
    "is_private" boolean DEFAULT false NOT NULL,
    "nitrox_required" boolean DEFAULT false NOT NULL,
    "second_image" "text",
    "gear_rental" "text",
    "notes" "text",
    "trip_template_id" "uuid",
    "is_boat_dive" boolean DEFAULT false NOT NULL,
    "is_trip" boolean DEFAULT false NOT NULL,
    "course_name" "text",
    "included" "text",
    "schedule" "text",
    "starting_at" integer,
    CONSTRAINT "events_capacity_check" CHECK ((("capacity" IS NULL) OR ("capacity" >= 0))),
    CONSTRAINT "events_course_has_days" CHECK ((("kind" <> 'course'::"text") OR (("course_days" IS NOT NULL) AND (("array_length"("course_days", 1) >= 1) AND ("array_length"("course_days", 1) <= 4))))),
    CONSTRAINT "events_dive_has_start" CHECK ((("kind" <> 'dive'::"text") OR ("start_date" IS NOT NULL))),
    CONSTRAINT "events_kind_check" CHECK (("kind" = ANY (ARRAY['dive'::"text", 'course'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gear_model_sizes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "model_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "height_min" numeric,
    "height_max" numeric,
    "weight_min" numeric,
    "weight_max" numeric,
    "shoe_min" numeric,
    "shoe_max" numeric,
    "chest" "text",
    "waist" "text",
    "hip" "text",
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."gear_model_sizes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gear_models" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gear_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "brand" "text",
    "gender" "text",
    "size_unit" "text",
    "notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "gear_models_gear_type_check" CHECK (("gear_type" = ANY (ARRAY['wetsuit'::"text", 'bcd'::"text", 'fins'::"text"]))),
    CONSTRAINT "gear_models_gender_check" CHECK (("gender" = ANY (ARRAY['female'::"text", 'male'::"text", 'kids'::"text"]))),
    CONSTRAINT "gear_models_size_unit_check" CHECK (("size_unit" = ANY (ARRAY['jp'::"text", 'eu'::"text", 'us'::"text", 'uk'::"text", 'cm'::"text"])))
);


ALTER TABLE "public"."gear_models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "url" "text",
    "kind" "text" NOT NULL,
    "event_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orphan_auth_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."orphan_auth_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."package_referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "package_id" "uuid" NOT NULL,
    "diver_id" "uuid" NOT NULL,
    "referral_code" "text" NOT NULL,
    "status" "text" DEFAULT 'interested'::"text" NOT NULL,
    "booked_amount" numeric(10,2),
    "booked_currency" "text",
    "kickback_rate" numeric(5,4),
    "kickback_amount" numeric(12,2) GENERATED ALWAYS AS ("round"(("booked_amount" * "kickback_rate"), 2)) STORED,
    "kickback_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "received_at" timestamp with time zone,
    "admin_notes" "text",
    CONSTRAINT "trip_referrals_booked_amount_check" CHECK ((("booked_amount" IS NULL) OR ("booked_amount" >= (0)::numeric))),
    CONSTRAINT "trip_referrals_kickback_rate_check" CHECK ((("kickback_rate" IS NULL) OR (("kickback_rate" >= (0)::numeric) AND ("kickback_rate" <= (1)::numeric)))),
    CONSTRAINT "trip_referrals_kickback_status_check" CHECK (("kickback_status" = ANY (ARRAY['pending'::"text", 'invoiced'::"text", 'received'::"text"]))),
    CONSTRAINT "trip_referrals_status_check" CHECK (("status" = ANY (ARRAY['interested'::"text", 'introduced'::"text", 'booked'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."package_referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trusted_partner_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "destination" "text" NOT NULL,
    "summary" "text",
    "description" "text",
    "start_date" "date",
    "end_date" "date",
    "price" numeric(10,2),
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "hero_image_url" "text",
    "highlights" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "booking_url" "text",
    "kickback_rate" numeric(5,4) DEFAULT 0.05 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "published_at" timestamp with time zone,
    "created_by" "uuid",
    CONSTRAINT "trips_check" CHECK ((("end_date" IS NULL) OR ("start_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "trips_kickback_rate_check" CHECK ((("kickback_rate" >= (0)::numeric) AND ("kickback_rate" <= (1)::numeric))),
    CONSTRAINT "trips_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "booking_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "method" "text",
    "note" "text",
    "recorded_by" "uuid",
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'refunded'::"text", 'voided'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prices" (
    "admin_title" "text" NOT NULL,
    "price" "text",
    "starting_at" bigint,
    "deposit_amount" bigint,
    "transport" bigint,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "nickname" "text",
    "date_of_birth" "date",
    "nationality" "text",
    "id_number" "text",
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text",
    "cert_agency" "text",
    "cert_level" "text",
    "medical_notes" "text",
    "avatar_url" "text",
    "role" "text" DEFAULT 'diver'::"text" NOT NULL,
    "height_cm" numeric,
    "weight_kg" numeric,
    "shoe_size" "text",
    "gender" "text",
    "contact_method" "text",
    "contact_id" "text",
    "nitrox_certified" boolean DEFAULT false NOT NULL,
    "logged_dives" integer DEFAULT 0 NOT NULL,
    "last_dive_date" "date",
    "gear_owned" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "cert_card_path" "text",
    "agreed_to_terms_at" timestamp with time zone,
    "fin_size" "text",
    "bcd_size" "text",
    "wetsuit_size" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "application_submitted_at" timestamp with time zone,
    "parent_account" "uuid",
    "nitrox_card_path" "text",
    "deep_certified" boolean DEFAULT false NOT NULL,
    "deep_card_path" "text",
    "agreed_to_terms_version" integer,
    "email" "text",
    "uncertified" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_contact_method_check" CHECK (("contact_method" = ANY (ARRAY['whatsapp'::"text", 'line'::"text", 'phone'::"text", 'email'::"text"]))),
    CONSTRAINT "profiles_logged_dives_check" CHECK (("logged_dives" >= 0)),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['diver'::"text", 'admin'::"text", 'staff'::"text"]))),
    CONSTRAINT "profiles_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_notifications_sent" (
    "user_id" "uuid" NOT NULL,
    "event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_notifications_sent_event_type_check" CHECK (("event_type" = ANY (ARRAY['dive'::"text", 'course'::"text"]))),
    CONSTRAINT "push_notifications_sent_kind_check" CHECK (("kind" = ANY (ARRAY['event_7d'::"text", 'event_1d'::"text", 'payment_21d'::"text", 'payment_14d'::"text", 'payment_7d'::"text", 'payment_3d'::"text", 'payment_1d'::"text"])))
);


ALTER TABLE "public"."push_notifications_sent" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rooms" (
    "admin_title" "text",
    "display_title" "text",
    "added_price" bigint,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "currency" "text"
);


ALTER TABLE "public"."rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduled_trips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text" NOT NULL,
    "destination" "text" NOT NULL,
    "summary" "text",
    "description" "text",
    "start_date" "date",
    "end_date" "date",
    "price" numeric(10,2),
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "hero_image_url" "text",
    "highlights" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "published_at" timestamp with time zone,
    "event_id" "uuid",
    "created_by" "uuid",
    CONSTRAINT "scheduled_trips_check" CHECK ((("end_date" IS NULL) OR ("start_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "scheduled_trips_price_check" CHECK ((("price" IS NULL) OR ("price" >= (0)::numeric))),
    CONSTRAINT "scheduled_trips_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."scheduled_trips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signup_attempts" (
    "id" bigint NOT NULL,
    "ip_hash" "bytea" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."signup_attempts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."signup_attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."signup_attempts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."signup_attempts_id_seq" OWNED BY "public"."signup_attempts"."id";



CREATE TABLE IF NOT EXISTS "public"."staff_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_date" "date" NOT NULL,
    "title" "text" NOT NULL,
    "details" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_availability_date_order" CHECK (("end_date" >= "start_date")),
    CONSTRAINT "staff_availability_details_check" CHECK ((("details" IS NULL) OR ("char_length"("details") <= 2000))),
    CONSTRAINT "staff_availability_title_check" CHECK ((("char_length"("title") >= 1) AND ("char_length"("title") <= 200)))
);


ALTER TABLE "public"."staff_availability" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."staff_availability_view" WITH ("security_invoker"='on') AS
 SELECT "sa"."id",
    "sa"."user_id",
    "sa"."start_date",
    "sa"."start_time",
    "sa"."end_date",
        CASE
            WHEN ("sa"."user_id" = "auth"."uid"()) THEN "sa"."title"
            ELSE NULL::"text"
        END AS "title",
        CASE
            WHEN ("sa"."user_id" = "auth"."uid"()) THEN "sa"."details"
            ELSE NULL::"text"
        END AS "details",
    COALESCE("p"."nickname", "p"."name") AS "owner_display_name",
    "sa"."created_at",
    "sa"."updated_at"
   FROM ("public"."staff_availability" "sa"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "sa"."user_id")));


ALTER VIEW "public"."staff_availability_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."travel_destinations" (
    "id" "uuid" NOT NULL,
    "admin_title" "text",
    "slug" "text",
    "tagline" "text",
    "country" "text",
    "divetype" "text",
    "sort_order" integer,
    "international" boolean,
    "location_picture" "text",
    "background_picture" "text",
    "diver_requirements" "text"
);


ALTER TABLE "public"."travel_destinations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_templates" (
    "id" "uuid" NOT NULL,
    "admin_title" "text",
    "included" "text",
    "not_included" "text",
    "transportation" "text",
    "slug" "text",
    "event_type" "text",
    "picture" "text",
    "description" "text",
    "tagline" "text",
    "tagline_text" "text",
    "details" "text",
    "prerequisites" "text",
    "itinerary" "text",
    "event_date" "text",
    "price" "text",
    "sort_order" timestamp with time zone,
    "local" boolean,
    "trip" boolean,
    "trip_link" "text",
    "planned_trip" boolean,
    "details_document" "text",
    "local_event_link" "text"
);


ALTER TABLE "public"."trip_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trusted_partners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "country" "text",
    "location" "text",
    "website" "text",
    "contact_name" "text",
    "contact_email" "text",
    "vouch_notes" "text",
    "logo_url" "text",
    "default_kickback_rate" numeric(5,4) DEFAULT 0.05 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "partner_shops_default_kickback_rate_check" CHECK ((("default_kickback_rate" >= (0)::numeric) AND ("default_kickback_rate" <= (1)::numeric)))
);


ALTER TABLE "public"."trusted_partners" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "passenger_seats" integer NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "vehicles_passenger_seats_check" CHECK (("passenger_seats" >= 1))
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waitlist_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "offered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    "notified_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    CONSTRAINT "waitlist_offers_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."waitlist_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waiver_signatures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "diver_id" "uuid" NOT NULL,
    "waiver_code" "text" NOT NULL,
    "waiver_version" integer NOT NULL,
    "signed_name" "text" NOT NULL,
    "signed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_id" "uuid",
    CONSTRAINT "waiver_signatures_signed_name_check" CHECK ((("char_length"("signed_name") >= 1) AND ("char_length"("signed_name") <= 200))),
    CONSTRAINT "waiver_signatures_waiver_code_check" CHECK ((("char_length"("waiver_code") >= 1) AND ("char_length"("waiver_code") <= 100))),
    CONSTRAINT "waiver_signatures_waiver_version_check" CHECK (("waiver_version" > 0))
);


ALTER TABLE "public"."waiver_signatures" OWNER TO "postgres";


ALTER TABLE ONLY "public"."signup_attempts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."signup_attempts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."trip_templates"
    ADD CONSTRAINT "DiveTravel_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prices"
    ADD CONSTRAINT "EO_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "EO_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."addons"
    ADD CONSTRAINT "Other_Addons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."travel_destinations"
    ADD CONSTRAINT "TravelDestinations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_amendments"
    ADD CONSTRAINT "booking_amendments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cancellation_policies"
    ADD CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cert_levels"
    ADD CONSTRAINT "cert_levels_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."cert_levels"
    ADD CONSTRAINT "cert_levels_org_rank_unique" UNIQUE ("organization", "rank");



ALTER TABLE ONLY "public"."cert_levels"
    ADD CONSTRAINT "cert_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credits"
    ADD CONSTRAINT "credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dive_log_export_requests"
    ADD CONSTRAINT "dive_log_export_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dive_logs"
    ADD CONSTRAINT "dive_logs_dive_number_per_user" UNIQUE ("user_id", "dive_number");



ALTER TABLE ONLY "public"."dive_logs"
    ADD CONSTRAINT "dive_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."diver_notes"
    ADD CONSTRAINT "diver_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."duties"
    ADD CONSTRAINT "duties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_addons"
    ADD CONSTRAINT "event_addons_pkey" PRIMARY KEY ("event_id", "addon_id");



ALTER TABLE ONLY "public"."event_destinations"
    ADD CONSTRAINT "event_destinations_pkey" PRIMARY KEY ("event_id", "destination_id");



ALTER TABLE ONLY "public"."event_rooms"
    ADD CONSTRAINT "event_rooms_pkey" PRIMARY KEY ("event_id", "room_id");



ALTER TABLE ONLY "public"."event_vehicles"
    ADD CONSTRAINT "event_vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_waivers"
    ADD CONSTRAINT "event_waivers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_legacy_id_key" UNIQUE ("legacy_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gear_model_sizes"
    ADD CONSTRAINT "gear_model_sizes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gear_models"
    ADD CONSTRAINT "gear_models_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orphan_auth_users"
    ADD CONSTRAINT "orphan_auth_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trusted_partners"
    ADD CONSTRAINT "partner_shops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."profiles"
    ADD CONSTRAINT "profiles_no_self_parent" CHECK ((("parent_account" IS NULL) OR ("parent_account" <> "id"))) NOT VALID;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_notifications_sent"
    ADD CONSTRAINT "push_notifications_sent_pkey" PRIMARY KEY ("user_id", "event_id", "kind");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_trips"
    ADD CONSTRAINT "scheduled_trips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signup_attempts"
    ADD CONSTRAINT "signup_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_availability"
    ADD CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."package_referrals"
    ADD CONSTRAINT "trip_referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."package_referrals"
    ADD CONSTRAINT "trip_referrals_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "trips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waitlist_offers"
    ADD CONSTRAINT "waitlist_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_pkey" PRIMARY KEY ("id");



CREATE INDEX "admin_audit_log_actor_idx" ON "public"."admin_audit_log" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "admin_audit_log_recent_idx" ON "public"."admin_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "admin_audit_log_target_idx" ON "public"."admin_audit_log" USING "btree" ("target_table", "target_id", "created_at" DESC);



CREATE INDEX "admin_notes_booking_idx" ON "public"."admin_notes" USING "btree" ("booking_id") WHERE ("booking_id" IS NOT NULL);



CREATE INDEX "admin_notes_event_idx" ON "public"."admin_notes" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);



CREATE INDEX "admin_notes_open_idx" ON "public"."admin_notes" USING "btree" ("created_at" DESC) WHERE ("resolved" = false);



CREATE INDEX "booking_amendments_booking_idx" ON "public"."booking_amendments" USING "btree" ("booking_id", "created_at");



CREATE INDEX "bookings_group_id_idx" ON "public"."bookings" USING "btree" ("group_id") WHERE ("group_id" IS NOT NULL);



CREATE UNIQUE INDEX "bookings_one_active_per_user_idx" ON "public"."bookings" USING "btree" ("user_id", "event_id") WHERE (("event_id" IS NOT NULL) AND ("status" <> 'cancelled'::"text"));



CREATE INDEX "bookings_payer_id_idx" ON "public"."bookings" USING "btree" ("payer_id") WHERE ("payer_id" IS NOT NULL);



CREATE INDEX "credits_open_idx" ON "public"."credits" USING "btree" ("user_id") WHERE ("status" = 'open'::"text");



CREATE INDEX "credits_user_id_idx" ON "public"."credits" USING "btree" ("user_id");



CREATE INDEX "dive_log_export_requests_user_time_idx" ON "public"."dive_log_export_requests" USING "btree" ("user_id", "requested_at" DESC);



CREATE INDEX "dive_logs_user_dived_on_idx" ON "public"."dive_logs" USING "btree" ("user_id", "dived_on" DESC, "dive_number" DESC);



CREATE INDEX "diver_notes_profile_idx" ON "public"."diver_notes" USING "btree" ("profile_id", "created_at" DESC);



CREATE INDEX "duties_assignee_idx" ON "public"."duties" USING "btree" ("assignee_id", "start_date");



CREATE INDEX "duties_date_idx" ON "public"."duties" USING "btree" ("start_date");



CREATE INDEX "duties_event_idx" ON "public"."duties" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);



CREATE INDEX "event_vehicles_event_idx" ON "public"."event_vehicles" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);



CREATE UNIQUE INDEX "event_vehicles_event_vehicle_uniq" ON "public"."event_vehicles" USING "btree" ("event_id", "vehicle_id");



CREATE UNIQUE INDEX "event_waivers_event_code_uniq" ON "public"."event_waivers" USING "btree" ("event_id", "waiver_code") WHERE ("event_id" IS NOT NULL);



CREATE INDEX "events_active_idx" ON "public"."events" USING "btree" ("start_date") WHERE ("cancelled_at" IS NULL);



CREATE INDEX "events_course_days_idx" ON "public"."events" USING "gin" ("course_days");



CREATE INDEX "events_kind_start_idx" ON "public"."events" USING "btree" ("kind", "start_date");



CREATE INDEX "events_price_idx" ON "public"."events" USING "btree" ("price");



CREATE INDEX "gear_model_sizes_model_idx" ON "public"."gear_model_sizes" USING "btree" ("model_id");



CREATE INDEX "gear_models_type_active_idx" ON "public"."gear_models" USING "btree" ("gear_type", "active");



CREATE INDEX "notifications_user_created_idx" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "notifications_user_unread_idx" ON "public"."notifications" USING "btree" ("user_id") WHERE ("read_at" IS NULL);



CREATE INDEX "orphan_auth_users_created_idx" ON "public"."orphan_auth_users" USING "btree" ("created_at" DESC);



CREATE INDEX "package_referrals_diver_idx" ON "public"."package_referrals" USING "btree" ("diver_id");



CREATE UNIQUE INDEX "package_referrals_one_live_idx" ON "public"."package_referrals" USING "btree" ("package_id", "diver_id") WHERE ("status" <> 'cancelled'::"text");



CREATE INDEX "package_referrals_package_idx" ON "public"."package_referrals" USING "btree" ("package_id");



CREATE INDEX "packages_published_idx" ON "public"."packages" USING "btree" ("status", "start_date") WHERE ("status" = 'published'::"text");



CREATE INDEX "packages_trusted_partner_idx" ON "public"."packages" USING "btree" ("trusted_partner_id");



CREATE INDEX "profiles_parent_account_idx" ON "public"."profiles" USING "btree" ("parent_account") WHERE ("parent_account" IS NOT NULL);



CREATE INDEX "profiles_pending_submitted_idx" ON "public"."profiles" USING "btree" ("application_submitted_at" DESC) WHERE (("status" = 'pending'::"text") AND ("application_submitted_at" IS NOT NULL));



CREATE INDEX "profiles_status_pending_idx" ON "public"."profiles" USING "btree" ("created_at" DESC) WHERE ("status" = 'pending'::"text");



CREATE INDEX "push_subscriptions_user_id_idx" ON "public"."push_subscriptions" USING "btree" ("user_id");



CREATE INDEX "scheduled_trips_event_idx" ON "public"."scheduled_trips" USING "btree" ("event_id");



CREATE INDEX "scheduled_trips_published_idx" ON "public"."scheduled_trips" USING "btree" ("status", "start_date") WHERE ("status" = 'published'::"text");



CREATE INDEX "signup_attempts_created_idx" ON "public"."signup_attempts" USING "btree" ("created_at" DESC);



CREATE INDEX "signup_attempts_ip_recent_idx" ON "public"."signup_attempts" USING "btree" ("ip_hash", "created_at" DESC);



CREATE INDEX "staff_availability_range_idx" ON "public"."staff_availability" USING "btree" ("start_date", "end_date");



CREATE INDEX "staff_availability_user_idx" ON "public"."staff_availability" USING "btree" ("user_id", "start_date");



CREATE INDEX "trusted_partners_active_idx" ON "public"."trusted_partners" USING "btree" ("active") WHERE "active";



CREATE INDEX "waitlist_offers_booking_idx" ON "public"."waitlist_offers" USING "btree" ("booking_id");



CREATE UNIQUE INDEX "waitlist_offers_one_pending_per_booking_idx" ON "public"."waitlist_offers" USING "btree" ("booking_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "waitlist_offers_status_expires_idx" ON "public"."waitlist_offers" USING "btree" ("status", "expires_at");



CREATE INDEX "waiver_signatures_diver_code_idx" ON "public"."waiver_signatures" USING "btree" ("diver_id", "waiver_code");



CREATE INDEX "waiver_signatures_event_idx" ON "public"."waiver_signatures" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "admin_audit_log_block_delete" BEFORE DELETE ON "public"."admin_audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_no_mutations"();



CREATE OR REPLACE TRIGGER "admin_audit_log_block_update" BEFORE UPDATE ON "public"."admin_audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_no_mutations"();



CREATE OR REPLACE TRIGGER "bookings_admin_audit_trg" AFTER INSERT OR DELETE OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."audit_admin_write"();



CREATE OR REPLACE TRIGGER "bookings_detail_lock_trg" BEFORE UPDATE OF "details" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."bookings_block_diver_detail_edits"();



CREATE OR REPLACE TRIGGER "diver_notes_freeze_identity" BEFORE UPDATE ON "public"."diver_notes" FOR EACH ROW EXECUTE FUNCTION "public"."diver_notes_freeze_identity"();



CREATE OR REPLACE TRIGGER "duties_assignee_admin_trg" BEFORE INSERT OR UPDATE OF "assignee_id" ON "public"."duties" FOR EACH ROW EXECUTE FUNCTION "public"."duties_enforce_assignee_is_admin"();



CREATE OR REPLACE TRIGGER "duties_no_busy_overlap_trg" BEFORE INSERT OR UPDATE OF "assignee_id", "start_date", "end_date" ON "public"."duties" FOR EACH ROW EXECUTE FUNCTION "public"."duties_enforce_no_busy_overlap"();



CREATE OR REPLACE TRIGGER "notify_admins_ride_waitlist_trg" AFTER INSERT OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."notify_admins_ride_waitlist"();



CREATE OR REPLACE TRIGGER "profiles_admin_audit_trg" AFTER INSERT OR DELETE OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."audit_admin_write"();



CREATE OR REPLACE TRIGGER "profiles_block_self_gear_size_trg" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."block_self_gear_size_change"();



CREATE OR REPLACE TRIGGER "profiles_block_self_privileged_change_trg" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."block_self_privileged_profile_change"();



CREATE OR REPLACE TRIGGER "profiles_cascade_delete_to_auth_users_trg" AFTER DELETE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_profile_delete_to_auth_users"();



CREATE OR REPLACE TRIGGER "profiles_email_mirror_auth_trg" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_email_mirror_auth"();



CREATE OR REPLACE TRIGGER "profiles_maybe_set_submitted_at_trg" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."maybe_set_application_submitted_at"();



CREATE OR REPLACE TRIGGER "staff_availability_owner_role_trg" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."staff_availability" FOR EACH ROW EXECUTE FUNCTION "public"."staff_availability_enforce_owner_role"();



CREATE OR REPLACE TRIGGER "trg_bookings_cancellation_offer_next" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_booking_cancellation"();



CREATE OR REPLACE TRIGGER "trg_bookings_refresh_title" AFTER INSERT OR DELETE OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_bookings_refresh_event_title"();



CREATE OR REPLACE TRIGGER "trg_bookings_set_waitlisted_when_full" BEFORE INSERT ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."set_waitlisted_when_event_full"();



CREATE OR REPLACE TRIGGER "trg_bookings_validate_payer" BEFORE INSERT OR UPDATE OF "payer_id" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."bookings_validate_payer"();



CREATE OR REPLACE TRIGGER "trg_dive_logs_set_number" BEFORE INSERT ON "public"."dive_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_dive_log_number"();



CREATE OR REPLACE TRIGGER "trg_dive_logs_touch_updated_at" BEFORE UPDATE ON "public"."dive_logs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_dive_log_updated_at"();



CREATE OR REPLACE TRIGGER "trg_events_normalize_title" BEFORE INSERT OR UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."eo_event_normalize_display_title"();



CREATE OR REPLACE TRIGGER "trg_package_referrals_set_code" BEFORE INSERT ON "public"."package_referrals" FOR EACH ROW EXECUTE FUNCTION "public"."package_referrals_set_code"();



CREATE OR REPLACE TRIGGER "trg_profiles_one_level_family" BEFORE INSERT OR UPDATE OF "parent_account" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_enforce_one_level_family"();



CREATE OR REPLACE TRIGGER "trg_staff_availability_touch_updated_at" BEFORE UPDATE ON "public"."staff_availability" FOR EACH ROW EXECUTE FUNCTION "public"."touch_staff_availability_updated_at"();



CREATE OR REPLACE TRIGGER "wix_sync_cancellation_policies" AFTER INSERT OR DELETE OR UPDATE ON "public"."cancellation_policies" FOR EACH ROW EXECUTE FUNCTION "public"."wix_sync_notify"();



CREATE OR REPLACE TRIGGER "wix_sync_cert_levels" AFTER INSERT OR DELETE OR UPDATE ON "public"."cert_levels" FOR EACH ROW EXECUTE FUNCTION "public"."wix_sync_notify"();



CREATE OR REPLACE TRIGGER "wix_sync_eo_prices" AFTER INSERT OR DELETE OR UPDATE ON "public"."prices" FOR EACH ROW EXECUTE FUNCTION "public"."wix_sync_notify"();



CREATE OR REPLACE TRIGGER "wix_sync_eo_rooms" AFTER INSERT OR DELETE OR UPDATE ON "public"."rooms" FOR EACH ROW EXECUTE FUNCTION "public"."wix_sync_notify"();



CREATE OR REPLACE TRIGGER "wix_sync_other_addons" AFTER INSERT OR DELETE OR UPDATE ON "public"."addons" FOR EACH ROW EXECUTE FUNCTION "public"."wix_sync_notify"();



CREATE OR REPLACE TRIGGER "wix_sync_trip_templates" AFTER INSERT OR DELETE OR UPDATE ON "public"."trip_templates" FOR EACH ROW EXECUTE FUNCTION "public"."wix_sync_notify"();



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."booking_amendments"
    ADD CONSTRAINT "booking_amendments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_amendments"
    ADD CONSTRAINT "booking_amendments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cert_levels"
    ADD CONSTRAINT "cert_levels_padi_equivalent_id_fkey" FOREIGN KEY ("padi_equivalent_id") REFERENCES "public"."cert_levels"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."credits"
    ADD CONSTRAINT "credits_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."credits"
    ADD CONSTRAINT "credits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."credits"
    ADD CONSTRAINT "credits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dive_log_export_requests"
    ADD CONSTRAINT "dive_log_export_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dive_logs"
    ADD CONSTRAINT "dive_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."diver_notes"
    ADD CONSTRAINT "diver_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."diver_notes"
    ADD CONSTRAINT "diver_notes_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."diver_notes"
    ADD CONSTRAINT "diver_notes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."duties"
    ADD CONSTRAINT "duties_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."duties"
    ADD CONSTRAINT "duties_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."duties"
    ADD CONSTRAINT "duties_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_addons"
    ADD CONSTRAINT "event_addons_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "public"."addons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_addons"
    ADD CONSTRAINT "event_addons_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_destinations"
    ADD CONSTRAINT "event_destinations_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."travel_destinations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_destinations"
    ADD CONSTRAINT "event_destinations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_rooms"
    ADD CONSTRAINT "event_rooms_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_rooms"
    ADD CONSTRAINT "event_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_vehicles"
    ADD CONSTRAINT "event_vehicles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_vehicles"
    ADD CONSTRAINT "event_vehicles_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_vehicles"
    ADD CONSTRAINT "event_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_waivers"
    ADD CONSTRAINT "event_waivers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_waivers"
    ADD CONSTRAINT "event_waivers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_cancel_policy_fkey" FOREIGN KEY ("cancel_policy") REFERENCES "public"."cancellation_policies"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_prereq_cert_id_fkey" FOREIGN KEY ("prereq_cert_id") REFERENCES "public"."cert_levels"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_price_fkey" FOREIGN KEY ("price") REFERENCES "public"."prices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_trip_template_id_fkey" FOREIGN KEY ("trip_template_id") REFERENCES "public"."trip_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gear_model_sizes"
    ADD CONSTRAINT "gear_model_sizes_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."gear_models"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gear_models"
    ADD CONSTRAINT "gear_models_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trusted_partners"
    ADD CONSTRAINT "partner_shops_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_parent_account_fkey" FOREIGN KEY ("parent_account") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_notifications_sent"
    ADD CONSTRAINT "push_notifications_sent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_trips"
    ADD CONSTRAINT "scheduled_trips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."scheduled_trips"
    ADD CONSTRAINT "scheduled_trips_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_availability"
    ADD CONSTRAINT "staff_availability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."package_referrals"
    ADD CONSTRAINT "trip_referrals_diver_id_fkey" FOREIGN KEY ("diver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."package_referrals"
    ADD CONSTRAINT "trip_referrals_trip_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "trips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "trips_partner_shop_id_fkey" FOREIGN KEY ("trusted_partner_id") REFERENCES "public"."trusted_partners"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."waitlist_offers"
    ADD CONSTRAINT "waitlist_offers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_diver_id_fkey" FOREIGN KEY ("diver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE "public"."addons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "addons: admin delete" ON "public"."addons" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "addons: admin insert" ON "public"."addons" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "addons: admin update" ON "public"."addons" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "addons: public select" ON "public"."addons" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_audit_log: admin select" ON "public"."admin_audit_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."admin_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_notes: admin delete" ON "public"."admin_notes" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_notes: admin update" ON "public"."admin_notes" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_notes: staff_or_admin insert" ON "public"."admin_notes" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_staff_or_admin"() AND ("created_by" = "auth"."uid"())));



CREATE POLICY "admin_notes: staff_or_admin select" ON "public"."admin_notes" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."booking_amendments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking_amendments: admin insert" ON "public"."booking_amendments" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND ("created_by" = "auth"."uid"())));



CREATE POLICY "booking_amendments: diver select own" ON "public"."booking_amendments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "booking_amendments"."booking_id") AND ("b"."user_id" = "auth"."uid"())))));



CREATE POLICY "booking_amendments: staff_or_admin select" ON "public"."booking_amendments" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bookings: admin update" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bookings: parent insert for children" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_user"() AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "bookings"."user_id") AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "bookings: parent select children" ON "public"."bookings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "bookings"."user_id") AND ("p"."parent_account" = "auth"."uid"())))));



CREATE POLICY "bookings: parent update children" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "bookings"."user_id") AND ("p"."parent_account" = "auth"."uid"())))));



CREATE POLICY "bookings: self insert" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"()));



CREATE POLICY "bookings: self select" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "bookings: self update" ON "public"."bookings" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "bookings: staff_or_admin select" ON "public"."bookings" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."cancellation_policies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cancellation_policies: admin delete" ON "public"."cancellation_policies" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "cancellation_policies: admin insert" ON "public"."cancellation_policies" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "cancellation_policies: admin update" ON "public"."cancellation_policies" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "cancellation_policies: public select" ON "public"."cancellation_policies" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."cert_levels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cert_levels: admin delete" ON "public"."cert_levels" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "cert_levels: admin insert" ON "public"."cert_levels" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "cert_levels: admin update" ON "public"."cert_levels" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "cert_levels: public select" ON "public"."cert_levels" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."credits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credits: admin delete" ON "public"."credits" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "credits: admin insert" ON "public"."credits" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "credits: admin update" ON "public"."credits" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "credits: diver select own" ON "public"."credits" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "credits: staff_or_admin select" ON "public"."credits" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."dive_log_export_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dive_log_export_requests: own select" ON "public"."dive_log_export_requests" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."dive_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dive_logs: own delete" ON "public"."dive_logs" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "dive_logs: own insert" ON "public"."dive_logs" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "dive_logs: own select" ON "public"."dive_logs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "dive_logs: own update" ON "public"."dive_logs" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."diver_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "diver_notes: admin or self delete" ON "public"."diver_notes" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("created_by" = "auth"."uid"())));



CREATE POLICY "diver_notes: admin or self update" ON "public"."diver_notes" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("created_by" = "auth"."uid"()))) WITH CHECK (("public"."is_admin"() OR ("created_by" = "auth"."uid"())));



CREATE POLICY "diver_notes: staff_or_admin insert" ON "public"."diver_notes" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_staff_or_admin"() AND ("created_by" = "auth"."uid"())));



CREATE POLICY "diver_notes: staff_or_admin select" ON "public"."diver_notes" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."duties" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "duties: admin delete" ON "public"."duties" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "duties: admin insert" ON "public"."duties" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "duties: admin select" ON "public"."duties" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "duties: admin update" ON "public"."duties" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "duties: staff select own" ON "public"."duties" FOR SELECT TO "authenticated" USING (("assignee_id" = "auth"."uid"()));



ALTER TABLE "public"."event_addons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_addons admin delete" ON "public"."event_addons" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "event_addons admin insert" ON "public"."event_addons" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "event_addons admin update" ON "public"."event_addons" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "event_addons public select" ON "public"."event_addons" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."event_destinations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_destinations admin delete" ON "public"."event_destinations" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "event_destinations admin insert" ON "public"."event_destinations" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "event_destinations admin update" ON "public"."event_destinations" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "event_destinations public select" ON "public"."event_destinations" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."event_rooms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_rooms admin delete" ON "public"."event_rooms" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "event_rooms admin insert" ON "public"."event_rooms" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "event_rooms admin update" ON "public"."event_rooms" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "event_rooms public select" ON "public"."event_rooms" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."event_vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_vehicles: admin manage" ON "public"."event_vehicles" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "event_vehicles: staff_or_admin read" ON "public"."event_vehicles" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."event_waivers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_waivers: admin manage" ON "public"."event_waivers" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "event_waivers: authenticated read" ON "public"."event_waivers" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events admin delete" ON "public"."events" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "events admin insert" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "events admin update" ON "public"."events" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "events public select" ON "public"."events" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."gear_model_sizes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gear_model_sizes: admin write" ON "public"."gear_model_sizes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "gear_model_sizes: staff read" ON "public"."gear_model_sizes" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."gear_models" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gear_models: admin write" ON "public"."gear_models" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "gear_models: staff read" ON "public"."gear_models" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications: own select" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications: own update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."orphan_auth_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."package_referrals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "package_referrals: admin manage" ON "public"."package_referrals" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packages: admin manage" ON "public"."packages" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments: admin insert" ON "public"."payments" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "payments: admin update" ON "public"."payments" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "payments: parent select children" ON "public"."payments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "payments"."user_id") AND ("p"."parent_account" = "auth"."uid"())))));



CREATE POLICY "payments: self select" ON "public"."payments" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "payments: staff_or_admin select" ON "public"."payments" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."prices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prices: admin delete" ON "public"."prices" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "prices: admin insert" ON "public"."prices" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "prices: admin update" ON "public"."prices" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "prices: public select" ON "public"."prices" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles: admin update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "profiles: child select parent" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "public"."my_parent_account"()));



CREATE POLICY "profiles: parent select children" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("parent_account" = "auth"."uid"()));



CREATE POLICY "profiles: parent update children" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("parent_account" = "auth"."uid"())) WITH CHECK (("parent_account" = "auth"."uid"()));



CREATE POLICY "profiles: self select" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles: self update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "profiles: staff_or_admin select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."push_notifications_sent" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subs: user deletes own" ON "public"."push_subscriptions" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "push_subs: user reads own" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "push_subs: user updates own" ON "public"."push_subscriptions" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rooms: admin delete" ON "public"."rooms" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "rooms: admin insert" ON "public"."rooms" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "rooms: admin update" ON "public"."rooms" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rooms: public select" ON "public"."rooms" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."scheduled_trips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scheduled_trips: admin manage" ON "public"."scheduled_trips" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."signup_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_availability" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_availability: delete own" ON "public"."staff_availability" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."is_staff_or_admin"()));



CREATE POLICY "staff_availability: insert own" ON "public"."staff_availability" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_staff_or_admin"()));



CREATE POLICY "staff_availability: select own or admin" ON "public"."staff_availability" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "staff_availability: update own" ON "public"."staff_availability" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."is_staff_or_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_staff_or_admin"()));



ALTER TABLE "public"."travel_destinations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "travel_destinations: admin delete" ON "public"."travel_destinations" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "travel_destinations: admin insert" ON "public"."travel_destinations" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "travel_destinations: admin update" ON "public"."travel_destinations" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "travel_destinations: public select" ON "public"."travel_destinations" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."trip_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trip_templates: admin delete" ON "public"."trip_templates" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "trip_templates: admin insert" ON "public"."trip_templates" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "trip_templates: admin update" ON "public"."trip_templates" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "trip_templates: public select" ON "public"."trip_templates" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."trusted_partners" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trusted_partners: admin manage" ON "public"."trusted_partners" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "user inserts own push sub" ON "public"."push_subscriptions" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"()));



ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicles: admin manage" ON "public"."vehicles" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "vehicles: staff_or_admin read" ON "public"."vehicles" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."waitlist_offers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "waitlist_offers: own select" ON "public"."waitlist_offers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "waitlist_offers"."booking_id") AND ("b"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."waiver_signatures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "waiver_signatures: admin manage" ON "public"."waiver_signatures" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "waiver_signatures: self read" ON "public"."waiver_signatures" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "diver_id"));



CREATE POLICY "waiver_signatures: staff_or_admin read" ON "public"."waiver_signatures" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";































































































































































REVOKE ALL ON FUNCTION "public"."accept_current_terms"("p_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_current_terms"("p_version" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."accept_waitlist_offer"("p_offer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_waitlist_offer"("p_offer_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_delete_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_user"("p_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."apply_credit_to_booking"("p_booking_id" "uuid", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_credit_to_booking"("p_booking_id" "uuid", "p_amount" numeric) TO "authenticated";



GRANT ALL ON FUNCTION "public"."event_confirmed_count_one"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."event_confirmed_count_one"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."event_confirmed_count_one"("p_event_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."event_confirmed_counts"("p_event_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."event_confirmed_counts"("p_event_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."event_confirmed_counts"("p_event_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."event_ride_seats"("p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."event_ride_seats"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."event_ride_seats"("p_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."express_package_interest"("p_package_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."express_package_interest"("p_package_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_active_user"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."list_my_package_referrals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_my_package_referrals"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_my_package_referrals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_package_board"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_package_board"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_package_board"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_scheduled_trips"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_scheduled_trips"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_scheduled_trips"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_trusted_partners"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_trusted_partners"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_trusted_partners"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_orphan_auth_user"("p_user_id" "uuid", "p_email" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_orphan_auth_user"("p_user_id" "uuid", "p_email" "text", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."my_parent_account"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."notify_admins_ride_waitlist"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_admins_ride_waitlist"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_admins_ride_waitlist"() TO "service_role";



GRANT ALL ON FUNCTION "public"."offer_next_waitlist_spot"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."offer_next_waitlist_spot"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."offer_next_waitlist_spot"("p_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_stale_pii"("older_than_months" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_stale_pii"("older_than_months" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_group_payment"("p_lead" "uuid", "p_amount" numeric, "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_group_payment"("p_lead" "uuid", "p_amount" numeric, "p_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_signup_attempt"("p_ip_hash" "bytea") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_signup_attempt"("p_ip_hash" "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_event_display_title"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_event_display_title"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_event_display_title"("p_event_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."replace_gear_model_sizes"("p_model_id" "uuid", "p_sizes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_gear_model_sizes"("p_model_id" "uuid", "p_sizes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_gear_model_sizes"("p_model_id" "uuid", "p_sizes" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_event_relations"("p_event_id" "uuid", "p_room_ids" "uuid"[], "p_addon_ids" "uuid"[], "p_destination_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_event_relations"("p_event_id" "uuid", "p_room_ids" "uuid"[], "p_addon_ids" "uuid"[], "p_destination_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."set_event_relations"("p_event_id" "uuid", "p_room_ids" "uuid"[], "p_addon_ids" "uuid"[], "p_destination_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_event_relations"("p_event_id" "uuid", "p_room_ids" "uuid"[], "p_addon_ids" "uuid"[], "p_destination_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sign_waiver"("p_code" "text", "p_version" integer, "p_signed_name" "text", "p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sign_waiver"("p_code" "text", "p_version" integer, "p_signed_name" "text", "p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sign_waiver"("p_code" "text", "p_version" integer, "p_signed_name" "text", "p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sign_waiver"("p_code" "text", "p_version" integer, "p_signed_name" "text", "p_event_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_diver_gear_sizes"("diver_id" "uuid", "fin_size" "text", "bcd_size" "text", "wetsuit_size" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."wix_sync_notify"() FROM PUBLIC;


















GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."addons" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."addons" TO "authenticated";
GRANT ALL ON TABLE "public"."addons" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_audit_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_audit_log" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_notes" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_notes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_notes" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_amendments" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_amendments" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_amendments" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bookings" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bookings" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bookings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cancellation_policies" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cancellation_policies" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cancellation_policies" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cert_levels" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cert_levels" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cert_levels" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credits" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credits" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credits" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dive_log_export_requests" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dive_log_export_requests" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dive_log_export_requests" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dive_logs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dive_logs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dive_logs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."diver_notes" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."diver_notes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."diver_notes" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."duties" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."duties" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."duties" TO "service_role";



GRANT ALL ON TABLE "public"."event_addons" TO "anon";
GRANT ALL ON TABLE "public"."event_addons" TO "authenticated";
GRANT ALL ON TABLE "public"."event_addons" TO "service_role";



GRANT ALL ON TABLE "public"."event_destinations" TO "anon";
GRANT ALL ON TABLE "public"."event_destinations" TO "authenticated";
GRANT ALL ON TABLE "public"."event_destinations" TO "service_role";



GRANT ALL ON TABLE "public"."event_rooms" TO "anon";
GRANT ALL ON TABLE "public"."event_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."event_rooms" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."event_vehicles" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."event_vehicles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."event_vehicles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."event_waivers" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."event_waivers" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."event_waivers" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gear_model_sizes" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gear_model_sizes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gear_model_sizes" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gear_models" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gear_models" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gear_models" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notifications" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notifications" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notifications" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orphan_auth_users" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orphan_auth_users" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orphan_auth_users" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."package_referrals" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."package_referrals" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."package_referrals" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."packages" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."packages" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."packages" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."prices" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."prices" TO "authenticated";
GRANT ALL ON TABLE "public"."prices" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_notifications_sent" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_notifications_sent" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_notifications_sent" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_subscriptions" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."rooms" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."rooms" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scheduled_trips" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scheduled_trips" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scheduled_trips" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."signup_attempts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."signup_attempts" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."signup_attempts" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."signup_attempts_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."signup_attempts_id_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."signup_attempts_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."staff_availability" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."staff_availability" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."staff_availability" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."staff_availability_view" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."staff_availability_view" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."staff_availability_view" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."travel_destinations" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."travel_destinations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."travel_destinations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."trip_templates" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."trip_templates" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."trip_templates" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."trusted_partners" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."trusted_partners" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."trusted_partners" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicles" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."waitlist_offers" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."waitlist_offers" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."waitlist_offers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."waiver_signatures" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."waiver_signatures" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."waiver_signatures" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();



CREATE OR REPLACE TRIGGER "on_auth_user_email_updated" AFTER UPDATE OF "email" ON "auth"."users" FOR EACH ROW WHEN ((("new"."email")::"text" IS DISTINCT FROM ("old"."email")::"text")) EXECUTE FUNCTION "public"."sync_profile_email"();



CREATE POLICY "cert-cards: admin delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "cert-cards: admin insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'cert-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "cert-cards: admin read" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "cert-cards: admin update" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND "public"."is_admin"())) WITH CHECK ((("bucket_id" = 'cert-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "cert-cards: delete own" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "cert-cards: insert own" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'cert-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "cert-cards: parent delete children" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "cert-cards: parent insert children" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'cert-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "cert-cards: parent select children" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "cert-cards: parent update children" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "cert-cards: select own" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "cert-cards: update own" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'cert-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "deep-cards: admin delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "deep-cards: admin insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'deep-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "deep-cards: admin read" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "deep-cards: admin update" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND "public"."is_admin"())) WITH CHECK ((("bucket_id" = 'deep-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "deep-cards: delete own" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "deep-cards: insert own" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'deep-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "deep-cards: parent delete children" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "deep-cards: parent insert children" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'deep-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "deep-cards: parent select children" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "deep-cards: parent update children" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "deep-cards: select own" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "deep-cards: update own" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'deep-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "nitrox-cards: admin delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "nitrox-cards: admin insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'nitrox-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "nitrox-cards: admin read" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "nitrox-cards: admin update" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND "public"."is_admin"())) WITH CHECK ((("bucket_id" = 'nitrox-cards'::"text") AND "public"."is_admin"()));



CREATE POLICY "nitrox-cards: delete own" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "nitrox-cards: insert own" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'nitrox-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "nitrox-cards: parent delete children" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "nitrox-cards: parent insert children" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'nitrox-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "nitrox-cards: parent select children" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "nitrox-cards: parent update children" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ((("p"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]) AND ("p"."parent_account" = "auth"."uid"()))))));



CREATE POLICY "nitrox-cards: select own" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "nitrox-cards: update own" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'nitrox-cards'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));




-- ── Migration-seeded reference data ─────────────────────────
-- Loaded with replication_role=replica so self-referential FKs
-- (e.g. cert_levels.padi_equivalent_id) don't fail on row order.
set session_replication_role = replica;
INSERT INTO public.cancellation_policies VALUES ('1b76813a-c57c-4c1c-ae87-45a6ed389e47', 'Local Multi-day Trip', 'If diver cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees) of any payment made above the deposit amount. The deposit, however, is non-refundable. If the trip is canceled by Fun Divers Taiwan for any reason, the diver can choose to reschedule or get a full refund (minus transfer/bank/PayPal fees).') ON CONFLICT DO NOTHING;
INSERT INTO public.cancellation_policies VALUES ('465f1e26-17d5-4784-b9bd-2c5dd8a36560', 'International Trip', 'If diver cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees) of any payment made above the deposit amount. The deposit, however, is non-refundable. If the trip is canceled by Fun Divers Taiwan for any reason, and can''t be rescheduled, then the diver can get a full refund (minus transfer/bank/PayPal fees).') ON CONFLICT DO NOTHING;
INSERT INTO public.cancellation_policies VALUES ('652b34df-4cb7-48ab-91dc-41ae9e2d1f29', 'Local Day Trip', 'If diver cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees). If the dives are canceled by Fun Divers Taiwan for any reason, the diver can choose to reschedule or get a full refund (minus transfer/bank/PayPal fees).') ON CONFLICT DO NOTHING;
INSERT INTO public.cancellation_policies VALUES ('7409de8f-dbfd-403d-9db8-3c84721c7717', 'Course without Elearning', 'If student cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees). If the course is canceled by Fun Divers Taiwan for any reason, the diver can choose to reschedule or get a full refund (minus transfer/bank/PayPal fees).') ON CONFLICT DO NOTHING;
INSERT INTO public.cancellation_policies VALUES ('8ed8bb2a-abf8-482c-8a34-bf532232b5ce', 'Course with Elearning', 'If diver cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees) of any payment made above the deposit amount. The deposit, however, is non-refundable. If the course is fully or partially canceled by Fun Divers Taiwan for any reason, and can''t be rescheduled, then the diver can use the PADI E-learning at any PADI shop around the world.  If any course dives were finished, student will also receive a PADI Referral Form which can also be used at any PADI Shop around the world.') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('a1ec2a90-5006-4617-bb52-25eb80a54860', 'instructor', 'Instructor', '教練', 5, '2026-07-08 04:10:21.38215+00', '2026-07-08 04:10:21.38215+00', 'PADI', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('36585bcc-f349-4f73-a10f-f0bff178c87b', 'sdi_open_water', 'Open Water Scuba Diver', NULL, 1, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'SDI', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('c698e2d2-5c48-4464-9c04-1418fff9357d', 'sdi_advanced_adventure', 'Advanced Adventure Diver', NULL, 2, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'SDI', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('ba43f7b8-283d-4dd3-9aec-265010fe26fc', 'sdi_rescue', 'Rescue Diver', NULL, 3, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'SDI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('7967754e-db8c-4fb7-a8c5-e68c122e0ccd', 'sdi_master_scuba_diver', 'Master Scuba Diver', NULL, 4, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'SDI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('9c476ef8-d4a2-457c-adf1-81f406b3e660', 'rescue', 'Rescue', '救援潛水員', 3, '2026-07-08 04:10:21.38215+00', '2026-07-08 04:10:21.38215+00', 'PADI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('a54be39a-f3a4-4645-820a-ecf0d24ed113', 'sdi_divemaster', 'Divemaster', NULL, 5, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'SDI', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('93876c2d-30f8-46ed-941f-9c5dc1354569', 'bsac_ocean_diver', 'Ocean Diver / Club Diver', NULL, 1, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'BSAC', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('f485804f-2566-49d0-968d-c89dcae5e93d', 'bsac_sport_diver', 'Sport Diver', NULL, 2, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'BSAC', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('942b0f0b-ff80-4e6a-9b84-ebe89cbfc760', 'bsac_sport_diver_20', 'Sport Diver (20+ logged dives)', NULL, 3, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'BSAC', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('21655982-d4a3-4cb2-a257-7d6618a56027', 'bsac_dive_leader', 'Dive Leader', NULL, 4, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'BSAC', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('600d6a6a-a71d-4512-819d-c92cf11814f4', 'bsac_advanced_diver', 'Advanced Diver', NULL, 5, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'BSAC', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('55650d73-ecef-47dc-be48-5fa14878ad31', 'cmas_1_star_diver', '1-Star Diver', NULL, 1, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'CMAS', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('e797114f-6972-4007-813f-346448511eb1', 'cmas_2_star_diver', '2-Star Diver (Night & Navigation)', NULL, 2, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'CMAS', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('a953e190-d3b1-4fe6-afe5-af5274d7a14e', 'cmas_3_star_diver', '3-Star Diver', NULL, 3, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'CMAS', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('0a16131e-b807-430f-b3c1-b7a7e8057853', 'ssi_open_water', 'Open Water Diver', NULL, 1, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SSI', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('5bf03e19-af86-4d7a-ba52-6f598b7fb7dd', 'ssi_advanced_open_water', 'Advanced Open Water Diver', NULL, 2, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SSI', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('f7f27b06-526d-4514-a00c-d0a18a72530e', 'ssi_stress_rescue', 'Stress & Rescue Techniques', NULL, 3, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SSI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('2014384b-da1e-4065-8ca4-6fdd9c690627', 'ssi_master_diver', 'Master Diver', NULL, 4, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SSI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('040b4aae-2dcc-4a27-b706-1dd4690fe2cc', 'ssi_dive_con', 'Dive Con', NULL, 5, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SSI', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('89e1cc61-d334-43d4-a642-dac5a2eff0eb', 'naui_scuba_diver', 'Scuba Diver', NULL, 1, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'NAUI', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('c06fb92d-b01f-43ad-834a-60fe3807a20c', 'naui_advanced_scuba_diver', 'Advanced Scuba Diver', NULL, 2, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'NAUI', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('adab20d5-5b9b-4ccd-978c-26a78dbe1e1b', 'naui_master_scuba_diver', 'Master Scuba Diver', NULL, 3, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'NAUI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('5562c5b3-d178-4885-a98c-719ae759f501', 'naui_divemaster', 'Divemaster', NULL, 4, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'NAUI', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('0c2e3e52-aaf8-4d12-b1ca-6b1a7ae7ae81', 'saa_club_diver', 'Club Diver', NULL, 1, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SAA', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('1ca5792b-65d1-4018-9bd4-085fe7dd96a2', 'saa_club_diver_20_deep_nav', 'Club Diver (20+ dives, Deep & Navigation)', NULL, 2, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SAA', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('44a47359-e6a0-4d6f-87ed-5bb3d86ea66c', 'saa_dive_leader_20', 'Dive Leader (20+ dives)', NULL, 3, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SAA', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('eceda706-bafa-4113-ae01-7911ce2e212d', 'saa_dive_leader_rescue', 'Dive Leader (with Diver Rescue)', NULL, 4, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SAA', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('7a7de0f7-2400-44f1-b02a-7987dfe41206', 'saa_dive_supervisor_rescue', 'Dive Supervisor (with Diver Rescue)', NULL, 5, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SAA', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('0c039ada-d8a0-41ce-87e4-49b3078f4cbf', 'bsac_club_instructor', 'Club Instructor', NULL, 6, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'BSAC', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('c530c96c-3623-41e7-abb1-ab266822b3c4', 'bsac_open_water_instructor', 'Open Water Instructor', NULL, 7, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'BSAC', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('c5e76680-d89b-40e0-8cda-7a35cfe94ff0', 'bsac_advanced_instructor', 'Advanced Instructor', NULL, 8, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'BSAC', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('0224839e-d500-4c9c-9580-5ea701937dd5', 'cmas_1_star_instructor', '1-Star Instructor', NULL, 4, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'CMAS', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('370bfc81-c63e-4761-a700-e5eab7e4af43', 'cmas_2_star_instructor', '2-Star Instructor', NULL, 5, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'CMAS', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('9e250411-b80b-49ff-8a6f-7fb96c05244d', 'ssi_dive_con_instructor', 'Open Water / Dive Con Instructor', NULL, 6, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SSI', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('170bfa35-f0c6-4c82-9c62-500244c9416f', 'naui_scuba_instructor', 'Scuba Instructor', NULL, 5, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'NAUI', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('8d6b1527-4cda-4624-b7d6-31f6bdab05f8', 'saa_assistant_club_instructor_rescue', 'Assistant / Club Instructor (with Diver Rescue)', NULL, 6, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SAA', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('14788f47-437c-4668-bc74-5ece8e66a737', 'saa_regional_instructor', 'Regional Instructor', NULL, 7, '2026-07-08 04:10:21.506238+00', '2026-07-08 04:10:21.506238+00', 'SAA', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('aac73ed2-f764-44c3-8a0a-b22aaa41777e', 'sdi_assistant_instructor', 'Assistant Instructor', NULL, 6, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'SDI', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('a122600b-79d7-4912-a8a0-c37eb6765c80', 'sdi_instructor', 'Open Water Scuba Diver Instructor', NULL, 7, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'SDI', 'a1ec2a90-5006-4617-bb52-25eb80a54860') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('90fbbf12-398d-4f23-91c8-5e7642b2106d', 'tdi_nitrox', 'Nitrox Diver', NULL, 1, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'TDI', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('da0a7319-d766-4f79-a6d3-88a076836ed6', 'tdi_intro_to_tech', 'Intro to Tech', NULL, 2, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'TDI', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('54a2c864-36df-4d2d-b0d2-c0d3bedaa483', 'open_water', 'OW', '開放水域', 1, '2026-07-08 04:10:21.38215+00', '2026-07-08 04:10:21.38215+00', 'PADI', '54a2c864-36df-4d2d-b0d2-c0d3bedaa483') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('c1120406-0361-4b5e-9a88-01578c7bafef', 'tdi_advanced_nitrox', 'Advanced Nitrox Diver', NULL, 3, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'TDI', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('7cca8010-696a-4ce7-bc85-6fcc42f50bd8', 'tdi_decompression', 'Decompression Procedures Diver', NULL, 4, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'TDI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('08506887-6771-40a8-a41c-83517e836bac', 'tdi_helitrox', 'Helitrox Diver', NULL, 5, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'TDI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('0509d31f-a9f3-4c98-a48f-f38b8ec3339a', 'tdi_extended_range', 'Extended Range Diver', NULL, 6, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'TDI', '9c476ef8-d4a2-457c-adf1-81f406b3e660') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('8ed86e21-81dc-48f8-8311-16dcfe46f9e7', 'tdi_trimix', 'Trimix Diver', NULL, 7, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'TDI', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('1cb27825-a8e8-4099-81dc-5772c5b33c69', 'tdi_advanced_trimix', 'Advanced Trimix Diver', NULL, 8, '2026-07-08 04:10:21.706593+00', '2026-07-08 04:10:21.706593+00', 'TDI', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('81805010-6edc-4fc1-9bbc-4b27c8f972f3', 'advanced_open_water', 'AOW', '進階開放水域', 2, '2026-07-08 04:10:21.38215+00', '2026-07-08 04:10:21.38215+00', 'PADI', '81805010-6edc-4fc1-9bbc-4b27c8f972f3') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('5498be7b-a4d2-4b32-8630-f984beee5ba2', 'divemaster', 'DM', '潛水長', 4, '2026-07-08 04:10:21.38215+00', '2026-07-08 04:10:21.38215+00', 'PADI', '5498be7b-a4d2-4b32-8630-f984beee5ba2') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('1e084a3f-39cf-42bd-9037-8d02991b3051', 'msdt', 'MSDT', NULL, 6, '2026-07-08 04:10:21.72622+00', '2026-07-08 04:10:21.72622+00', 'PADI', '1e084a3f-39cf-42bd-9037-8d02991b3051') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('0c4ccb78-e28e-4cb5-b060-920d2144feb7', 'idc_staff', 'IDC Staff', NULL, 7, '2026-07-08 04:10:21.72622+00', '2026-07-08 04:10:21.72622+00', 'PADI', '0c4ccb78-e28e-4cb5-b060-920d2144feb7') ON CONFLICT DO NOTHING;
INSERT INTO public.cert_levels VALUES ('a6345ec9-b599-45ea-ae51-0379e568a238', 'course_director', 'Course Director', NULL, 8, '2026-07-08 04:10:21.72622+00', '2026-07-08 04:10:21.72622+00', 'PADI', 'a6345ec9-b599-45ea-ae51-0379e568a238') ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets VALUES ('cert-cards', 'cert-cards', NULL, '2026-07-08 04:10:21.249908+00', '2026-07-08 04:10:21.249908+00', false, false, NULL, NULL, NULL, 'STANDARD') ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets VALUES ('nitrox-cards', 'nitrox-cards', NULL, '2026-07-08 04:10:21.605817+00', '2026-07-08 04:10:21.605817+00', false, false, NULL, NULL, NULL, 'STANDARD') ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets VALUES ('deep-cards', 'deep-cards', NULL, '2026-07-08 04:10:21.627711+00', '2026-07-08 04:10:21.627711+00', false, false, NULL, NULL, NULL, 'STANDARD') ON CONFLICT DO NOTHING;
set session_replication_role = origin;
