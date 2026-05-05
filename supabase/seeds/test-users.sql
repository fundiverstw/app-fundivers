-- Local-only test users. Runs after seed.sql on every `make reset`
-- (configured in supabase/config.toml's [db.seed] sql_paths). NEVER
-- pushed to cloud — `make push` only ships migrations from
-- supabase/migrations/, not seed files. Lives under supabase/seeds/
-- alongside any other test-only fixtures we add later.
--
-- Credentials match the DEV_ACCOUNTS list on src/pages/LoginPage.tsx
-- so the dev "easy login" buttons work after every reset:
--
--   diver@diver.diver / diverdiver
--   admin@admin.admin / adminadmin
--   staff@staff.staff / staffstaff
--
-- Add more accounts here whenever you need a recurring local fixture.
-- Deterministic UUIDs + ON CONFLICT DO NOTHING make this safe to rerun.
-- email_confirmed_at is set so login skips the confirm gate.
--
-- Profile rows are created by the existing handle_new_user trigger on
-- auth.users insert; we patch role/name afterwards for non-divers.

do $$
declare
  -- Triplet shape: (uuid, email, plaintext password)
  rec record;
begin
  for rec in
    select * from (values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'diver@diver.diver', 'diverdiver'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'admin@admin.admin', 'adminadmin'),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'staff@staff.staff', 'staffstaff')
    ) v(id, email, password)
  loop
    -- GoTrue scans these token columns into non-nullable Go strings,
    -- so NULL there causes "Database error querying schema" on signin.
    -- Postgres leaves them NULL by default; we set them to '' explicitly.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_anonymous,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', rec.id,
      'authenticated', 'authenticated', rec.email,
      crypt(rec.password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), false,
      '', '',
      '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at, id
    ) values (
      rec.id::text, rec.id,
      jsonb_build_object(
        'sub', rec.id::text,
        'email', rec.email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(), now(), now(),
      gen_random_uuid()
    ) on conflict (provider, provider_id) do nothing;
  end loop;
end$$;

-- Patch the auto-created profiles. The handle_new_user trigger gave
-- everyone role='diver' by default; lift two so role-gating in the SPA
-- can be exercised.
update public.profiles
set role = 'admin', full_name = 'Test Admin', display_name = 'Admin'
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

update public.profiles
set role = 'staff', full_name = 'Test Staff', display_name = 'Staff'
where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

update public.profiles
set full_name = 'Test Diver', display_name = 'Diver'
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
