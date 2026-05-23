-- Photo of the diver's nitrox certification card. Mirrors the cert-card
-- pattern from 20260422200000: a private bucket, per-user RLS keyed off
-- the folder prefix, plus an admin-read policy for verification. The
-- column on profiles holds the storage object path (signed URLs are
-- resolved at read time).
--
-- Triggered by the product rule "if the diver claims nitrox
-- certification, require proof." The SPA gates the Save / Next buttons
-- on the presence of this path whenever nitrox_certified is true.

alter table public.profiles add column nitrox_card_path text;

insert into storage.buckets (id, name, public)
values ('nitrox-cards', 'nitrox-cards', false)
on conflict (id) do nothing;

drop policy if exists "nitrox-cards: insert own" on storage.objects;
create policy "nitrox-cards: insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nitrox-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "nitrox-cards: select own" on storage.objects;
create policy "nitrox-cards: select own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "nitrox-cards: update own" on storage.objects;
create policy "nitrox-cards: update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "nitrox-cards: delete own" on storage.objects;
create policy "nitrox-cards: delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "nitrox-cards: admin read" on storage.objects;
create policy "nitrox-cards: admin read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
