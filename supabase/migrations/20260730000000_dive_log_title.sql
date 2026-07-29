-- Dive logs: a user-set title, plus arbitrary dive numbers.
--
-- Divers arriving with an existing (paper / other-app) logbook need to name a
-- dive and to start their in-app numbering at an arbitrary value rather than
-- being forced to begin at 1. The dive_number trigger (set_dive_log_number)
-- already honours a client-supplied value — it only fills a NULL — so making
-- the number editable is a UI-only change and needs no trigger change and no
-- schema change here. This migration only adds the missing title column.
--
-- title is nullable: every existing row predates it, and it stays optional
-- (the site name is the fallback heading). Capped at 120 chars to match the
-- site column's practical limit and stop a pasted document becoming a title.

alter table public.dive_logs
  add column if not exists title text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'dive_logs_title_len_chk'
  ) then
    alter table public.dive_logs
      add constraint dive_logs_title_len_chk
      check (title is null or char_length(title) <= 120);
  end if;
end $$;
