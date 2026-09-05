-- Withdrawing an observation you filed and then thought better of.
--
-- The diver's own entries are listed back to them now, and a list of your own
-- work with no way to take any of it back is a list that makes staff the only
-- route out of a mis-tap. Filing against the wrong site, or the wrong day, is
-- the ordinary version of that: neither can be corrected by editing, because
-- site and date are what identify the record — changing them would file a
-- second observation and leave the first one standing.
--
-- PENDING ONLY, and that is the whole of the rule. Once staff have ruled on a
-- record it is part of what the crowd has been shown and what the study counts;
-- letting an author delete it afterwards would make every approved reading
-- provisional on its author's continued agreement with it. A diver who wants an
-- approved record changed asks staff, and the page says so.
--
-- A delete rather than a status: `withdrawn` would be a fourth state that every
-- query, every check constraint and every count would have to learn, to
-- describe a record whose author says it never should have existed. The
-- submission was never published — nothing links to it, and the review queue is
-- the only place it was ever visible.
--
-- Writes on this table are RPC-only (`authenticated` holds SELECT and nothing
-- else), so this is a function and not an RLS policy. It is `security definer`
-- for that reason, and therefore does its own two checks: the caller owns the
-- record, and staff have not ruled on it.
create function public.withdraw_almanac_record(p_record_id uuid)
returns void
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_diver_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select diver_id, status into v_diver_id, v_status
    from public.almanac_records
    where id = p_record_id;

  -- One answer for "no such record" and "not yours". They are the same fact as
  -- far as the caller is entitled to know, and separating them would let
  -- somebody probe which ids exist.
  if v_diver_id is null or v_diver_id <> auth.uid() then
    raise exception 'almanac_record_not_yours' using errcode = '42501';
  end if;

  if v_status <> 'pending' then
    raise exception 'almanac_record_already_reviewed' using errcode = '23505';
  end if;

  delete from public.almanac_records where id = p_record_id;
end;
$$;

revoke all on function public.withdraw_almanac_record(uuid) from public, anon;
grant execute on function public.withdraw_almanac_record(uuid) to authenticated, service_role;
