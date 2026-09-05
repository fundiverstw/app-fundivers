-- Shop-authored contact details, and the buttons that reach the shop.
--
-- How to reach the shop was five literals in fundive.config.ts: an email, a
-- phone number, an address, a maps link, and exactly two chat buttons (LINE and
-- WhatsApp) whose URLs were config fields and whose EXISTENCE was hardcoded in
-- ContactPage.tsx. A shop on Telegram had no way to say so, a shop that changed
-- its email needed a developer and a redeploy, and a fork with neither LINE nor
-- WhatsApp got two dead buttons.
--
-- Two tables, because they answer different questions. `shop_contact` is a
-- single row of facts about the business — the same email that receives a
-- partner enquiry and appears in the "we could not verify that link" notice.
-- `contact_channels` is an ordered LIST of ways in, which is the part that
-- differs per shop and per country: one shop is on LINE, another on WhatsApp
-- and Instagram, a third answers the phone.
--
-- `kind` is a closed vocabulary and not a free-text icon name, because each
-- value carries a glyph and the brand color divers recognise, and those live in
-- code where they can be reviewed. Shop-authored SVG in a table would be markup
-- from the database rendered into the page, which is the shape of an XSS bug.
-- `other` is the escape hatch: any link, a neutral glyph, a shop-written label.
--
-- The URL column holds what the KIND needs — an https link for a chat service,
-- a bare phone number for `phone` / `sms`. The client turns the second into a
-- `tel:` / `sms:` href (`channelHref` in src/lib/contact.ts); storing the scheme
-- would mean an admin typing "tel:" into a box labelled "phone number".

create table public.shop_contact (
  -- Exactly one row, forever, the way `terms` does it.
  singleton  boolean primary key default true check (singleton),
  -- Where mail to the shop goes. Read by the app AND by the edge functions
  -- (partner-connect sends here; admin-create-diver blind-copies it), so
  -- changing it in Manage changes it everywhere rather than in one surface.
  email      text not null default '',
  phone      text not null default '',
  address    text not null default '',
  maps_url   text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  -- Empty is allowed and means "not published" — a shop mid-setup has no email
  -- yet, and every surface that shows one already has to handle its absence.
  -- What is not allowed is something that is not an address at all.
  constraint shop_contact_email_format
    check (email = '' or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint shop_contact_maps_url_format
    check (maps_url is null or maps_url ~ '^https?://')
);

comment on table public.shop_contact is
  'The shop''s own contact details. Exactly one row. Replaces siteConfig.contact.';

insert into public.shop_contact (singleton, email, phone, address, maps_url) values (
  true,
  'fundiverstw@gmail.com',
  '+886 909-083-683',
  'No. 8, Heping St, Yonghe District, New Taipei City, 23446',
  'https://maps.app.goo.gl/tDgtMirMrNX9QEjAA'
);

alter table public.shop_contact enable row level security;

-- Readable by anyone: the contact details appear on pages a diver reaches
-- before their account is approved, and in the terms-acceptance flow, which
-- runs from an emailed link with no session at all.
create policy "shop_contact: public select" on public.shop_contact
  for select to authenticated, anon using (true);
create policy "shop_contact: admin update" on public.shop_contact
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No insert or delete policy, deliberately: the row is seeded here and the
-- singleton check makes a second one impossible. An admin edits it; nobody
-- removes it.
grant select on public.shop_contact to anon, authenticated;
grant update on public.shop_contact to authenticated;
grant all on public.shop_contact to service_role;


create table public.contact_channels (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  -- Which service. Pinned to CONTACT_CHANNEL_KINDS in src/types/database.ts,
  -- which is where the glyph and the brand color for each one live.
  kind       text not null,
  -- Button text. Null means "use the deployment's own wording for this kind",
  -- so a shop that just adds a Telegram link gets a translated button; a shop
  -- that wants "Ask us about courses" writes that instead. Shop-authored text
  -- is never translated.
  label      text,
  -- An https link for a chat service; a bare phone number for phone / sms.
  url        text not null,
  sort_order integer not null default 0,
  -- Retire a channel without deleting it: the account may come back, and the
  -- row records that it once was a way in.
  active     boolean not null default true,
  constraint contact_channels_kind_check check (kind in (
    'line', 'whatsapp', 'telegram', 'messenger', 'instagram',
    'wechat', 'signal', 'phone', 'sms', 'other'
  )),
  constraint contact_channels_label_len
    check (label is null or char_length(btrim(label)) between 1 and 60),
  constraint contact_channels_url_format check (
    case when kind in ('phone', 'sms')
      then url ~ '^[+0-9][0-9 ()+.-]{4,30}$'
      else url ~ '^https?://'
    end
  )
);

comment on table public.contact_channels is
  'The ways a diver can reach the shop, in the order the Contact page lists them.';

create index contact_channels_active_idx
  on public.contact_channels using btree (sort_order) where (active);

alter table public.contact_channels enable row level security;

create policy "contact_channels: public select" on public.contact_channels
  for select to authenticated, anon using (true);
create policy "contact_channels: admin insert" on public.contact_channels
  for insert to authenticated with check (public.is_admin());
create policy "contact_channels: admin update" on public.contact_channels
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "contact_channels: admin delete" on public.contact_channels
  for delete to authenticated using (public.is_admin());

grant select on public.contact_channels to anon, authenticated;
grant insert, update, delete on public.contact_channels to authenticated;
grant all on public.contact_channels to service_role;

-- The two buttons the Contact page had hardcoded, carried across with their
-- current links so nothing a diver sees changes on deploy. Labels stay null:
-- the wording they already had lives in the message catalogs, which is where a
-- translated deployment needs it.
insert into public.contact_channels (kind, url, sort_order) values
  ('line',     'https://line.me/R/ti/p/%40lga0216c', 1),
  ('whatsapp', 'https://wa.me/886909083683',         2);
