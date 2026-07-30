-- Terms consent for the diver who never signs in.
--
-- Two account paths record terms consent today: self-signup and guest checkout
-- both stamp profiles.agreed_to_terms_at/_version from the server. The third
-- path -- admin-create-diver, the walk-in whose account the shop mints for them
-- -- records nothing, and RequireCurrentTerms only catches them if they ever
-- log in. The premise of that user is that they don't.
--
-- The fix is a route to consent that needs no session: the courtesy email
-- carries a one-time link to a page that shows the Terms and an Accept button.
-- The DIVER still does the consenting -- an admin asserting it on their behalf
-- would produce a record that looks like consent and isn't, and would break
-- what agreed_to_terms_version means for the route guard.
--
-- The token is a bearer credential, so it is single-use, expiring, and grants
-- exactly one thing: "stamp terms consent on this one profile". It carries no
-- session and cannot read or write anything else.

create table public.terms_consent_tokens (
  token      uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  -- Set when the diver accepts. Together with user_id this is the audit trail
  -- for an email-route consent, which is why no column on profiles records the
  -- channel: the evidence lives here.
  used_at    timestamptz,
  accepted_version integer
);

comment on table public.terms_consent_tokens is
  'One-time links letting a diver accept the Terms without signing in. Minted by the admin edge functions, redeemed by accept_terms_with_token().';

create index terms_consent_tokens_user_idx
  on public.terms_consent_tokens (user_id, created_at desc);

alter table public.terms_consent_tokens enable row level security;

-- Admins read it (the user card shows "invite sent / accepted"). Nobody else
-- touches the table directly: the service-role edge functions bypass RLS to
-- mint, and redemption goes through the SECURITY DEFINER function below. A
-- diver must not be able to list tokens -- that would turn a read into a
-- consent-forging kit for other divers.
create policy "terms_consent_tokens: admin select" on public.terms_consent_tokens
  for select to authenticated using (public.is_admin());

-- Table privileges, spelled out because a new table in this schema starts with
-- none for the API roles (unlike public.terms, created when the default
-- privileges still applied) -- without this the edge functions cannot mint at
-- all. RLS narrows what authenticated can see; the GRANT is what decides what
-- it can DO, and read is the whole list. anon gets nothing: both RPCs are
-- SECURITY DEFINER and run as the owner, so an anon caller never needs to touch
-- the table itself.
grant select, insert, update, delete on table public.terms_consent_tokens to service_role;
grant select on table public.terms_consent_tokens to authenticated;

-- ── Redemption ──────────────────────────────────────────────────────────────
-- Deliberately anon-callable: the whole point is a diver with no session. Both
-- functions take an unguessable uuid and return no personal data -- not the
-- diver's name, not their email, not even whether that profile exists. An
-- unknown token and a token for a deleted diver are indistinguishable.

create or replace function public.terms_consent_token_state(p_token uuid)
  returns text
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $$
declare
  r record;
begin
  if p_token is null then return 'unknown'; end if;
  select used_at, expires_at into r
    from public.terms_consent_tokens where token = p_token;
  if not found            then return 'unknown'; end if;
  if r.used_at is not null then return 'used';    end if;
  if r.expires_at < now()  then return 'expired'; end if;
  return 'valid';
end;
$$;

alter function public.terms_consent_token_state(uuid) owner to postgres;
revoke all on function public.terms_consent_token_state(uuid) from public;
grant execute on function public.terms_consent_token_state(uuid) to anon, authenticated;

-- Records consent on the token's profile and burns the token. The VERSION comes
-- from public.terms, never from the caller -- same rule as accept_current_terms.
create or replace function public.accept_terms_with_token(p_token uuid)
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_user_id uuid;
  v_version integer;
begin
  select version into v_version from public.terms;
  if v_version is null then
    raise exception 'no terms row' using errcode = 'no_data_found';
  end if;

  -- Claim the token and read its owner in one statement: two callers racing on
  -- the same link cannot both pass, because only one UPDATE matches used_at is
  -- null. Everything after this point is running on a token nobody else holds.
  update public.terms_consent_tokens
     set used_at = now(), accepted_version = v_version
   where token = p_token
     and used_at is null
     and expires_at >= now()
  returning user_id into v_user_id;

  if v_user_id is null then
    -- One message for unknown / used / expired. The page has already told the
    -- diver which it is via terms_consent_token_state; saying more here would
    -- turn this function into an oracle for guessed tokens.
    raise exception 'this link is no longer valid' using errcode = 'check_violation';
  end if;

  update public.profiles
     set agreed_to_terms_at      = now(),
         agreed_to_terms_version = v_version
   where id = v_user_id;

  return v_version;
end;
$$;

alter function public.accept_terms_with_token(uuid) owner to postgres;
revoke all on function public.accept_terms_with_token(uuid) from public;
grant execute on function public.accept_terms_with_token(uuid) to anon, authenticated;
