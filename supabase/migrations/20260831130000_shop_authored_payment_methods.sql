-- Shop-authored payment methods.
--
-- The four payment options a diver could pick were a hardcoded TypeScript union
-- (bank_transfer | paypal | credit_card | cash) whose "how to pay" copy lived in
-- the message catalogs and whose surcharge came from business.cardSurchargePercent.
-- A shop could not add a method, could not publish its own bank account, and
-- could not charge a different rate per method.
--
-- This moves the catalog into the DB. `key` is the stable identifier already
-- stored in bookings.details.payment_method, so every existing booking keeps
-- resolving without a backfill; everything else about a method — its label, its
-- surcharge, its bank account, whether it collects an invoice email — becomes
-- admin-editable. Bank details are structured columns rather than free text so
-- the app can label them in the deployment's language; only the values are
-- shop-authored (and therefore never translated).

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  -- Stable wire value stored on bookings.details.payment_method. Never reused
  -- for a different method: old bookings resolve their instructions through it.
  key text not null unique,
  -- Shop-authored display name, in whatever language the shop runs in.
  label text not null,
  -- Optional one-line hint shown under the radio on the register form.
  blurb text,
  -- Percentage added to the booking subtotal when this method is chosen.
  -- 0 for cash / bank transfer; the old business.cardSurchargePercent for
  -- card and PayPal, which this column replaces.
  surcharge_percent numeric(5,2) not null default 0,
  -- Structured transfer details. All optional: a method that needs none (cash)
  -- leaves them null and the "how to pay" block simply omits the rows.
  bank_name text,
  bank_branch text,
  bank_code text,
  account_number text,
  account_holder text,
  swift_bic text,
  -- Where a diver pays online (paypal.me, a card payment page).
  pay_url text,
  -- Free-form extra instructions, rendered one line per newline.
  notes text,
  -- Asks the diver where to send the invoice (credit card).
  collects_invoice_email boolean not null default false,
  -- Appends the shop's phone / address / map from fundive.config.ts, so the
  -- contact details stay in exactly one place (cash).
  shows_shop_contact boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  constraint payment_methods_key_format check (key ~ '^[a-z0-9_]{1,50}$'),
  constraint payment_methods_label_len check (char_length(btrim(label)) between 1 and 100),
  constraint payment_methods_surcharge_range check (surcharge_percent >= 0 and surcharge_percent <= 100),
  constraint payment_methods_pay_url_format check (pay_url is null or pay_url ~ '^https?://')
);

create index payment_methods_active_idx on public.payment_methods using btree (sort_order) where (active);

alter table public.payment_methods enable row level security;

-- Diver-readable reference data (mirrors waivers / cancellation_policies) —
-- the register form has to render the options before sign-in completes.
create policy "payment_methods: public select" on public.payment_methods
  for select to authenticated, anon using (true);
create policy "payment_methods: admin insert" on public.payment_methods
  for insert to authenticated with check (public.is_admin());
create policy "payment_methods: admin update" on public.payment_methods
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payment_methods: admin delete" on public.payment_methods
  for delete to authenticated using (public.is_admin());

grant select on public.payment_methods to anon, authenticated;
grant insert, update, delete on public.payment_methods to authenticated;
grant all on public.payment_methods to service_role;

-- Seed the four methods that were hardcoded, carrying their catalog copy across
-- verbatim so nothing a diver sees changes on deploy, plus the international
-- transfer the shop was handling out-of-band. Bank fields are left empty for
-- the shop to fill in from Manage -> Payment methods; until they do, the
-- register form falls back to the "we'll email you our details" line.
insert into public.payment_methods
  (key, label, surcharge_percent, notes, pay_url, collects_invoice_email, shows_shop_contact, sort_order)
values
  ('bank_transfer', 'Domestic bank transfer', 0,
   'Put your full name in the transfer memo so we can match the payment to your booking.',
   null, false, false, 10),
  ('bank_transfer_intl', 'International bank transfer', 0,
   'Put your full name in the transfer memo so we can match the payment to your booking. Sending bank fees are the sender''s responsibility.',
   null, false, false, 20),
  ('paypal', 'PayPal', 5,
   'Include your full name in the payment note so we can match it to your booking.',
   null, false, false, 30),
  ('credit_card', 'Credit card', 5,
   'We''ll email you an invoice with a credit-card payment link.',
   null, true, false, 40),
  ('cash', 'Cash (in person at the shop)', 0,
   'Bring your payment to the shop in person.',
   null, false, true, 50);
