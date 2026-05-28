-- Photo of the diver's Deep (40m) certification card. Mirrors the
-- nitrox-card pattern from 20260520000000_profile_nitrox_card.sql plus
-- the admin storage policies from 20260521020000_admin_profile_edit.sql,
-- combined into one forward migration.
--
-- Product rule: a diver who claims Deep certification must upload proof.
-- The SPA gates Save / Next on the path being present whenever
-- deep_certified is true.

alter table public.profiles
  add column deep_certified boolean not null default false,
  add column deep_card_path text;

-- ── deep-cards bucket ────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('deep-cards', 'deep-cards', false)
on conflict (id) do nothing;

-- self-CRUD on own folder
drop policy if exists "deep-cards: insert own" on storage.objects;
create policy "deep-cards: insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deep-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "deep-cards: select own" on storage.objects;
create policy "deep-cards: select own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'deep-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "deep-cards: update own" on storage.objects;
create policy "deep-cards: update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'deep-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "deep-cards: delete own" on storage.objects;
create policy "deep-cards: delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'deep-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- admin read + write on any folder (mirrors nitrox-cards admin policies)
drop policy if exists "deep-cards: admin read" on storage.objects;
create policy "deep-cards: admin read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'deep-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "deep-cards: admin insert" on storage.objects;
create policy "deep-cards: admin insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deep-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "deep-cards: admin update" on storage.objects;
create policy "deep-cards: admin update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'deep-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "deep-cards: admin delete" on storage.objects;
create policy "deep-cards: admin delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'deep-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
