-- ============================================================
-- Waiver tracking — e-signed liability/medical forms per diver + per event
-- ============================================================
-- The shop's events legally require signed PADI waivers (liability, diver
-- medical, continuing-education). The CATALOG of waivers and the GLOBAL rule
-- for which events need which waiver live in the app config file
-- (src/config/waivers.ts) so other shops adopting FunDive can customize them in
-- one version-controlled place. The database stores only the per-diver/per-event
-- facts the config can't:
--
--   waiver_signatures — one append-only row per signing event. A diver e-signs
--     in-app (typed name + acknowledgment); the row records WHAT was signed
--     (waiver_code + waiver_version snapshot), WHO (diver_id), WHEN (signed_at)
--     and, for per-event waivers, WHICH event. Annual waivers leave both event
--     keys null. We never store medical answers — only the acknowledgment.
--
--   event_waivers — per-event overrides that adjust the global rule for a single
--     dive/course: mode 'require' adds a waiver the rule wouldn't, 'exempt' drops
--     one it would. Mirrors the event_vehicles XOR-FK shape.
--
-- Writes to signatures go exclusively through sign_waiver() (SECURITY DEFINER)
-- so the server stamps signed_at = now() and the diver_id = auth.uid() — the
-- client can't backdate or forge, the same non-repudiation fix as
-- accept_current_terms() for the Terms of Use.

-- ── waiver_signatures ───────────────────────────────────────────────────────
create table public.waiver_signatures (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  diver_id       uuid not null references public.profiles(id) on delete cascade,
  waiver_code    text not null check (char_length(waiver_code) between 1 and 100),
  waiver_version int  not null check (waiver_version > 0),
  signed_name    text not null check (char_length(signed_name) between 1 and 200),
  signed_at      timestamptz not null default now(),
  eo_dive_id     uuid references public."EO_dives"(_id)   on delete cascade,
  eo_course_id   uuid references public."EO_courses"(_id) on delete cascade,
  -- Annual waivers reference no event (both null); per-event waivers reference
  -- exactly one. Never both.
  constraint waiver_signatures_event_atmost_one check (
    (eo_dive_id is not null)::int + (eo_course_id is not null)::int <= 1
  )
);

create index waiver_signatures_diver_code_idx on public.waiver_signatures (diver_id, waiver_code);
create index waiver_signatures_dive_idx   on public.waiver_signatures (eo_dive_id)   where eo_dive_id   is not null;
create index waiver_signatures_course_idx on public.waiver_signatures (eo_course_id) where eo_course_id is not null;

alter table public.waiver_signatures enable row level security;

-- Divers read their own signatures; staff+admin read all (to flag missing
-- waivers on the event page). No diver insert/update/delete policy on purpose —
-- inserts happen only via sign_waiver(); the record is append-only for divers.
create policy "waiver_signatures: self read"
  on public.waiver_signatures for select to authenticated
  using (auth.uid() = diver_id);

create policy "waiver_signatures: staff_or_admin read"
  on public.waiver_signatures for select to authenticated
  using (public.is_staff_or_admin());

-- Admins can correct/remove records (and insert on a diver's behalf if needed).
create policy "waiver_signatures: admin manage"
  on public.waiver_signatures for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── event_waivers (per-event override of the global rule) ────────────────────
create table public.event_waivers (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  eo_dive_id    uuid references public."EO_dives"(_id)   on delete cascade,
  eo_course_id  uuid references public."EO_courses"(_id) on delete cascade,
  waiver_code   text not null check (char_length(waiver_code) between 1 and 100),
  mode          text not null check (mode in ('require', 'exempt')),
  constraint event_waivers_event_xor check (
    (eo_dive_id is not null)::int + (eo_course_id is not null)::int = 1
  )
);

-- At most one override per waiver per event (dive and course variants are
-- mutually exclusive, so two partial unique indexes cover both shapes).
create unique index event_waivers_dive_code_uniq
  on public.event_waivers (eo_dive_id, waiver_code) where eo_dive_id is not null;
create unique index event_waivers_course_code_uniq
  on public.event_waivers (eo_course_id, waiver_code) where eo_course_id is not null;

alter table public.event_waivers enable row level security;

-- Which waivers an event requires isn't sensitive, and the registration form
-- (run as a plain diver) needs it to compute the missing-waiver warning — so
-- read is open to any authenticated user. Only admins change the overrides.
create policy "event_waivers: authenticated read"
  on public.event_waivers for select to authenticated
  using (true);

create policy "event_waivers: admin manage"
  on public.event_waivers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── sign_waiver RPC ─────────────────────────────────────────────────────────
-- Server-stamped insert: signed_at = now(), diver_id = auth.uid(). Closes the
-- backdating/forgery gap (same approach as accept_current_terms). Caller passes
-- the dive/course id only for per-event waivers; annual waivers pass neither.
--
-- Trust boundary: p_code / p_version are NOT validated against the waiver
-- catalog, because the catalog lives in app config (src/config/waivers.ts), not
-- the DB. A caller hand-crafting the RPC could record a row for a bogus code or
-- an inflated version, which the "is this signature current?" check
-- (waiver_version >= config version) would then accept — letting them self-clear
-- the warn-only registration gate and the admin's missing-waiver flag. This is
-- accepted: enforcement is advisory, not a hard block. To make it airtight,
-- mirror the catalog into an allowlist table and validate (code, version) here.
create or replace function public.sign_waiver(
  p_code         text,
  p_version      int,
  p_signed_name  text,
  p_dive_id      uuid default null,
  p_course_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_code is null or char_length(p_code) = 0 then
    raise exception 'waiver code is required' using errcode = 'check_violation';
  end if;
  if p_version is null or p_version < 1 then
    raise exception 'waiver version must be a positive integer' using errcode = 'check_violation';
  end if;
  if p_signed_name is null or char_length(btrim(p_signed_name)) = 0 then
    raise exception 'signed name is required' using errcode = 'check_violation';
  end if;
  if p_dive_id is not null and p_course_id is not null then
    raise exception 'a signature targets at most one event' using errcode = 'check_violation';
  end if;

  insert into public.waiver_signatures
    (diver_id, waiver_code, waiver_version, signed_name, signed_at, eo_dive_id, eo_course_id)
  values
    (auth.uid(), p_code, p_version, btrim(p_signed_name), now(), p_dive_id, p_course_id)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.sign_waiver(text, int, text, uuid, uuid) from public;
grant execute on function public.sign_waiver(text, int, text, uuid, uuid) to authenticated;
