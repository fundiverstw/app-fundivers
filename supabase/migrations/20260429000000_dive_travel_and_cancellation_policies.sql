-- public."DiveTravel" and public.cancellation_policies — reference
-- tables that EO_dives joins via the existing TEXT columns
-- "DiveTravel_reference" and "cancel_policy" (see
-- 20260421130941_remote_schema.sql). Until now both tables only existed
-- as Wix CMS collections; the wix-site detail page can't render
-- Included / Not Included / Transportation / Cancellation Policy
-- without them in Supabase, so we recreate them here.
--
-- _id is text (not uuid) to match the pre-existing FK columns on
-- EO_dives (which are text) and to mirror the EO_prices / EO_courses
-- legacy Wix-style "_id text" PK convention. Column names are kept in
-- a CSV-import-friendly shape: "Created Date" / "Updated Date" /
-- "Owner" match the Wix export headers verbatim. cancelation_policy
-- intentionally preserves the single-'l' spelling from the Wix column
-- so a CSV import drops in cleanly.

begin;

-- DiveTravel — what's included / not included / how diving is reached.
-- Seeded empty: the live values still live in the Wix collection and
-- need to be exported separately; once admins paste them in, the
-- existing EO_dives.DiveTravel_reference values will resolve.
create table public."DiveTravel" (
  _id              text primary key,
  title            text,
  included         text,
  not_included     text,
  transportation   text,
  "Created Date"   timestamptz not null default now(),
  "Updated Date"   timestamptz not null default now(),
  "Owner"          text
);

-- cancellation_policies — refund / reschedule rules per trip type.
-- Seeded with the five known policies below.
create table public.cancellation_policies (
  _id                  text primary key,
  title                text,
  cancelation_policy   text,
  "Created Date"       timestamptz not null default now(),
  "Updated Date"       timestamptz not null default now(),
  "Owner"              text
);

-- Five canonical cancellation policies, ids preserved from the Wix
-- "Collection Policies" CSV so existing EO_dives.cancel_policy values
-- resolve without a remap.
insert into public.cancellation_policies
  (_id, title, "Created Date", "Updated Date", "Owner", cancelation_policy) values
  ('1b76813a-c57c-4c1c-ae87-45a6ed389e47',
   'Local Multi-day Trip',
   '2026-03-25T07:49:16Z', '2026-03-25T07:59:06Z',
   'b37fefa3-09b1-4e00-a824-f6b884e43572',
   'If diver cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees) of any payment made above the deposit amount. The deposit, however, is non-refundable. If the trip is canceled by Fun Divers Taiwan for any reason, the diver can choose to reschedule or get a full refund (minus transfer/bank/PayPal fees).'),
  ('465f1e26-17d5-4784-b9bd-2c5dd8a36560',
   'International Trip',
   '2026-03-25T07:55:28Z', '2026-03-25T07:58:25Z',
   'b37fefa3-09b1-4e00-a824-f6b884e43572',
   'If diver cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees) of any payment made above the deposit amount. The deposit, however, is non-refundable. If the trip is canceled by Fun Divers Taiwan for any reason, and can''t be rescheduled, then the diver can get a full refund (minus transfer/bank/PayPal fees).'),
  ('652b34df-4cb7-48ab-91dc-41ae9e2d1f29',
   'Local Day Trip',
   '2026-03-25T07:49:08Z', '2026-03-25T07:57:48Z',
   'b37fefa3-09b1-4e00-a824-f6b884e43572',
   'If diver cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees). If the dives are canceled by Fun Divers Taiwan for any reason, the diver can choose to reschedule or get a full refund (minus transfer/bank/PayPal fees).'),
  ('7409de8f-dbfd-403d-9db8-3c84721c7717',
   'Course without Elearning',
   '2026-03-25T08:07:37Z', '2026-03-25T08:11:26Z',
   'b37fefa3-09b1-4e00-a824-f6b884e43572',
   'If student cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees). If the course is canceled by Fun Divers Taiwan for any reason, the diver can choose to reschedule or get a full refund (minus transfer/bank/PayPal fees).'),
  ('8ed8bb2a-abf8-482c-8a34-bf532232b5ce',
   'Course with Elearning',
   '2026-03-25T08:03:44Z', '2026-03-25T08:07:36Z',
   'b37fefa3-09b1-4e00-a824-f6b884e43572',
   'If diver cancels by the date above, they can get a full refund (minus transfer/bank/PayPal fees) of any payment made above the deposit amount. The deposit, however, is non-refundable. If the course is fully or partially canceled by Fun Divers Taiwan for any reason, and can''t be rescheduled, then the diver can use the PADI E-learning at any PADI shop around the world.  If any course dives were finished, student will also receive a PADI Referral Form which can also be used at any PADI Shop around the world.');

-- RLS — public read so the wix-site iframe (anon key) can join, admin
-- write so only the admin app can mutate. Mirrors cert_levels exactly.
alter table public."DiveTravel" enable row level security;
alter table public.cancellation_policies enable row level security;

drop policy if exists "DiveTravel: public select" on public."DiveTravel";
drop policy if exists "DiveTravel: admin insert" on public."DiveTravel";
drop policy if exists "DiveTravel: admin update" on public."DiveTravel";
drop policy if exists "DiveTravel: admin delete" on public."DiveTravel";

create policy "DiveTravel: public select"
  on public."DiveTravel" for select to anon, authenticated using (true);
create policy "DiveTravel: admin insert"
  on public."DiveTravel" for insert to authenticated
  with check (public.is_admin());
create policy "DiveTravel: admin update"
  on public."DiveTravel" for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());
create policy "DiveTravel: admin delete"
  on public."DiveTravel" for delete to authenticated
  using (public.is_admin());

drop policy if exists "cancellation_policies: public select" on public.cancellation_policies;
drop policy if exists "cancellation_policies: admin insert" on public.cancellation_policies;
drop policy if exists "cancellation_policies: admin update" on public.cancellation_policies;
drop policy if exists "cancellation_policies: admin delete" on public.cancellation_policies;

create policy "cancellation_policies: public select"
  on public.cancellation_policies for select to anon, authenticated using (true);
create policy "cancellation_policies: admin insert"
  on public.cancellation_policies for insert to authenticated
  with check (public.is_admin());
create policy "cancellation_policies: admin update"
  on public.cancellation_policies for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());
create policy "cancellation_policies: admin delete"
  on public.cancellation_policies for delete to authenticated
  using (public.is_admin());

-- FK from EO_dives.cancel_policy → cancellation_policies. Validated:
-- every value in seed.sql is one of the five known policy ids.
alter table public."EO_dives"
  add constraint "EO_dives_cancel_policy_fkey"
  foreign key ("cancel_policy")
  references public.cancellation_policies(_id)
  on update cascade on delete set null;

-- DiveTravel FK is deliberately NOT added here. seed.sql contains
-- EO_dives rows whose DiveTravel_reference uuids point at rows that
-- still only live in the Wix collection — adding the FK before the
-- import would block `supabase db reset`. Once admins populate
-- DiveTravel from the Wix export, a follow-up migration should add:
--   alter table public."EO_dives"
--     add constraint "EO_dives_DiveTravel_reference_fkey"
--     foreign key ("DiveTravel_reference") references public."DiveTravel"(_id)
--     on update cascade on delete set null;
-- (and validate it once data is consistent).

create index "EO_dives_DiveTravel_reference_idx"
  on public."EO_dives" ("DiveTravel_reference")
  where "DiveTravel_reference" is not null;

create index "EO_dives_cancel_policy_idx"
  on public."EO_dives" ("cancel_policy")
  where "cancel_policy" is not null;

commit;
