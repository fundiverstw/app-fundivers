-- Bind each waiver signature to the exact content the diver agreed to.
--
-- Until now waiver_signatures recorded only who (diver_id, server-set from
-- auth.uid()), what (waiver_code + version), the typed name, and when
-- (signed_at). That attests consent, but the waivers table keeps only the
-- CURRENT body/pdf — so once a waiver is edited you can no longer prove WHAT a
-- past signer actually saw. This snapshots the content plus a SHA-256 of it into
-- the signature row at signing time, in the same transaction, making each
-- signature a self-contained, tamper-evident record fit for an e-signature
-- export. IP / user-agent capture is a separate follow-up (it needs the signing
-- call to route through an edge function; the DB only sees the pooler's IP).
--
-- Existing signatures keep NULL snapshots — they were signed before this
-- existed, and the export renders them as "content not archived".

alter table public.waiver_signatures
  add column signed_title    text,
  add column signed_body     text,
  add column signed_pdf_path text,
  add column content_sha256  text;

comment on column public.waiver_signatures.signed_title is
  'Snapshot of the waiver title at signing time.';
comment on column public.waiver_signatures.signed_body is
  'Snapshot of the waiver markdown the diver saw (NULL for uploaded-PDF waivers).';
comment on column public.waiver_signatures.signed_pdf_path is
  'Snapshot of the uploaded-PDF path the diver saw (NULL for text waivers).';
comment on column public.waiver_signatures.content_sha256 is
  'SHA-256 (hex) of the signed content: the body for text waivers, or "PDF:"||path for uploaded-PDF forms.';

-- Recreate sign_waiver so it snapshots the current waiver content + hash
-- alongside the signature. The signature and every call site are unchanged;
-- `create or replace` preserves the existing grants. search_path gains
-- `extensions` so pgcrypto's digest() resolves.
create or replace function public.sign_waiver(
  p_code text, p_version integer, p_signed_name text, p_event_id uuid default null
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
  if auth.uid() is null then raise exception 'must be authenticated' using errcode = 'insufficient_privilege'; end if;
  if p_code is null or char_length(p_code) = 0 then raise exception 'waiver code is required' using errcode = 'check_violation'; end if;
  if p_version is null or p_version < 1 then raise exception 'waiver version must be a positive integer' using errcode = 'check_violation'; end if;
  if p_signed_name is null or char_length(btrim(p_signed_name)) = 0 then raise exception 'signed name is required' using errcode = 'check_violation'; end if;

  select title, body, pdf_path into w from public.waivers where code = p_code;

  -- The canonical string the hash covers: the body for text waivers, or a stable
  -- PDF marker for uploaded-form waivers. Null-safe so a missing waiver row still
  -- records the signature (hash over an empty marker) rather than failing to sign.
  v_canonical := coalesce(w.body, 'PDF:' || coalesce(w.pdf_path, ''));

  insert into public.waiver_signatures
    (diver_id, waiver_code, waiver_version, signed_name, signed_at, event_id,
     signed_title, signed_body, signed_pdf_path, content_sha256)
  values
    (auth.uid(), p_code, p_version, btrim(p_signed_name), now(), p_event_id,
     w.title, w.body, w.pdf_path,
     encode(digest(convert_to(v_canonical, 'UTF8'), 'sha256'), 'hex'))
  returning id into new_id;
  return new_id;
end;
$$;

alter function public.sign_waiver(text, integer, text, uuid) owner to postgres;
