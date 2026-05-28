-- diver_notes: per-profile internal notes for staff/admin (food allergies,
-- disabilities, special accommodations, etc.). Visible only to the team —
-- divers never read or write these.
--
-- Distinct from admin_notes, which is for per-event/per-booking memos with
-- a tag taxonomy and resolved/unresolved lifecycle. Diver notes are standing
-- facts about the person — no tag, no resolve.

begin;

create table public.diver_notes (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  -- Edit metadata. Null edited_at means the note has never been edited; the
  -- UI uses that signal to hide the "(edited)" suffix. Anyone who can edit
  -- the row updates these alongside content.
  edited_by  uuid references public.profiles(id) on delete set null,
  edited_at  timestamptz
);

create index diver_notes_profile_idx
  on public.diver_notes (profile_id, created_at desc);

alter table public.diver_notes enable row level security;

-- Read: any staff or admin.
create policy "diver_notes: staff_or_admin select"
  on public.diver_notes for select to authenticated
  using (public.is_staff_or_admin());

-- Insert: staff/admin posting under their own attribution.
create policy "diver_notes: staff_or_admin insert"
  on public.diver_notes for insert to authenticated
  with check (public.is_staff_or_admin() and created_by = auth.uid());

-- Update: admin can edit anything; staff can edit only their own notes.
-- created_by/profile_id are not constrained here (the trigger below pins
-- them so a staff member can't move someone else's note to themselves).
create policy "diver_notes: admin or self update"
  on public.diver_notes for update to authenticated
  using  (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());

-- Delete: same rule as update.
create policy "diver_notes: admin or self delete"
  on public.diver_notes for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

-- Lock identity columns on update so the policy above can't be sidestepped
-- by, e.g., a staff member reassigning ownership before editing.
create or replace function public.diver_notes_freeze_identity() returns trigger
  language plpgsql security definer set search_path = public
as $$
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

create trigger diver_notes_freeze_identity
  before update on public.diver_notes
  for each row execute function public.diver_notes_freeze_identity();

commit;
