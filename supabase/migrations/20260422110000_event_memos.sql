-- Phase 5: staff-visible memo flags attached to a specific dive or course.
-- Typed tags give a quick visual signal; content is free text. Each memo
-- references exactly one of eo_dive_id / eo_course_id.

begin;

create table public.event_memos (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid not null references public.profiles(id) on delete cascade,
  eo_dive_id    text references public."EO_dives"(_id)   on delete cascade,
  eo_course_id  text references public."EO_courses"(_id) on delete cascade,
  tag           text not null check (tag in ('urgent','payment','gear','logistics','cert','medical','note')),
  content       text not null check (char_length(content) between 1 and 2000),
  resolved      boolean not null default false,
  resolved_by   uuid references public.profiles(id),
  resolved_at   timestamptz,
  constraint event_memos_event_xor check (
    (eo_dive_id is not null)::int + (eo_course_id is not null)::int = 1
  ),
  constraint event_memos_resolved_consistency check (
    (resolved = true  and resolved_by is not null and resolved_at is not null)
    or
    (resolved = false and resolved_by is null     and resolved_at is null)
  )
);

create index event_memos_dive_idx   on public.event_memos (eo_dive_id)   where eo_dive_id   is not null;
create index event_memos_course_idx on public.event_memos (eo_course_id) where eo_course_id is not null;
create index event_memos_open_idx   on public.event_memos (created_at desc) where resolved = false;

commit;
