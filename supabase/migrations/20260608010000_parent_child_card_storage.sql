-- Let a parent manage their children's certification card photos.
--
-- profiles already has a "parent update children" policy (20260514...), so
-- a parent can edit a child's profile row — but the cert-cards /
-- nitrox-cards / deep-cards buckets only granted each user their OWN folder
-- (`storage.foldername(name)[1] = auth.uid()`). The diver-facing profile
-- form requires a card photo whenever a cert level is set, so without folder
-- access a parent can't complete a child's certification.
--
-- This mirrors the admin cross-folder policies (20260521020000) but scopes
-- the grant to folders owned by the caller's own children: the folder's
-- first path segment is the child's profile id, and that child's
-- parent_account must equal auth.uid(). Card paths are '<profile_id>/card_*.jpg'.

-- Reusable predicate would be nice, but storage policies inline it. The
-- exists() resolves the folder's owning profile and checks parentage.

-- ── cert-cards ───────────────────────────────────────────────────────
drop policy if exists "cert-cards: parent insert children" on storage.objects;
create policy "cert-cards: parent insert children"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cert-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "cert-cards: parent select children" on storage.objects;
create policy "cert-cards: parent select children"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cert-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "cert-cards: parent update children" on storage.objects;
create policy "cert-cards: parent update children"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'cert-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "cert-cards: parent delete children" on storage.objects;
create policy "cert-cards: parent delete children"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cert-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

-- ── nitrox-cards ─────────────────────────────────────────────────────
drop policy if exists "nitrox-cards: parent insert children" on storage.objects;
create policy "nitrox-cards: parent insert children"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nitrox-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "nitrox-cards: parent select children" on storage.objects;
create policy "nitrox-cards: parent select children"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "nitrox-cards: parent update children" on storage.objects;
create policy "nitrox-cards: parent update children"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "nitrox-cards: parent delete children" on storage.objects;
create policy "nitrox-cards: parent delete children"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'nitrox-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

-- ── deep-cards ───────────────────────────────────────────────────────
drop policy if exists "deep-cards: parent insert children" on storage.objects;
create policy "deep-cards: parent insert children"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deep-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "deep-cards: parent select children" on storage.objects;
create policy "deep-cards: parent select children"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'deep-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "deep-cards: parent update children" on storage.objects;
create policy "deep-cards: parent update children"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'deep-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );

drop policy if exists "deep-cards: parent delete children" on storage.objects;
create policy "deep-cards: parent delete children"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'deep-cards'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.parent_account = auth.uid()
    )
  );
