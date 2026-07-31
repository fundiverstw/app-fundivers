-- Dive logs: an optional wetsuit-thickness field.
--
-- Exposure protection is part of a dive record, and thickness is what divers
-- actually note ("5mm", "5/3mm semi-dry", "3mm shorty", "drysuit"). A free-text
-- column, not a number, because the real-world answer is rarely a single mm
-- value. Nullable — every existing row predates it and it stays optional, one
-- of the fields a diver opts into from the form's "add field" list.
--
-- Capped at 30 chars to match DIVE_LOG_TEXT_MAX.wetsuit_thickness and stop a
-- pasted blob becoming a "thickness".

alter table public.dive_logs
  add column if not exists wetsuit_thickness text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'dive_logs_wetsuit_thickness_len_chk'
  ) then
    alter table public.dive_logs
      add constraint dive_logs_wetsuit_thickness_len_chk
      check (wetsuit_thickness is null or char_length(wetsuit_thickness) <= 30);
  end if;
end $$;
