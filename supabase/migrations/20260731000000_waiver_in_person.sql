-- Let an admin record a waiver a diver signed ON PAPER, in person.
--
-- Today the only write path into waiver_signatures is sign_waiver(), which
-- stamps the signer as auth.uid() — so a diver who filled a paper form can't
-- be marked satisfied without them re-signing in the app. Admins need to record
-- it on their behalf.
--
-- Two parts:
--   1. Audit columns on waiver_signatures — `method` ('e_signed' | 'in_person')
--      so a paper record is never mistaken for a diver's e-signature (the waiver
--      export attestation reads this), and `recorded_by` = the admin who logged
--      it. Existing rows default to 'e_signed'; sign_waiver keeps writing that
--      via the column default (no change to that function).
--   2. admin_record_paper_waiver() — an admin-gated SECURITY DEFINER RPC that
--      snapshots the current waiver content + hash exactly like sign_waiver, but
--      for an arbitrary diver_id, tagging the row in_person + recorded_by.

alter table public.waiver_signatures
  add column if not exists method      text not null default 'e_signed',
  add column if not exists recorded_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'waiver_signatures_method_check') then
    alter table public.waiver_signatures
      add constraint waiver_signatures_method_check
      check (method in ('e_signed', 'in_person'));
  end if;
end $$;

comment on column public.waiver_signatures.method is
  'How the signature was captured: ''e_signed'' (diver typed their name in-app) or ''in_person'' (admin recorded a paper form).';
comment on column public.waiver_signatures.recorded_by is
  'For in_person records, the admin (profiles.id) who logged the paper signature. NULL for diver e-signatures.';

create or replace function public.admin_record_paper_waiver(
  p_diver_id uuid, p_code text, p_version integer, p_signed_name text, p_event_id uuid default null
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'extensions'
as $$
declare
  new_id uuid;
  w record;
  v_canonical text;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
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
  if not exists (select 1 from public.profiles where id = p_diver_id) then
    raise exception 'diver not found' using errcode = 'no_data_found';
  end if;

  select title, body, pdf_path into w from public.waivers where code = p_code;

  -- Same canonical string + hash as sign_waiver, so a paper record and an
  -- e-signature of the same waiver version are content-identical in the export.
  v_canonical := coalesce(w.body, 'PDF:' || coalesce(w.pdf_path, ''));

  insert into public.waiver_signatures
    (diver_id, waiver_code, waiver_version, signed_name, signed_at, event_id,
     signed_title, signed_body, signed_pdf_path, content_sha256, method, recorded_by)
  values
    (p_diver_id, p_code, p_version, btrim(p_signed_name), now(), p_event_id,
     w.title, w.body, w.pdf_path,
     encode(digest(convert_to(v_canonical, 'UTF8'), 'sha256'), 'hex'),
     'in_person', auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

alter function public.admin_record_paper_waiver(uuid, text, integer, text, uuid) owner to postgres;
-- Callable by signed-in admins only; the is_admin() gate inside rejects everyone
-- else. Strip anon so an unauthenticated caller can't even attempt it.
revoke all on function public.admin_record_paper_waiver(uuid, text, integer, text, uuid) from public, anon;
grant execute on function public.admin_record_paper_waiver(uuid, text, integer, text, uuid) to authenticated;
