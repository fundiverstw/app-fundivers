-- Replace structured cert fields (number, date) with a single uploaded-image
-- reference. Users upload a photo of their cert card; it's compressed
-- client-side and stored in a private Supabase Storage bucket. We keep only
-- the object path in profiles and resolve to signed URLs at read time.

alter table public.profiles drop column cert_number;
alter table public.profiles drop column cert_date;
alter table public.profiles add column cert_card_path text;

-- Private bucket for cert-card images.
insert into storage.buckets (id, name, public)
values ('cert-cards', 'cert-cards', false)
on conflict (id) do nothing;

-- Per-user RLS: each user can read/write files under "<user_id>/...". Admins
-- can additionally read any card so they can verify at check-in.

drop policy if exists "cert-cards: insert own" on storage.objects;
create policy "cert-cards: insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cert-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "cert-cards: select own" on storage.objects;
create policy "cert-cards: select own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cert-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "cert-cards: update own" on storage.objects;
create policy "cert-cards: update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'cert-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "cert-cards: delete own" on storage.objects;
create policy "cert-cards: delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cert-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "cert-cards: admin read" on storage.objects;
create policy "cert-cards: admin read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cert-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
