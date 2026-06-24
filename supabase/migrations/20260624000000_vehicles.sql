-- ============================================================
-- vehicles — the shop's transport fleet
-- ============================================================
-- A small admin-managed catalog of the vehicles the shop owns, used on the
-- logistics day view to plan rides for divers who need transport. Each vehicle
-- carries `passenger_seats` passengers EXCLUDING the driver — one staff member
-- drives, so a deployed vehicle moves `passenger_seats` riders. New vehicles
-- are added as the shop buys them; sold ones are retired via `active = false`.
--
-- Staff + admin can read the fleet (logistics is staff-accessible); only admins
-- manage it. Vehicles aren't referenced by any other table — a stateless
-- capacity check on logistics is computed from this catalog at view time.

create table public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text not null,
  -- Seats for passengers, NOT counting the driver (a Delica seats 7 passengers
  -- + the staff driver). At least one — a vehicle that can't carry a passenger
  -- isn't worth planning around.
  passenger_seats integer not null check (passenger_seats >= 1),
  active          boolean not null default true,
  created_by      uuid references public.profiles(id)
);

alter table public.vehicles enable row level security;

create policy "vehicles: staff_or_admin read"
  on public.vehicles for select to authenticated
  using (public.is_staff_or_admin());

create policy "vehicles: admin manage"
  on public.vehicles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
