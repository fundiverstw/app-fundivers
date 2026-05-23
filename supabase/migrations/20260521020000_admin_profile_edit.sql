-- Let admins edit any diver's profile from the People page. The diver
-- self-update policy already exists; this one stacks on top so the
-- legitimate self path keeps working while admins also gain coverage.
--
-- Storage policies on cert-cards / nitrox-cards picked up only an admin
-- READ policy in the original migrations. Editing on behalf means the
-- admin also needs INSERT / UPDATE / DELETE on any diver's folder —
-- without that, an admin trying to replace a bad photo would fail the
-- existing self-folder check (`storage.foldername(name)[1] = auth.uid()`).

drop policy if exists "profiles: admin update" on public.profiles;
create policy "profiles: admin update"
  on public.profiles for update to authenticated
  using     (public.is_admin())
  with check (public.is_admin());

-- ── cert-cards bucket — admin can write/replace/remove any folder ────
drop policy if exists "cert-cards: admin insert" on storage.objects;
create policy "cert-cards: admin insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cert-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "cert-cards: admin update" on storage.objects;
create policy "cert-cards: admin update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'cert-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "cert-cards: admin delete" on storage.objects;
create policy "cert-cards: admin delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cert-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ── nitrox-cards bucket — same trio ──────────────────────────────────
drop policy if exists "nitrox-cards: admin insert" on storage.objects;
create policy "nitrox-cards: admin insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nitrox-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "nitrox-cards: admin update" on storage.objects;
create policy "nitrox-cards: admin update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "nitrox-cards: admin delete" on storage.objects;
create policy "nitrox-cards: admin delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
