-- The logistics pack list, shared between the crew's phones.
--
-- Each tick on the day board ("Ada's BCD is on the van") used to live in the
-- localStorage of the phone that made it. Two people loading the same van
-- therefore kept two separate lists, and a piece one of them had packed still
-- read as unpacked on the other's screen — the setup for packing it twice, or
-- for each assuming the other had it.
--
-- One row per piece on the van. A tick inserts it, an untick deletes it, so a
-- piece's state is simply whether its row exists: two phones ticking the same
-- piece at once converge on one row, and nothing needs merging.
--
-- Keyed by the day as well as the booking, because a multi-day course is one
-- booking packed afresh each morning — Monday's ticks must not read as
-- Tuesday's. `item` is the pack-list label ("BCD", "Dive light", an add-on's
-- catalog title), the same string the client has always keyed ticks on.

create table public.packed_pieces (
  pack_day date not null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  item text not null check (length(item) between 1 and 200),
  packed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  packed_at timestamptz not null default now(),
  primary key (pack_day, booking_id, item)
);

-- The cascade from bookings deletes by booking_id alone.
create index packed_pieces_booking_idx on public.packed_pieces using btree (booking_id);

alter table public.packed_pieces enable row level security;

-- The day board is a staff surface; a diver never sees or ticks the list.
-- `packed_by` is stamped server-side and cannot be forged onto a colleague.
create policy "packed_pieces: staff_or_admin read" on public.packed_pieces
  for select to authenticated using (public.is_staff_or_admin());
create policy "packed_pieces: staff_or_admin tick" on public.packed_pieces
  for insert to authenticated
  with check (public.is_staff_or_admin() and packed_by = auth.uid());
create policy "packed_pieces: staff_or_admin untick" on public.packed_pieces
  for delete to authenticated using (public.is_staff_or_admin());

-- Spelled out: the incremental migration path production takes grants nothing
-- by default, a fresh local reset grants too much (TRUNCATE ignores row
-- security), and a diver's anon session has no business here at all.
revoke all on public.packed_pieces from anon, authenticated;
grant select, insert, delete on public.packed_pieces to authenticated;
grant all on public.packed_pieces to service_role;

-- Every open board hears a colleague's tick within a second, instead of
-- finding out on the next reload.
alter publication supabase_realtime add table public.packed_pieces;
