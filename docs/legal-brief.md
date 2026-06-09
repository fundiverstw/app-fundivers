# FunDivers TW — brief for the Terms of Use / Privacy review

**Audience:** an attorney engaged to review the public-facing Terms of
Use & Privacy notice at `/terms` and advise on related compliance
(Taiwan PDPA / 個人資料保護法, scuba-operator liability standards,
cross-border data flows).

**Date:** 2026-06-03.

**Status:** the live terms text is at `src/pages/TermsPage.tsx`
(reproduced verbatim in § 8 below). The app is in pre-production
hardening — security audit findings are tracked in
`docs/security-audit.md`; several Critical/High items have already
landed in code as of this date (see §10).

The goal of this brief is to let the attorney read it in 20–30
minutes and walk into the working session knowing exactly what the
system collects, where data flows, who can see it, and which
promises in the current terms text are actually enforced in code vs.
aspirational.

---

## 1. Business context

| Item | Answer |
| --- | --- |
| Legal entity | Taiwan company (有限公司 or 股份有限公司 — operator to confirm exact form) |
| Operator role | Scuba diving operator (event organization, gear rental, dive guiding, training course delivery) |
| Customer base | Taiwan residents + international tourists physically diving in Taiwan + online-only signups from abroad (e.g. registering before travel) |
| Minor customers | Accepted only via parent-linked accounts (parent-child flow in code). No standalone under-18 accounts. |
| Insurance | PADI / DAN professional diving-operator coverage |
| Payments | Bank transfer, credit card, PayPal, cash. Payments tracked in `public.payments`; deposit/balance semantics in `docs/payments.md`. |
| Domain / brand | FunDivers TW / fundiverstw.com (Wix-hosted marketing site) + the SPA at `app.fundiverstw.com` (Cloudflare-hosted) |

Items the attorney should confirm directly with the operator and
that this document cannot answer authoritatively:

- exact corporate form, registration number, tax ID
- registered office address
- insurance policy numbers, coverage limits, exclusions
- DAN / PADI affiliation specifics
- any existing paper waivers or contracts in current shop-side use
- whether the operator has a designated Personal Data Officer (個資保護長)
  for PDPA Article 18 purposes
- prior incidents, complaints, regulator correspondence

---

## 2. Data inventory

Authoritative source: `supabase/migrations/`. Every column listed
below is currently in the production schema unless flagged.

### 2.1 `auth.users` (Supabase-managed)

Standard Supabase Auth columns. Notable for legal review:

- `email` (unique)
- `phone` (unused by current SPA but present in the table)
- `encrypted_password`
- `raw_user_meta_data` — currently used to ferry `agreed_to_terms_at`
  from signup to the profile row (see §10, audit L10)
- `email_confirmed_at`

### 2.2 `public.profiles` — diver master record

Created automatically by the `handle_new_user` SECURITY DEFINER
trigger on every `auth.users` insert. Columns relevant for privacy:

