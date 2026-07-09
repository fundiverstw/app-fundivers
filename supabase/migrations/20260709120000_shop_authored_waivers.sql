-- Shop-authored waivers + cancellation-policy CRUD metadata + a waiver-PDF bucket.
--
-- Moves the hardcoded waiver catalog (src/config/waivers.ts) into a `waivers`
-- table so shop owners author their own — free-form, in whatever language they
-- like, as a text body OR an uploaded PDF — and attach them to events. The
-- stable key stays `code` (+ integer `version`), so event_waivers,
-- waiver_signatures and the sign_waiver() RPC are untouched; only the catalog
-- source moves from config to the DB. The three PADI forms that lived in config
-- are seeded here so existing signatures keep resolving and behaviour is
-- preserved. Cancellation policies gain a language label + active flag so they
-- get the same admin CRUD. A private `waiver-pdfs` bucket holds shop-uploaded
-- PDF templates (admins write; any authenticated diver reads to view + e-sign).

-- ── 1. waivers table ────────────────────────────────────────────────────────
create table public.waivers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  -- Stable identifier stored on signatures/overrides — never reused for a
  -- different waiver. Matches waiver_signatures.waiver_code / event_waivers.waiver_code.
  code text not null unique,
  title text not null,
  -- Free-form label for the shop's own organisation (e.g. 'en', 'zh-TW', '日本語').
  -- Not tied to the app's locale.language; the shop attaches the right waiver
  -- to each event by hand.
  language text,
  -- Exactly one of body / pdf_path is set (enforced below). pdf_path points into
  -- the waiver-pdfs storage bucket.
  body text,
  pdf_path text,
  cadence text not null default 'annual',
  -- Bumped when the content changes, to force everyone to re-sign (mirrors the
  -- old config `version`).
  version integer not null default 1,
  -- Default auto-scope, still overridable per-event via event_waivers.
  applies_to text not null default 'none',
  -- When applies_to touches courses, restrict to these courseColor() buckets.
  course_colors text[],
  active boolean not null default true,
  constraint waivers_cadence_check check (cadence = any (array['annual'::text, 'per_event'::text])),
  constraint waivers_applies_to_check check (applies_to = any (array['dives'::text, 'courses'::text, 'all'::text, 'none'::text])),
  constraint waivers_version_check check (version >= 1),
  constraint waivers_code_len_check check (char_length(code) >= 1 and char_length(code) <= 100),
  constraint waivers_title_len_check check (char_length(btrim(title)) >= 1),
  -- Exactly one content source: a text body OR an uploaded PDF, never both/neither.
  constraint waivers_content_present check (
    (body is not null and char_length(btrim(body)) > 0 and pdf_path is null)
    or (pdf_path is not null and char_length(btrim(pdf_path)) > 0 and body is null)
  )
);
create index waivers_active_idx on public.waivers using btree (active) where (active);
alter table public.waivers enable row level security;
-- Diver-readable reference data (mirrors cert_levels / cancellation_policies);
-- admin-only writes.
create policy "waivers: public select" on public.waivers
  for select to authenticated, anon using (true);
create policy "waivers: admin insert" on public.waivers
  for insert to authenticated with check (public.is_admin());
create policy "waivers: admin update" on public.waivers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "waivers: admin delete" on public.waivers
  for delete to authenticated using (public.is_admin());