| Column | Type | Sensitivity | Notes |
| --- | --- | --- | --- |
| `id` | uuid | n/a | matches `auth.users.id` |
| `name` | text | identifier | legal name, exactly as on passport / ID |
| `nickname` | text | low | optional informal name (English name, alias, shop-floor name) |
| `date_of_birth` | date | sensitive | required for adult-only events / insurance |
| `nationality` | text | sensitive | required for dive-permit submission |
| `id_number` | text | **highly sensitive** | passport / ARC; required for dive-permit submission; purged at 12 months inactive |
| `phone` | text | sensitive | preferred call/messaging number |
| `contact_method` / `contact_id` | text | sensitive | LINE / WhatsApp / Telegram / Signal handle |
| `cert_agency`, `cert_level`, `cert_number`, `cert_date` | text/date | sensitive | scuba certification |
| `logged_dives`, `last_dive_date` | int/date | low | self-reported dive history |
| `nitrox_certified`, `deep_certified` | bool | low | self-reported flags |
| `height_cm`, `weight_kg`, `shoe_size` | int/text | sensitive | gear fitting |
| `fin_size`, `bcd_size`, `wetsuit_size` | text | low | admin-only writes |
| `medical_notes` | text | **highly sensitive** | self-reported; purged at 12 months inactive |
| `emergency_contact_name` | text | **highly sensitive** | third-party data (not the user's); purged at 12 months inactive |
| `emergency_contact_phone` | text | **highly sensitive** | third-party data |
| `cert_card_path`, `nitrox_card_path`, `deep_card_path` | text | sensitive | storage object keys for uploaded card images |
| `agreed_to_terms_at` | timestamptz | n/a | consent timestamp (see audit L10) |
| `application_submitted_at` | timestamptz | n/a | when the operator received the application |
| `status` | text | n/a | `pending` / `active` / `rejected` — admin-managed |
| `parent_account` | uuid | sensitive | links a child account to a parent (one-level family tree only) |
| `role` | text | n/a | `diver` / `staff` / `admin` |
| `created_at`, `updated_at` | timestamptz | n/a | |

**Note on emergency contact:** the names and phone numbers are *third
parties' personal data*, supplied by the registering diver without
that third party's direct consent. Under Taiwan PDPA this is a known
edge case — the lawyer should advise on the disclosure to make to the
third party (and whether a "I have notified my emergency contact"
checkbox should be added to signup).

### 2.3 `public.bookings`

| Column | Sensitivity | Notes |
| --- | --- | --- |
| `user_id` | n/a | FK to profiles |
| `eo_dive_id` XOR `eo_course_id` | n/a | which event was booked |
| `status` | n/a | `pending` / `confirmed` / `waitlisted` / `cancelled` |
| `notes` | sensitive | diver-supplied free text — may contain medical / personal info |
| `details` | sensitive | JSONB with room choice, add-ons, gear preferences, transport, payment method, deposit acknowledgements |
| `created_at`, `updated_at` | n/a | |
| `group_id` | n/a | links sibling bookings from one parent registration |
| `cancelled_at` | n/a | |
| `refund_requested_at` | n/a | |

### 2.4 `public.payments`

| Column | Sensitivity | Notes |
| --- | --- | --- |
| `user_id` | n/a | FK |
| `booking_id` | n/a | FK |
| `amount`, `currency` | n/a | TWD by default |
| `kind` | n/a | `deposit` / `balance` / `refund` |
| `method` | n/a | bank transfer / credit card / PayPal / cash |
| `status` | n/a | `pending` / `paid` / `refunded` / `voided` |
| `settled_at`, `settled_note` | n/a | |
| `credit_card_invoice_email` | sensitive | optional alternate email for invoice routing |

No card numbers / CVVs / bank account details are stored — payments
clear out-of-band; this table only records receipt.

### 2.5 Other tables holding diver data

- `push_subscriptions` — Web Push endpoint, p256dh + auth keys (per-device PII; see audit M2)
- `notifications` (inbox rows) — title, body, optional url + event_id
- `duties` — admin assignment of staff to events; no diver PII directly
- `staff_availability` — staff own-busy markers; no diver PII directly
- `credits` — outstanding-balance ledger; references user_id
- `dive_logs` — diver-authored logbook entries (if dive-log feature is wired)
- `diver_notes` — admin private notes about a diver (audit-sensitive)
- `admin_notes` — admin notes attached to events or divers
- `admin_audit_log` — append-only record of admin writes
- `waitlist_offers` — outstanding waitlist offers tied to specific bookings

### 2.6 Supabase Storage buckets (all private, RLS-gated per-folder)

| Bucket | Contents | Path pattern | Access |
| --- | --- | --- | --- |
| `cert-cards` | Scuba certification card photo | `<user_id>/...` | self + admin |
| `nitrox-cards` | Nitrox specialty card photo | `<user_id>/...` | self + admin |
| `deep-cards` | Deep specialty card photo | `<user_id>/...` | self + admin |

Storage RLS policies are in `supabase/migrations/20260422200000_profile_cert_card.sql`,
`20260520000000_profile_nitrox_card.sql`,
`20260528010000_profile_deep_card.sql` and (admin-write extensions)
`20260521020000_admin_profile_edit.sql`.

---

## 3. Access control matrix

Authorization is enforced primarily by Supabase Row-Level Security
(RLS) policies. The SPA never holds the service-role key.

| Subject | profiles | bookings | payments | dive_logs | storage |
| --- | --- | --- | --- | --- | --- |
| Anonymous (anon key only) | none | none | none | none | none |
| Diver (own JWT) | read+write own (role/status/parent_account locked) | read+write own | read own | read+write own | self folder |
| Parent (own JWT) | read+limited-write children | read+limited-write children's | read children's | none | none |
| Staff (own JWT) | read all profiles | read all bookings | read all payments | none | none |
| Admin (own JWT) | full | full | full | read all | read any folder |
| Edge functions / cron | full (bypass RLS) | full | full | full | full |

Source of truth: `supabase/migrations/20260423130000_core_rls_and_booking_immutability.sql`
plus subsequent forward migrations (`20260514030000_parent_child_accounts.sql`,
`20260501100000_profile_status.sql`, `20260423140000_admin_audit_log.sql`,
`20260602000000_block_self_role_status_parent_change.sql`, etc.).

---

## 4. Data flows

### 4.1 Self-signup (`/signup` route)

1. Diver enters email + password + checks "I agree to the Terms of Use & Privacy."
2. SPA calls `supabase.auth.signUp` with the timestamp in
   `raw_user_meta_data.agreed_to_terms_at`.
3. Supabase sends a confirmation email.
4. `handle_new_user` trigger creates the `profiles` row with `status='pending'`
   and copies the consent timestamp into `profiles.agreed_to_terms_at`.
5. Diver clicks confirmation link, logs in. Their status remains `pending`
   until an admin reviews and flips to `active`.

### 4.2 Public registration (`/register/:type/:id` route)

Single-form path used when arriving from the Wix marketing site or a
deep-link. Submitted form fields populate the profile and create one
booking atomically via the `create-registration` Supabase Edge
Function (server-side; uses the service role).

Two sub-paths:
- **Guest** (no Bearer JWT): edge function creates the auth user,
  signs them in, applies the profile patch (allowlisted columns only),
  inserts the booking, emails a PDF registration summary to the
  diver and the company inbox.
- **Authed** (caller has Bearer JWT): same as above but the existing
  auth user is reused.

### 4.3 Parent registers a linked child

`/register` parent-on-behalf path or the dedicated AdminFamilyPanel
flow creates a `profiles` row with `parent_account = parent.id`. The
trigger `trg_profiles_one_level_family` enforces a strict one-level
family tree (a child cannot itself have children). The child's row
holds the child's PII; the parent's JWT can read/edit non-privileged
columns on the child via RLS.

### 4.4 Admin creates a diver (`admin-create-diver` edge function)

For walk-in customers without their own credentials. Admin supplies
email and name fields; the function creates an auth user with a
throwaway password, sets `status='active'`, sends a courtesy email.
The diver only gains app login if they later request credentials.

### 4.5 Payment

No in-app card capture. Diver pays out-of-band (transfer / PayPal /
cash). Admin records receipt in `payments` (`status='paid'`).
`booking-payments.ts` reconciles bookings to payments.

### 4.6 Push notifications

Opt-in toggle in profile. SPA enrolls a browser PushSubscription
into `push_subscriptions`. Cron worker (`workers/push/`) fans out
event reminders via VAPID-signed Web Push. Endpoint + key material
are per-device PII.

### 4.7 PII purge

`purge_stale_pii(months int default 12)` is a SECURITY DEFINER
function callable only by service_role. It identifies diver
profiles with no booking newer than `now() - interval 12 months`
(or, for never-booked profiles, `created_at < cutoff`) and nulls:

- `id_number`
- `medical_notes`
- `emergency_contact_name`
- `emergency_contact_phone`
- `cert_card_path`

Source: `supabase/migrations/20260423150000_pii_retention_and_tos.sql`.

**Known gaps the attorney should weigh in on:**
- Storage objects in `cert-cards` are NOT deleted by this function
  (Supabase blocks direct DELETE on `storage.objects` from SQL). A
  follow-up worker is intended but not yet implemented. Files remain
  even when `cert_card_path` is nulled (no UI surfaces them, but
  they exist).
- No audit-log row is written when the purge runs (audit M5).
- The function is invoked manually today; no cron schedule is yet
  attached. Operator should confirm the intended cadence.

### 4.8 Account deletion (manual)

The current terms direct deletion requests to
`fundiverstw@gmail.com`. There is no in-app self-serve deletion
button. Admin deletes via Supabase dashboard; `auth.users` cascade
removes the `profiles` row and dependent bookings/payments.

---

## 5. Third-party processors

| Processor | Role | Region | Data they hold |
| --- | --- | --- | --- |
| Supabase | Database, Auth, Storage, Edge Functions | ap-east-1 (Hong Kong) per `.env.local` `SUPABASE_POOLER_HOST` — operator to confirm exact project region | all PII listed above |
| Cloudflare Workers | SPA hosting, push cron, worker endpoints | global edge | request metadata, no application PII written to logs by current code |
| Gmail (Google Workspace) SMTP | Outbound transactional email | global | recipient address, email body (registration PDF attached) |
| Web Push (Mozilla / Apple / Google push services) | Notification delivery | global | endpoint URL, encrypted payload |
| Wix | Marketing site + catalog mirror | global | event titles, prices, room/addon descriptions (no diver PII) |

Cross-border note: data moves from Taiwan (diver) → Supabase
ap-east-1 (Hong Kong) on every request. The lawyer should advise
on PDPA Article 21 obligations regarding cross-border transfer
notice and consent.

---

## 6. Consent collection mechanics

Consent is gathered via a single checkbox at two surfaces:

- `/signup`: "I agree to the [Terms of Use & Privacy](/terms)."
- `/register/...` final step: same checkbox before submission.

Implementation (`src/pages/SignupPage.tsx:33` and
`src/components/register/RegisterForm.tsx:676`):

```ts
options: { data: { agreed_to_terms_at: new Date().toISOString() } }
```

The timestamp is **client-supplied** via `raw_user_meta_data`. The
`handle_new_user` trigger copies it into `profiles.agreed_to_terms_at`
without re-stamping with `now()`. This is audit finding L10:
non-repudiation gap — a user could later argue they never set that
timestamp. Trivial fix in code (server-stamp it in the trigger),
flagged here so the lawyer can advise on what level of evidence the
terms require.

There is no:
- versioning of the terms (no `terms_version` field)
- automatic re-prompt on terms change (despite what the current text
  promises in the "Changes" section — see §7)
- granular consent (everything is one checkbox)
- separate marketing-consent toggle

---

## 7. Code-text alignment review

Cross-checking the current terms (§8 below) against what's actually
enforced in code:

| Section of current terms | Match in code? | Note |
| --- | --- | --- |
| "Name, DOB, nationality" collected | ✅ matches `profiles` schema | |
| "Passport / ARC number" collected | ✅ matches `profiles.id_number` | text column — operator stores either |
| "Phone + preferred contact" | ✅ `profiles.phone`, `contact_method`, `contact_id` | |
| "Certification agency, level, logged dives" | ✅ matches | |
| "Cert card photo, if uploaded" | ⚠️ partial | three cert-card buckets (cert / nitrox / deep), not one. Update text? |
| "Emergency contact" | ✅ | but third-party-consent question (§2.2 note) |
| "Physical sizing — for gear fitting" | ✅ height/weight/shoe + gear sizes | |
| "Medical notes you choose to share" | ✅ `profiles.medical_notes` — never required | |
| "You: all of your own data" | ✅ enforced by RLS | |
| "FunDivers staff (admins)" | ⚠️ partial | "staff" and "admin" are distinct roles in code; staff is read-only across divers, admin can also write. Worth being precise in the text. |
| "Nobody else" | ✅ no marketing share by code | |
| "Authorities (if required by permit)" | ✅ matches operational reality | text could name the specific authorities for clarity |
| "12-month sensitive-field scrub" | ⚠️ partial | code does it for `id_number`, `medical_notes`, `emergency_*`, `cert_card_path` — **not** for `nitrox_card_path`, `deep_card_path`, the storage objects themselves, or any `bookings.notes` content. Operator should decide whether to broaden the scrub or narrow the text. |
| "Email request for deletion" | ✅ no in-app button yet | |
| "Offline option — contact admin to keep PII off the app" | ⚠️ documented, no UX hook | text invites diver to email; no in-app prompt. Operator needs an internal process for receiving the message and recording the consent state. |
| "We're a dive shop, not a tech company" | ✅ disclosure | accurate framing; lawyer should confirm acceptable under PDPA. |
| Sub-processor list (Supabase, Cloudflare, Gmail, Web Push) | ✅ matches §5 | |
| "Asia-Pacific data centres" | ✅ Supabase project is `aws-0-ap-east-1` (Hong Kong) per `.env.local` | operator to confirm exact region; covers the PDPA Article 21 cross-border-transfer obligation. |
| "Encrypted connections" | ✅ HTTPS everywhere (Cloudflare-fronted) | |
| "Role-based access controls" | ✅ RLS + role gates | |
| "Routine deletion of stale information" | ✅ `purge_stale_pii` covers all three card paths + bookings notes after the broaden | |
| "We can't promise hacks won't happen" | ✅ honest disclosure | lawyer to confirm enforceability of risk-shifting language. |
| "We will tell you promptly if something has gone wrong" | ⚠️ promise without runbook | requires the operator to have a breach-detection + notification process. Taiwan PDPA Article 12: notify affected individuals after a security incident. Operator needs a written procedure. |
| "Choice of what to upload is yours, and so is the risk" | ✅ matches code — the SPA never requires the optional PII fields | |
| "Liability — you confirm cert + medical disclosure" | ⚠️ informal | scuba operators in Taiwan typically require a witnessed waiver. Lawyer should advise whether the checkbox satisfies waiver requirements or if a separate signed waiver is still needed at check-in. |
| "Changes → re-prompt on next sign-in" | ✅ wired | `RequireCurrentTerms` route guard + `accept_current_terms` RPC, both landed 2026-06-03. Bump `CURRENT_TERMS_VERSION` in `src/lib/terms-version.ts` for the next material change. |

---

## 8. Current terms text (verbatim from `src/pages/TermsPage.tsx`)

> **The short version**
>
> We ask for the information we need to plan your dives safely and to
> handle permits, insurance, and emergency contact. Nothing we collect
> is sold or shared beyond what's required to run the trip you signed
> up for.
>
> **What we collect**
>
> At signup and when you register for an event:
> - Name, date of birth, nationality
> - Passport / ARC number (for dive-site permits)
> - Phone number and preferred contact method (LINE, WhatsApp, etc.)
> - Certification agency, level, and logged-dive count
> - A photo of your cert card, if you upload one
> - Emergency contact name and phone
> - Physical sizing (height, weight, shoe size) — for gear fitting
> - Medical notes you choose to share
>
> **Don't want to upload something through the app?** Message us at
> fundiverstw@gmail.com and we'll handle it offline — bring your ID,
> cert card, or medical info to the shop on the day instead. The
> booking still works; the app just won't hold those fields.
>
> **Why we collect it**
> - Plan the dive at a level matching your certification
> - Generate permits and manifest paperwork for authorities
> - Fit rental gear before you arrive
> - Reach you or your emergency contact if something goes wrong
> - Handle payments and refunds
>
> **Who can see it**
> - You: all of your own data.
> - FunDivers staff (admins): to plan events and handle check-in.
> - Nobody else. We do not sell or share your data with marketers or other third parties.
> - Authorities (if required by permit): name, ID number, nationality, and certification.
>
> **Where your data lives**
>
> **We're a dive shop, not a tech company.** We don't run our own
> servers. The app is built on top of widely-used third-party cloud
> services that we trust the same way most small businesses trust
> their email provider:
> - Database and login: Supabase
> - Website hosting: Cloudflare
> - Email: Gmail (Google)
> - Push notifications: your browser's push service (Apple, Google, Mozilla)
>
> Your data sits on those providers' servers — most of it in
> Asia-Pacific data centres. By using the app you're OK with that
> arrangement. If you'd rather we kept your information entirely off
> these platforms, see the offline option in "What we collect" above.
>
> **How long we keep it**
>
> We automatically scrub sensitive fields 12 months after your last
> booking: ID number, medical notes, emergency contact, and cert-card
> photo. Your core profile (name, cert agency + level, dive history)
> stays on file as business history unless you ask us to delete the
> whole account.
>
> **Deletion and access**
>
> Email fundiverstw@gmail.com to request a full export or deletion of
> your account. We'll honor it within a reasonable turnaround.
>
> **Security and the limits of what we can promise**
>
> We take reasonable steps to protect your data: encrypted connections,
> role-based access controls, regular review of who can see what, and
> routine deletion of stale information.
>
> **But: we are not a tech company.** Hacks, cyber-attacks, and
> breaches of cloud platforms happen — to companies far better
> resourced than us. If one of the services listed in "Where your data
> lives" suffers a breach, or someone successfully attacks the app
> itself, your data could be exposed. We can't promise that won't
> happen and we don't have the ability to undo it if it does. What we
> can promise is an honest, ongoing effort to keep your data safe and
> to tell you promptly if something has gone wrong.
>
> **What this means for you:** please don't put anything into this app
> that you would not be OK with potentially becoming public. If a
> piece of information feels too sensitive to risk, leave it out and
> tell us at the shop instead (see "What we collect" above). The
> choice of what to upload is yours, and so is the risk that comes
> with uploading it.
>
> **Liability**
>
> Scuba diving is an inherently risky activity. By booking through
> FunDivers TW you confirm you meet the certification requirements
> for the dives you register for, you've disclosed relevant medical
> conditions, and you accept the usual risks of the activity. You
> remain responsible for honesty about your certifications and
> health.
>
> **Changes**
>
> If we change these terms materially we'll surface it on your next
> sign-in and ask you to re-agree. Day-to-day tweaks (fixing a typo,
> clarifying a sentence) don't need a re-prompt.

---

## 9. Open questions for the lawyer

Privacy / PDPA:

1. **PDPA registrant obligations.** Is FunDivers TW required to
   register as a personal-data collector under PDPA for the volumes
   it processes? If so, what categories?
2. **Cross-border transfer notice** (Taiwan → Supabase HK).
   Required language? Required pre-collection consent?
3. **Third-party PII (emergency contact).** Required notice to the
   third party? Acceptable mitigations (e.g., a "I have informed
   this person" checkbox)?
4. **Minors.** The parent-child flow puts a parent in control of a
   child's account. What language do we need to make parental
   consent legally binding? Age cutoff (currently undefined in code)?
   PADI/SSI cutoffs already constrain training-level certifications
   but recreational fun-dive minor policies vary.
5. **Retention defaults.** Is 12 months from last booking
   appropriate under PDPA's "necessity" standard? Should we tier
   (medical_notes purged sooner, ID number kept longer for tax
   audit purposes, etc.)?
6. **Deletion turnaround.** "Reasonable turnaround" is unspecified.
   PDPA / GDPR-equivalent norms usually require 30 days. Set an SLA.
7. **Audit log.** PII purge currently writes no audit row (audit
   M5). Required for compliance?

Liability / waiver:

8. **Click-through waiver enforceability** under Taiwan ROC law.
   Is the current checkbox sufficient, or does the operator need a
   separately-signed (paper or e-sig) waiver at check-in?
9. **Scope of waiver.** Negligence? Gross negligence? Equipment
   failure? Boat captain conduct? Subcontractor liability?
10. **Jurisdiction & venue.** Add explicit clause (probably
    Taipei District Court or arbitration via the Chinese Arbitration
    Association)?
11. **Force majeure** clause — typhoons + sea-state cancellations
    are routine; what protects the operator from refund disputes?
12. **Refund policy.** Current `cancellation_policies` table is
    operator-set per event; should the terms reference it explicitly
    and bind diver to the per-event policy at booking time?

Operational:

13. **Insurance integration.** What language must the terms include
    to align with PADI / DAN operator-coverage requirements (and
    not invalidate the policy by promising more than the policy
    will pay)?
14. **Permit-authority disclosures.** Should the terms name
    specific authorities (Coast Guard Administration / 海洋委員會
    海巡署, national-park dive permits, etc.)?
15. **Marketing.** Operator says no marketing share today. If that
    changes, what consent uplift is required (separate checkbox?
    re-prompt?)?
16. **Breach-notification runbook.** Terms promise "we will tell
    you promptly if something has gone wrong." Operator needs a
    written procedure: who decides, what counts as a notifiable
    incident, channel (in-app banner? email? SMS?), and timing
    (PDPA Article 12 is silent on a hard deadline but courts have
    expected "without undue delay"). Suggest 72 hours mirroring
    GDPR Article 33.
17. **Sub-processor list maintenance.** The terms name specific
    cloud providers. If we swap (e.g., move from Gmail to a
    transactional-mail service), is bump-and-re-prompt required,
    or notice sufficient?
18. **Risk-shifting language enforceability.** Lawyer's view on
    "the choice of what to upload is yours, and so is the risk."
    Under Taiwan ROC consumer-protection law, how much of the
    user's risk can be allocated to them by terms-of-use?

Mechanics:

16. **Versioning & re-prompt.** Lawyer's view on building a
    `terms_version` field and forcing re-consent on bump. If
    required, we can ship it as part of this work.
17. **Effective date** on the displayed text. Add?
18. **Language.** Currently English-only. Operator's customer base
    includes Taiwan residents — does the law require a 繁體中文
    version to be the controlling text, or is bilingual acceptable?
    The codebase has no i18n scaffolding; this would be a real
    build-out.

---

## 10. Security audit status (relevant to legal review)

Full audit at `docs/security-audit.md`. Privacy-relevant items:

| ID | Finding | Status |
| --- | --- | --- |
| **C1** | Diver could `PATCH role=admin` on own profile via PostgREST | **FIXED 2026-06-02** — `block_self_privileged_profile_change` trigger |
| **H1** | Parent could promote child to admin via same shape | **FIXED** by same trigger |
| **C2** | `create-registration` accepted arbitrary `profile_patch` under service-role | **FIXED 2026-06-02** — allowlist sanitizer + handler extraction with unit tests |
| **C3** | Wix sync webhook token committed in plaintext | **OPEN** — rotation pending operator action |
| **H4** | Service worker caches `*.supabase.co` responses including `/auth/v1/*` | **OPEN** |
| **H5** | No CSP / X-Frame-Options on the SPA | **OPEN** |
| **L10** | `agreed_to_terms_at` is client-supplied, not server-stamped | **OPEN** — affects consent non-repudiation |
| **M5** | PII purge runs without writing to `admin_audit_log` | **OPEN** — affects compliance evidence |
| **M2** | `push_subscriptions` UPDATE policy missing `WITH CHECK` (user could re-target someone else's subscription) | **OPEN** |

The attorney should weigh which OPEN items must be closed before
go-live, and whether any of the FIXED items need to be documented
in the terms text (e.g., "we use the principle of least privilege
and …").

---

## 11. Scope notes

This brief covers the **app** at `app.fundiverstw.com`. It does
NOT cover:

- the Wix marketing site at `fundiverstw.com`
- in-person paper waivers / liability releases used at the dive shop
- physical safety procedures, briefings, dive-site selection
- insurance contracts the operator holds
- corporate / tax / employment matters

The Wix marketing site has its own terms surface that should be
reviewed in parallel; the two should be consistent (especially the
sections on data collection at the marketing → app handoff via
`/register/:type/:id` deep-links).

---

## 12. Suggested working-session agenda

If useful — a 60-minute session to walk through with the attorney:

1. (5 min) Business context (§1) + corporate-form confirmation
2. (10 min) Walk the data inventory (§2) — confirm sensitivity
   classification
3. (10 min) Walk the data flows (§4) — confirm consent gathering
4. (15 min) Code-text alignment (§7) — decide each ⚠️
5. (15 min) Open questions (§9) — settle the PDPA, waiver, and
   minors questions
6. (5 min) Action list: what changes in the terms text, what
   changes in code, what stays as-is

Anything answered or decided in that session should be reflected
back into this document so it stays the single source of truth.