-- Seed the three forms that were hardcoded in src/config/waivers.ts. Bodies are
-- dollar-quoted so their apostrophes need no escaping.
insert into public.waivers (code, title, cadence, version, applies_to, course_colors, body) values
(
  'padi_liability',
  'Boat Travel & Scuba Diving Liability Release',
  'annual', 1, 'dives', null,
  $body$BOAT TRAVEL AND SCUBA DIVING LIABILITY RELEASE AND ASSUMPTION OF RISK AGREEMENT

I hereby affirm that I am a certified scuba diver or a student diver under the control and supervision of a certified scuba instructor, and that I thoroughly understand the hazards of scuba diving including those occurring during boat travel to and from the dive site (the "Excursion").

I understand that these inherent risks include, but are not limited to, drowning, air expansion injuries, decompression sickness, embolism or other hyperbaric injuries that require treatment in a recompression chamber; slipping or falling while on board; being cut or struck by a boat while in the water; injuries occurring while getting on or off a boat; and other perils of the sea — all of which can result in serious injury or death. I understand the Excursion will be conducted at a site that is remote, by time or distance or both, from a recompression chamber and emergency medical facilities. I still choose to proceed.

I understand and agree that neither the divemaster/dive supervisor/instructor; nor the crew or owner of the vessel; nor the vessel itself; nor PADI Americas, Inc., nor its affiliate or subsidiary corporations; nor the owners, officers, employees, agents, contractors or assigns of the above (the "Released Parties") may be held liable or responsible in any way for any personal injury, property damage, wrongful death or other damages to me or my family, estate, heirs or assigns that may occur as a result of my participation in this Excursion, or as a result of the negligence of any party, including the Released Parties, whether passive or active.

I affirm I am in good mental and physical fitness to scuba dive and am not under the influence of alcohol or any drugs contraindicated to diving. I affirm it is my responsibility to inspect my equipment prior to the Excursion. I am aware that safe dive practices suggest diving with a buddy and that it is my responsibility to plan my dive and follow the instructions of the dive supervisor/vessel crew.

BY THIS INSTRUMENT, I AGREE TO EXEMPT AND RELEASE ALL THE ABOVE-LISTED ENTITIES AND INDIVIDUALS FROM ALL LIABILITY AND RESPONSIBILITY FOR PERSONAL INJURY, PROPERTY DAMAGE OR WRONGFUL DEATH, HOWEVER CAUSED, INCLUDING THE NEGLIGENCE OF THE RELEASED PARTIES, WHETHER PASSIVE OR ACTIVE. I am of lawful age and legally competent to sign this Agreement, or have obtained the written consent of my parent or guardian, and I sign it of my own free act.

PADI Product No. 10077.$body$
),
(
  'diver_medical',
  'Diver Medical Questionnaire',
  'annual', 1, 'none', null,
  $body$DIVER MEDICAL — PARTICIPANT QUESTIONNAIRE

Recreational scuba diving and freediving require good physical and mental health. A few medical conditions can be hazardous while diving. This questionnaire is a basis to determine whether you should seek a physician's evaluation before diving.

Before signing, confirm you have completed the PADI Diver Medical Participant Questionnaire (Product No. 10346) honestly. If you answered YES to any question that directs you to a physician — or to questions 3, 5 or 10, or any question on page 2 — you must obtain your physician's approval before participating in diving activities, and provide it to the shop.

Note: if you are pregnant, or attempting to become pregnant, do not dive.

Participant Statement: I have answered all questions on the Diver Medical Participant Questionnaire honestly, and I understand that I accept responsibility for any consequences resulting from any questions I may have answered inaccurately or for my failure to disclose any existing or past health conditions. I affirm it is my responsibility to inform the shop of any change to my health condition.$body$
),
(
  'continuing_education',
  'Continuing Education Liability Release',
  'per_event', 1, 'courses', array['ow','aow','rescue','specialty'],
  $body$RELEASE OF LIABILITY / ASSUMPTION OF RISK / NON-AGENCY ACKNOWLEDGMENT — CONTINUING EDUCATION

Safe diving practices: I understand that as a diver I should maintain good mental and physical fitness for diving; be familiar with my dive sites; use complete, well-maintained, reliable equipment and inspect it before each dive; listen to dive briefings and respect the advice of those supervising my diving; adhere to the buddy system; be proficient in dive planning; maintain proper buoyancy; breathe properly and never breath-hold on scuba; use surface support when feasible; and know and obey local dive laws. I recognize these practices are for my own safety and that failure to adhere to them can place me in jeopardy.

Non-agency acknowledgment: I understand and agree that PADI Members, including the instructors and divemasters associated with this program, are licensed to use PADI Trademarks and conduct PADI training, but are not agents, employees or franchisees of PADI Americas, Inc. Member business activities are independent and are neither owned nor operated by PADI. In the event of injury or death during this activity, neither I nor my estate shall seek to hold PADI liable for the actions, inactions or negligence of the Members or their associated staff.

Liability release and assumption of risk: I affirm I am aware that skin and scuba diving have inherent risks which may result in serious injury or death, including decompression sickness, embolism or other hyperbaric/air-expansion injury. This Agreement encompasses all diver training activities and courses in which I choose to participate. I agree that neither my instructors, divemasters, the facility offering the programs, nor PADI Americas, Inc. and its related entities (the "Released Parties") may be held liable for any injury, death or damages to me, my family, estate, heirs or assigns resulting from my participation or the negligence of any party, whether passive or active. In consideration of being allowed to participate, I personally assume all risks, whether foreseen or unforeseen.

I confirm I have completed the attached Diver Medical Form (10346) and that it is my responsibility to inform my instructor of any change to my medical history at any time. I am of lawful age and legally competent to sign, or have acquired the written consent of my parent or guardian, and I sign of my own free act.

PADI Product No. 10038.$body$
);

-- ── 2. cancellation_policies: CRUD metadata ─────────────────────────────────
-- The table pre-dates admin CRUD (id had no default; no language/active). Give
-- id a default so the admin form can insert without minting a client-side uuid,
-- and add the same free-form language label + active flag as waivers.
alter table public.cancellation_policies
  alter column id set default gen_random_uuid();
alter table public.cancellation_policies
  add column if not exists language text,
  add column if not exists active boolean not null default true;

-- ── 3. waiver-pdfs storage bucket ───────────────────────────────────────────
-- Private bucket for shop-uploaded PDF waiver templates. Admins manage the
-- files; any authenticated diver reads them (to view + e-sign). Unlike the
-- per-owner cert-cards buckets, these are shared shop templates, so read is not
-- folder-scoped.
insert into storage.buckets (id, name, public)
  values ('waiver-pdfs', 'waiver-pdfs', false)
  on conflict (id) do nothing;
create policy "waiver-pdfs: admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'waiver-pdfs' and public.is_admin());
create policy "waiver-pdfs: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'waiver-pdfs' and public.is_admin())
  with check (bucket_id = 'waiver-pdfs' and public.is_admin());
create policy "waiver-pdfs: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'waiver-pdfs' and public.is_admin());
create policy "waiver-pdfs: authenticated read" on storage.objects
  for select to authenticated
  using (bucket_id = 'waiver-pdfs');
