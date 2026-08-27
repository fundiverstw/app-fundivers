import type { ChargeLine } from '../lib/booking-charges'
import type { EventKind } from '../lib/event-kinds'
import type {
  CoralColony, CoralHue, CoralLevel, CoralType, CoralSurveyMethod,
} from '../lib/coral-survey'

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

/**
 * Structured payload on public.bookings.details. Mirrors the selections the
 * Wix register form collects (gear/room/addons/transport/payment). The DB
 * stores this as jsonb with an "is object" check — TypeScript is the
 * source of truth for shape.
 */
export interface BookingDetails {
  gear?: {
    rent: boolean
    /** Set when the event itself includes gear (e.g. OW course). The form
     *  doesn't prompt the diver in this case; we just record the fact so
     *  the PDF can say "Included with course" instead of "No". */
    included?: boolean
    /** Gear is rented à-la-carte only: `items` lists the chosen pieces. */
    items?: string[]
    /** Set when the diver picked "I'm not sure — I need to ask a human" on
     *  the gear step. Free text describing their situation; surfaced
     *  prominently in the gear field on the PDF and every admin view so
     *  staff can follow up. When present, `rent` is false. */
    assistance_note?: string
  }
  room?: {
    option_id?: string | null
    notes?: string | null
  }
  add_ons?: string[]
  transportation?: boolean
  /** True when the diver opted into a ride that had no free seat at submission
   *  time — a ride-waitlist request. The booking stands; the shop is notified
   *  to add a car or arrange transport. Distinct from the event-capacity
   *  waitlist (booking.status). */
  ride_waitlisted?: boolean
  payment_method?: 'bank_transfer' | 'credit_card' | 'paypal' | 'cash'
  /** Optional billing email when the diver picks credit_card — they receive
   *  the invoice with the card-payment link at this address. Empty / undefined
   *  means fall back to the registered account email. Only set when
   *  payment_method === 'credit_card'. */
  credit_card_invoice_email?: string
  /** True when the diver chose deposit-only at registration; full balance is
   *  due by full_payment_deadline. False / undefined = paying full upfront. */
  pay_deposit_only?: boolean
  nitrox_course_addon?: boolean
  total?: number
  deposit?: number
  /** Account credit the diver elected to apply at checkout, capped at `total`.
   *  Snapshotted here so the confirmation PDF can show both the gross total and
   *  the balance after credit — the credit itself is consumed by a separate
   *  `apply_credit_to_booking` RPC that runs after this booking is created and
   *  never rewrites `total`. Absent / 0 when no credit was applied. */
  credit_applied?: number
  /** Itemized snapshot of every charge that makes up `total` (base, per-item
   *  gear, room, add-ons, transport, nitrox course, card surcharge). Frozen at
   *  registration so later catalog price changes can't rewrite history. Absent
   *  on bookings created before this field existed — surfaces fall back to a
   *  current-price recompute via resolveCharges() in src/lib/booking-charges. */
  charges?: ChargeLine[]
  /** ISO timestamp of when the diver checked the "I have read the cancellation
   *  policy" box on the registration form. Required when the event has a
   *  cancel_policy set — gates the form's submit button. */
  cancellation_policy_acked_at?: string
  /** ISO timestamp of when the diver deferred the certification-card photo and
   *  accepted the "bring your physical card on the day or be denied
   *  participation, no refund" terms. Set only when a cert level was named but
   *  no card was uploaded / on file. */
  cert_card_ack_at?: string
  /** ISO timestamp of when the diver acknowledged an event prerequisite they
   *  don't yet meet on their self-reported profile (e.g. a boat dive requiring
   *  a higher cert or more logged dives). Gates submit + server-verified. */
  prereq_acked_at?: string
}

/**
 * Frozen snapshot of a Package or Scheduled-Trip registration's extras + estimate.
 * Mirrors BookingDetails' `charges` snapshot idea (frozen against later catalog
 * price changes). The estimate is a non-binding quote — the final cost is
 * confirmed by the partner shop (packages) or the shop (trips). `tier` is set for
 * packages only.
 */
export interface RegistrationDetails {
  tier?: { id: string; name: string; price: number } | null
  /** Days the range spans (nights + 1); add-ons are charged per day. */
  days?: number
  /** Nights in the range; the room is charged per night. */
  nights?: number
  add_ons?: string[]
  room?: { option_id?: string | null }
  charges?: ChargeLine[]
  total?: number
  currency?: string
}

/**
 * EO_* table Row shapes are minimal here — only the columns the app
 * actually reads. Those tables carry dozens of legacy columns from the
 * Wix import; if the app ever needs more, add them.
 */
export interface Database {
  public: {
    Functions: {
      // Staff/admin-only narrow write path for diver gear sizes. Defined in
      // 20260430020000_profile_gear_sizes.sql; gated server-side on
      // is_staff_or_admin(). Empty / whitespace strings are normalized to NULL.
      update_diver_gear_sizes: {
        Args: {
          diver_id:     string
          fin_size:     string | null
          bcd_size:     string | null
          wetsuit_size: string | null
        }
        Returns: void
      }
      // Defined in 20260507000000_waitlist_offers.sql; service-role only
      // (used by the push-cron worker to chain the next waitlister when
      // an offer expires). Returns the new offer's uuid, or null when
      // there's no eligible waitlister.
      offer_next_waitlist_spot: {
        Args: { p_event_id: string }
        Returns: string | null
      }
      // Defined in 20260507000000_waitlist_offers.sql; security-definer.
      // Atomically flips waitlist_offers.status -> 'accepted' and
      // bookings.status -> 'pending'. auth.uid() must own the booking.
      accept_waitlist_offer: {
        Args: { p_offer_id: string }
        Returns: void
      }
      // Defined in 20260814000000_course_continuation.sql; security-definer,
      // admin-only. Registers a diver onto a second scheduled course to finish
      // a course they started elsewhere: validates the pairing, optionally
      // trims the original booking to the days they actually attended, and
      // inserts the zero-cost continuation. Returns its booking id.
      create_course_continuation: {
        Args: {
          p_source_booking: string
          p_event_id:       string
          p_days:           string[]
          p_source_days?:   string[] | null
          p_charge_label?:  string | null
        }
        Returns: string
      }
      // Defined in 20260514010000_event_capacity.sql; security-definer.
      // Returns one row per event with at least one confirmed booking.
      // Lets divers see real aggregate capacity numbers past their RLS.
      event_confirmed_counts: {
        Args: { p_event_ids: string[] }
        Returns: Array<{ event_id: string; n: number }>
      }
      // Rewritten in 20260724000000_ride_groups_shared_transport.sql. Ride-seat
      // tally measured across the whole run the event travels in (see
      // event_ride_groups): capacity = seats over the run's distinct vehicles
      // minus its on-duty staff, who ride those same seats; claimed = distinct
      // divers holding a ride anywhere in the run. SECURITY DEFINER so the
      // registration form can read it as a plain diver.
      event_ride_seats: {
        Args: { p_event_id: string }
        Returns: Array<{ seats: number; staff: number; capacity: number; claimed: number }>
      }
      // Defined in 20260707050000_converge_functions_to_events.sql. Reconciles an
      // event's junction rows (rooms / add-ons / destinations) in one call.
      set_event_relations: {
        Args: {
          p_event_id:         string
          p_room_ids?:        string[]
          p_addon_ids?:       string[]
          p_destination_ids?: string[]
        }
        Returns: undefined
      }
      // Public projection of the unified trusted_partners table (20260707220000):
      // every active partner, mapped to region = coalesce(location, country),
      // blurb = vouch_notes. No email/kickback — divers list them without direct
      // table access; the email stays server-side (resolved by the
      // contact-trusted-partner edge fn) and `contactable` (20260827000000) just
      // says whether there is one to resolve.
      list_trusted_partners: {
        Args: Record<string, never>
        Returns: Array<{ id: string; name: string; region: string | null; blurb: string | null; website: string | null; contactable: boolean }>
      }
      // Owner-privileged projection of published packages joined to the vouched
      // partner shop — diver-safe columns only (no kickback rate). Divers have
      // no access to the base `packages` table. Carries the catalog id arrays the
      // register form needs plus a "from" price (min tier) and tier count.
      list_package_board: {
        Args: Record<string, never>
        Returns: Array<{
          id: string
          title: string
          destination: string
          summary: string | null
          description: string | null
          currency: string
          hero_image_url: string | null
          highlights: string[]
          addon_ids: string[]
          room_type_ids: string[]
          min_price: number | null
          tier_count: number
          published_at: string | null
          trusted_partner_id: string
          partner_name: string
          partner_country: string | null
          partner_location: string | null
          partner_website: string | null
          partner_logo_url: string | null
          partner_vouch_notes: string | null
        }>
      }
      // The tiers of a published package (detail page / register form). Diver-safe.
      list_package_tiers: {
        Args: { p_package_id: string }
        Returns: Array<{
          id: string
          package_id: string
          name: string
          price: number
          currency: string
          sort_order: number
        }>
      }
      // Diver-owned cancel of their own package registration (base table is
      // admin-only). Idempotent; scoped to auth.uid().
      cancel_my_package_registration: {
        Args: { p_id: string }
        Returns: void
      }
      // The caller's own package registrations (scoped to auth.uid()) with
      // package/partner/tier labels + the estimate — the kickback ledger columns
      // are intentionally absent.
      list_my_package_registrations: {
        Args: Record<string, never>
        Returns: Array<{
          id: string
          package_id: string
          tier_id: string | null
          status: 'registered' | 'completed' | 'cancelled'
          created_at: string
          preferred_start: string | null
          preferred_end: string | null
          estimated_cost: number | null
          estimated_currency: string | null
          package_title: string
          package_destination: string
          partner_name: string
          tier_name: string | null
        }>
      }
      // Owner-privileged projection of the shop's PUBLISHED scheduled trips,
      // carrying the catalog add-on/room ids the register form needs. Divers have
      // no access to the admin-only scheduled_trips base table.
      list_scheduled_trips: {
        Args: Record<string, never>
        Returns: Array<{
          id: string
          title: string
          destination: string
          summary: string | null
          description: string | null
          start_date: string | null
          end_date: string | null
          price: number | null
          currency: string
          hero_image_url: string | null
          highlights: string[]
          addon_ids: string[]
          room_type_ids: string[]
          published_at: string | null
        }>
      }
      // The caller's own scheduled-trip registrations with trip labels + estimate.
      list_my_scheduled_trip_registrations: {
        Args: Record<string, never>
        Returns: Array<{
          id: string
          scheduled_trip_id: string
          status: 'registered' | 'completed' | 'cancelled'
          created_at: string
          estimated_cost: number | null
          estimated_currency: string | null
          trip_title: string
          trip_destination: string
          trip_start_date: string | null
          trip_end_date: string | null
        }>
      }
      // Diver-owned cancel of their own scheduled-trip registration.
      cancel_my_scheduled_trip_registration: {
        Args: { p_id: string }
        Returns: void
      }
      // Defined in 20260706010000_replace_gear_model_sizes_rpc.sql.
      // Admin-only. Atomically replaces a gear model's size rows (delete +
      // insert in one transaction) from a JSON array of size objects.
      replace_gear_model_sizes: {
        Args: { p_model_id: string; p_sizes: Json }
        Returns: void
      }
      // Defined in 20260603000000_terms_consent_versioning.sql.
      // Server-stamps both agreed_to_terms_at (now()) and
      // agreed_to_terms_version on the caller's
      // profile. Called by the re-acceptance UI on TermsPage when
      // RequireCurrentTerms detects a stale version.
      // No arguments on purpose: the server reads public.terms.version itself,
      // so a modified client can't consent to a version it was never shown.
      // Returns the version actually recorded (20260711100000).
      // Defined in 20260805000000_create_events_atomically.sql. SECURITY
      // INVOKER — the events / event_series RLS policies authorize the caller.
      // Creates one or many events, their junction rows, and optionally the
      // recurrence series, in a single transaction. Returns the new event ids
      // in the order given.
      create_events_with_relations: {
        Args: {
          p_events: unknown
          p_room_ids?: string[]
          p_addon_ids?: string[]
          p_destination_ids?: string[]
          p_vehicle_ids?: string[]
          p_series?: unknown
          p_series_id?: string | null
          p_created_by?: string | null
        }
        Returns: string[]
      }
      accept_current_terms: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      // Both defined in 20260803000000_terms_consent_by_email.sql, and both
      // deliberately anon-callable: they exist for a diver with no session,
      // holding a one-time link from an email. Neither returns personal data.
      // `_state` is 'valid' | 'used' | 'expired' | 'unknown'; accept_ burns the
      // token and stamps agreed_to_terms_* with the SERVER's terms.version.
      terms_consent_token_state: {
        Args: { p_token: string }
        Returns: string
      }
      accept_terms_with_token: {
        Args: { p_token: string }
        Returns: number
      }
      // Almanac: approved observations for a window of calendar days. Defined
      // in 20260820000000_almanac_by_dive_site.sql — a date range rather than a
      // list of ids, because the page reads the almanac by day.
      almanac_records_in_range: {
        Args: { p_from: string; p_to: string }
        Returns: Array<{
          id: string
          site_id: string
          site_name: string
          site_kind: SiteKind
          created_at: string
          obs_date: string
          air_temp_c: number | null
          water_temp_c: number | null
          visibility_m: number | null
          current_strength: AlmanacCurrentStrength | null
          wave_height_m: number | null
          wave_period_s: number | null
          weather: AlmanacWeather | null
          wildlife: string[] | null
          coral_health: AlmanacCoralHealth | null
          elevation_m: number | null
          route_condition: AlmanacRouteCondition | null
          summit_visible: boolean | null
          diver_display: string | null
        }>
      }
      // Almanac: the staff review queue — every record still awaiting a
      // ruling. Raises for a caller who is not staff/admin.
      almanac_pending_records: {
        Args: Record<string, never>
        Returns: Array<{
          id: string
          site_id: string
          site_name: string
          site_kind: SiteKind
          obs_date: string
          created_at: string
          air_temp_c: number | null
          water_temp_c: number | null
          visibility_m: number | null
          current_strength: AlmanacCurrentStrength | null
          wave_height_m: number | null
          wave_period_s: number | null
          weather: AlmanacWeather | null
          wildlife: string[] | null
          coral_health: AlmanacCoralHealth | null
          elevation_m: number | null
          route_condition: AlmanacRouteCondition | null
          summit_visible: boolean | null
          diver_display: string | null
        }>
      }
      // Almanac: submit or revise the caller's own pending observation.
      submit_almanac_record: {
        Args: {
          p_site_id: string
          p_obs_date: string
          p_air_temp_c?: number | null
          p_water_temp_c?: number | null
          p_visibility_m?: number | null
          p_current_strength?: AlmanacCurrentStrength | null
          p_wave_height_m?: number | null
          p_wave_period_s?: number | null
          p_weather?: AlmanacWeather | null
          p_wildlife?: string[] | null
          p_coral_health?: AlmanacCoralHealth | null
          p_elevation_m?: number | null
          p_route_condition?: AlmanacRouteCondition | null
          p_summit_visible?: boolean | null
        }
        Returns: string
      }
      // Almanac: staff/admin ruling on one submission.
      moderate_almanac_record: {
        Args: {
          p_record_id: string
          p_status: Extract<AlmanacStatus, 'approved' | 'rejected'>
          p_staff_notes?: string | null
        }
        Returns: void
      }
      // Coral surveys (20260822000000). A CoralWatch Coral Health Chart
      // survey: a header row plus its colony observations, moderated as a
      // unit the way an almanac record is. Colonies travel as jsonb rather
      // than parallel arrays — a colony is six correlated values.
      submit_coral_survey: {
        Args: {
          p_site_id: string
          p_surveyed_on: string
          p_colonies: CoralColony[]
          p_surveyed_at?: string | null
          p_depth_m?: number | null
          p_water_temp_c?: number | null
          p_survey_method?: CoralSurveyMethod
          p_transect_length_m?: number | null
          p_notes?: string | null
        }
        Returns: string
      }
      coral_surveys_in_range: {
        Args: { p_from: string; p_to: string }
        Returns: CoralSurveyRow[]
      }
      // Staff/admin only; raises 42501 otherwise.
      coral_pending_surveys: {
        Args: Record<string, never>
        Returns: CoralSurveyRow[]
      }
      moderate_coral_survey: {
        Args: {
          p_survey_id: string
          p_status: Extract<AlmanacStatus, 'approved' | 'rejected'>
          p_staff_notes?: string | null
        }
        Returns: void
      }
      // Defined in 20260603020000_profile_delete_cascade_and_admin_rpc.sql.
      // Admin-only. Deletes auth.users for the target id; the existing
      // FK cascade handles profiles + dependents. Refuses self-deletion.
      admin_delete_user: {
        Args: { p_user_id: string }
        Returns: void
      }
      // Defined in 20260620000000_apply_credit_to_booking.sql.
      // Security-definer. Spends the booking owner's open account credit
      // toward the booking's unpaid balance: consumes open credit rows
      // oldest-first (carrying any remainder forward), records an offsetting
      // 'account_credit' payment, and auto-confirms a pending booking once
      // the deposit is covered. auth.uid() must own the booking or be admin.
      // Returns the amount actually applied (clamped to owed / available).
      apply_credit_to_booking: {
        Args: { p_booking_id: string; p_amount: number }
        Returns: number
      }
      // Defined in 20260622000000_lead_payer.sql.
      // Security-definer, admin-only. Distributes a single lump payment
      // across all of a lead booker's active bookings (optionally narrowed
      // to one group_id): deposits first so spots confirm, then remaining
      // balances, oldest first. Inserts one paid payment row per touched
      // booking and confirms pending siblings whose deposit is now covered.
      // Returns the amount actually applied (clamped to outstanding balances).
      record_group_payment: {
        Args: { p_lead: string; p_amount: number; p_reference: string; p_group_id?: string | null }
        Returns: number
      }
      // Defined in 20260603040000_signup_throttling_and_orphan_log.sql.
      // Service-role only. Inserts a signup_attempts row and returns
      // count of attempts within the trailing 60s + 24h windows
      // (inclusive of the just-inserted row). The create-registration
      // edge function uses this to throttle the guest path. ip_hash is
      // passed as a PostgREST bytea literal `\xDEADBEEF…`.
      record_signup_attempt: {
        Args: { p_ip_hash: string }
        Returns: Array<{ in_last_60s: number; in_last_24h: number }>
      }
      // Defined in 20260603040000_signup_throttling_and_orphan_log.sql.
      // Service-role only. Records an auth.users row that was created
      // by the guest registration path but failed to roll back cleanly.
      log_orphan_auth_user: {
        Args: { p_user_id: string; p_email: string | null; p_reason: string }
        Returns: void
      }
      // Defined in 20260629000000_waivers.sql. Security-definer, authenticated.
      // Records a waiver e-signature for the caller: server-stamps
      // signed_at = now() and diver_id = auth.uid() so the client can't
      // backdate or forge (same non-repudiation fix as accept_current_terms).
      // p_event_id is set only for per-event waivers; annual waivers pass
      // none. Returns the new signature's id.
      sign_waiver: {
        Args: {
          p_code:        string
          p_version:     number
          p_signed_name: string
          p_event_id?:   string | null
        }
        Returns: string
      }
      // Admin-only: record a waiver a diver signed on paper, in person. Snapshots
      // content like sign_waiver but for an arbitrary diver, tagged in_person.
      admin_record_paper_waiver: {
        Args: {
          p_diver_id:    string
          p_code:        string
          p_version:     number
          p_signed_name: string
          p_event_id?:   string | null
        }
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
    Views: {
      // Privacy projection over staff_availability — see migration
      // 20260518010000. title/details are masked to NULL for any row not
      // owned by the calling user, so a staff member's vacation note doesn't
      // leak to the rest of the team. owner_display_name joins profiles so
      // viewers still see whose period is blocked.
      staff_availability_view: {
        Row: {
          id: string
          user_id: string
          start_date: string
          start_time: string
          end_date: string
          title: string | null
          details: string | null
          owner_display_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      // The packages feature exposes diver-safe data through the
      // list_package_board() / list_package_tiers() / list_my_package_registrations()
      // functions (see Functions above); there are no packages-related views.
    }
    Tables: {
      profiles: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          /** Read-only mirror of auth.users.email, kept in sync by DB
           *  triggers (20260616000000_profiles_email.sql). The app never
           *  writes it — hence absent from Insert/Update. */
          email: string | null
          name: string | null
          nickname: string | null
          date_of_birth: string | null
          nationality: string | null
          id_number: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          cert_agency: string | null
          cert_level: string | null
          cert_card_path: string | null
          nitrox_card_path: string | null
          deep_card_path: string | null
          medical_notes: string | null
          avatar_url: string | null
          role: 'diver' | 'admin' | 'staff'
          height_cm: number | null
          weight_kg: number | null
          shoe_size: string | null
          /** Diving gear sizes — free text so any sizing convention works. */
          fin_size: string | null
          bcd_size: string | null
          wetsuit_size: string | null
          gender: string | null
          contact_method: 'whatsapp' | 'line' | 'phone' | 'email' | null
          contact_id: string | null
          nitrox_certified: boolean
          deep_certified: boolean
          /** Diver explicitly declared they hold no certification. When true,
           *  cert_agency/cert_level are null and no cert-card photo is required. */
          uncertified: boolean
          logged_dives: number
          last_dive_date: string | null
          gear_owned: string[]
          agreed_to_terms_at: string | null
          /** Version of the Terms of Use the user agreed to (server-stamped
           *  by handle_new_user / accept_current_terms). When the
           *  live public.terms.version exceeds this, RequireCurrentTerms
           *  bounces the user to /terms for re-acceptance. Null = never
           *  consented. */
          agreed_to_terms_version: number | null
          /** Stamped by the maybe_set_application_submitted_at trigger the
           *  first time name, date_of_birth, cert_level, contact_method and
           *  contact_id are all populated — i.e. "this diver has filled the
           *  application in". Null means they signed up and stopped short,
           *  which is a profile to flag, never a reason to hide them from the
           *  admin approvals queue. */
          application_submitted_at: string | null
          /** Manual-verification gate. Diver-side INSERTs into bookings /
           *  push_subscriptions are blocked unless status='active'. */
          status: 'pending' | 'active' | 'rejected'
          /** Self-FK pointer to the parent profile when this diver is
           *  managed by another (a child account). Null = standalone.
           *  One-level only — enforced by the trg_profiles_one_level_family
           *  trigger (20260514030000_parent_child_accounts.sql). */
          parent_account: string | null
        }
        Insert: {
          id: string
          created_at?: string
          updated_at?: string
          name?: string | null
          nickname?: string | null
          date_of_birth?: string | null
          nationality?: string | null
          id_number?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          cert_agency?: string | null
          cert_level?: string | null
          cert_card_path?: string | null
          nitrox_card_path?: string | null
          deep_card_path?: string | null
          medical_notes?: string | null
          avatar_url?: string | null
          role?: 'diver' | 'admin' | 'staff'
          height_cm?: number | null
          weight_kg?: number | null
          shoe_size?: string | null
          fin_size?: string | null
          bcd_size?: string | null
          wetsuit_size?: string | null
          gender?: string | null
          contact_method?: 'whatsapp' | 'line' | 'phone' | 'email' | null
          contact_id?: string | null
          nitrox_certified?: boolean
          deep_certified?: boolean
          uncertified?: boolean
          logged_dives?: number
          last_dive_date?: string | null
          gear_owned?: string[]
          application_submitted_at?: string | null
          status?: 'pending' | 'active' | 'rejected'
          parent_account?: string | null
        }
        Update: {
          id?: string
          updated_at?: string
          name?: string | null
          nickname?: string | null
          date_of_birth?: string | null
          nationality?: string | null
          id_number?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          cert_agency?: string | null
          cert_level?: string | null
          cert_card_path?: string | null
          nitrox_card_path?: string | null
          deep_card_path?: string | null
          medical_notes?: string | null
          avatar_url?: string | null
          role?: 'diver' | 'admin' | 'staff'
          height_cm?: number | null
          weight_kg?: number | null
          shoe_size?: string | null
          fin_size?: string | null
          bcd_size?: string | null
          wetsuit_size?: string | null
          gender?: string | null
          contact_method?: 'whatsapp' | 'line' | 'phone' | 'email' | null
          contact_id?: string | null
          nitrox_certified?: boolean
          deep_certified?: boolean
          uncertified?: boolean
          logged_dives?: number
          last_dive_date?: string | null
          gear_owned?: string[]
          application_submitted_at?: string | null
          status?: 'pending' | 'active' | 'rejected'
          parent_account?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          id: string
          created_at: string
          user_id: string
          /** NOT NULL in the schema (and belt-and-braces CHECK
           *  `bookings_event_present`). A booking without an event is not a
           *  state the database can hold, so don't reintroduce a null branch. */
          event_id: string
          status: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes: string | null
          details: BookingDetails
          refund_requested_at: string | null
          /** An admin acknowledged that the shop keeps what is left on this
           *  cancelled booking (a cancellation fee). Moves no money — the cash
           *  is already recorded as paid — it takes the booking off the
           *  "still holding money" list. Staff-only; the diver-status guard
           *  rejects a diver writing it. */
          cancellation_settled_at: string | null
          cancellation_settled_by: string | null
          cancellation_settled_note: string | null
          /** When this booking moved to cancelled, and whose session did it.
           *  Both stamped by `trg_bookings_stamp_cancellation`
           *  (20260823120000) from the status transition itself, so a caller
           *  cannot forge either. Null on cancellations the admin audit log
           *  never witnessed — a diver cancelling their own spot before that
           *  migration, or any service-role write. */
          cancelled_at: string | null
          cancelled_by: string | null
          /** Status to put this booking back to when its event is restored.
           *  Non-null marks a booking cancelled BY its event rather than by a
           *  person, which is both how restore picks the rows and the only
           *  record of a 'waitlisted' spot nothing else could reconstruct.
           *  Written solely by `trg_events_cancel_bookings` (20260827100000);
           *  the diver-status guard rejects a caller setting it. */
          status_before_event_cancel: string | null
          /** Who created this booking — the diver themselves, a parent, or an
           *  admin using Add diver. Stamped by trg_bookings_stamp_created_by
           *  and never writable by a caller. Equal to `user_id` means they
           *  registered themselves; null means nobody knows (the guest path,
           *  or a booking predating 20260826000000). */
          created_by: string | null
          /** Shared id linking all bookings submitted together by a parent
           *  as a group registration. Null on solo registrations. Added in
           *  20260514030000_parent_child_accounts.sql; populated by the
           *  group-booking submission flow in Phase B. */
          group_id: string | null
          /** The lead booker responsible for paying this booking. Null = the
           *  diver pays their own (default). When set (to the diver or their
           *  parent_account), the cost rolls up to this payer and the diver's
           *  own account shows "covered by the lead". Added in
           *  20260622000000_lead_payer.sql. */
          payer_id: string | null
          /** Set when this booking finishes a course started on another
           *  scheduled course: it points at the booking that holds the money,
           *  and is itself always zero-cost. Written only by the
           *  create_course_continuation RPC (20260814000000). */
          continues_booking_id: string | null
          /** Which of the event's course_days this diver attends. NULL — the
           *  normal case, and every booking predating the column — means all of
           *  them. Read by the day-level gear and headcount views. */
          attend_days: string[] | null
        }
        Insert: {
          id?: string
          created_at?: string
          user_id: string
          event_id: string
          status?: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes?: string | null
          details?: BookingDetails
          refund_requested_at?: string | null
          cancellation_settled_at?: string | null
          cancellation_settled_by?: string | null
          cancellation_settled_note?: string | null
          group_id?: string | null
          payer_id?: string | null
          /** Continuations are inserted by create_course_continuation() only —
           *  present here for completeness, not as a client write path. */
          continues_booking_id?: string | null
          attend_days?: string[] | null
        }
        Update: {
          id?: string
          user_id?: string
          event_id?: string
          status?: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes?: string | null
          details?: BookingDetails
          refund_requested_at?: string | null
          cancellation_settled_at?: string | null
          cancellation_settled_by?: string | null
          cancellation_settled_note?: string | null
          group_id?: string | null
          payer_id?: string | null
          continues_booking_id?: string | null
          attend_days?: string[] | null
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          id: string
          created_at: string
          actor_id: string | null
          action: 'insert' | 'update' | 'delete'
          target_table: string
          target_id: string
          before: Json | null
          after: Json | null
        }
        // Rows are written by the audit_admin_write() trigger and made
        // immutable by block-update/delete triggers, so the client never
        // inserts or mutates them.
        Insert: never
        Update: never
        Relationships: []
      }
      booking_amendments: {
        Row: {
          id: string
          booking_id: string
          amount: number
          note: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          booking_id: string
          amount: number
          note: string
          created_by: string
          created_at?: string
        }
        Update: never
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          created_at: string
          user_id: string
          booking_id: string | null
          amount: number
          currency: string
          status: 'pending' | 'paid' | 'refunded' | 'voided'
          method: string | null
          note: string | null
          /** Receipt / bank transfer / online payment transaction id this row
           *  is evidence of. Required on money-moving rows by
           *  `payments_reference_required` (20260823100000); null on
           *  `account_credit` rows, which move no money, and on every row
           *  recorded before that constraint existed. */
          reference: string | null
          recorded_by: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          user_id: string
          booking_id?: string | null
          amount: number
          currency?: string
          status?: 'pending' | 'paid' | 'refunded' | 'voided'
          method?: string | null
          note?: string | null
          reference?: string | null
          recorded_by?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          booking_id?: string | null
          amount?: number
          currency?: string
          status?: 'pending' | 'paid' | 'refunded' | 'voided'
          method?: string | null
          note?: string | null
          reference?: string | null
          recorded_by?: string | null
        }
        Relationships: []
      }
      credits: {
        Row: {
          id: string
          created_at: string
          user_id: string
          booking_id: string | null
          amount: number
          currency: string
          reason: string
          status: 'open' | 'settled'
          created_by: string | null
          settled_at: string | null
          settled_note: string | null
          /** Whose session closed this credit. Stamped by
           *  `trg_credits_stamp_settled_by` (20260823110000) — never written
           *  by callers, and null on credits settled before it existed. */
          settled_by: string | null
          /** Where this ledger row came from. Only the two *_cancellation* /
           *  *_return values mean "this booking's money has been given back",
           *  and only those suppress a further automatic refund.
           *  `admin_charge` inverts the row's sign — see CreditSource. */
          source: CreditSource
        }
        Insert: {
          id?: string
          created_at?: string
          user_id: string
          booking_id?: string | null
          amount: number
          currency?: string
          reason: string
          status?: 'open' | 'settled'
          created_by?: string | null
          settled_at?: string | null
          settled_note?: string | null
          settled_by?: string | null
          source?: CreditSource
        }
        Update: {
          id?: string
          user_id?: string
          booking_id?: string | null
          amount?: number
          currency?: string
          reason?: string
          status?: 'open' | 'settled'
          created_by?: string | null
          settled_at?: string | null
          settled_note?: string | null
          settled_by?: string | null
          source?: CreditSource
        }
        Relationships: []
      }
      // The single "dive shops abroad we vouch for" table (unified from the old
      // partner_shops + trusted_partners in 20260707220000). Hosts Packages
      // (country/location, logo, kickback, internal contact) AND powers the
      // diver Trusted Partners directory (name/region/blurb/website + contact
      // email for messaging). country is nullable — directory-only partners may
      // not have one.
      trusted_partners: {
        Row: {
          id: string
          created_at: string
          name: string
          country: string | null
          location: string | null
          website: string | null
          contact_name: string | null
          contact_email: string | null
          vouch_notes: string | null
          logo_url: string | null
          default_kickback_rate: number
          active: boolean
          created_by: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          name: string
          country?: string | null
          location?: string | null
          website?: string | null
          contact_name?: string | null
          contact_email?: string | null
          vouch_notes?: string | null
          logo_url?: string | null
          default_kickback_rate?: number
          active?: boolean
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['trusted_partners']['Insert']>
        Relationships: []
      }
      vehicles: {
        Row: {
          id: string
          created_at: string
          name: string
          passenger_seats: number
          active: boolean
          created_by: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          name: string
          passenger_seats: number
          active?: boolean
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['vehicles']['Insert']>
        Relationships: []
      }
      gear_models: {
        Row: {
          id: string
          gear_type: string
          name: string
          brand: string | null
          gender: string | null
          size_unit: string | null
          notes: string | null
          active: boolean
          sort_order: number
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          gear_type: string
          name: string
          brand?: string | null
          gender?: string | null
          size_unit?: string | null
          notes?: string | null
          active?: boolean
          sort_order?: number
          created_at?: string
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['gear_models']['Insert']>
        Relationships: []
      }
      gear_model_sizes: {
        Row: {
          id: string
          model_id: string
          label: string
          height_min: number | null
          height_max: number | null
          weight_min: number | null
          weight_max: number | null
          shoe_min: number | null
          shoe_max: number | null
          chest: string | null
          waist: string | null
          hip: string | null
          sort_order: number
        }
        Insert: {
          id?: string
          model_id: string
          label: string
          height_min?: number | null
          height_max?: number | null
          weight_min?: number | null
          weight_max?: number | null
          shoe_min?: number | null
          shoe_max?: number | null
          chest?: string | null
          waist?: string | null
          hip?: string | null
          sort_order?: number
        }
        Update: Partial<Database['public']['Tables']['gear_model_sizes']['Insert']>
        Relationships: []
      }
      event_vehicles: {
        Row: {
          id: string
          created_at: string
          created_by: string | null
          vehicle_id: string
          event_id: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          created_by?: string | null
          vehicle_id: string
          event_id?: string | null
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['event_vehicles']['Insert']>
        Relationships: []
      }
      // Events that travel together on one day (20260724000000). A group *is*
      // the set of rows sharing group_id — there's no parent table — and an
      // event with no row for the day rides alone.
      event_ride_groups: {
        Row: {
          ride_day: string
          event_id: string
          group_id: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          ride_day: string
          event_id: string
          group_id: string
          created_at?: string
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['event_ride_groups']['Insert']>
        Relationships: []
      }
      waiver_signatures: {
        Row: {
          id: string
          created_at: string
          diver_id: string
          waiver_code: string
          waiver_version: number
          signed_name: string
          signed_at: string
          event_id: string | null
          /** Content snapshot taken at signing time (20260711200000). NULL on
           *  rows signed before snapshotting existed. */
          signed_title: string | null
          signed_body: string | null
          signed_pdf_path: string | null
          content_sha256: string | null
          /** 'e_signed' (diver typed their name in-app) or 'in_person' (admin
           *  recorded a paper form). Added 20260731000000. */
          method: 'e_signed' | 'in_person'
          /** The admin who logged an in_person record; NULL for e-signatures. */
          recorded_by: string | null
        }
        // Divers never insert directly — sign_waiver() is the only write path.
        // Insert here covers the admin-correction policy (and admin_record_paper_waiver).
        Insert: {
          id?: string
          created_at?: string
          diver_id: string
          waiver_code: string
          waiver_version: number
          signed_name: string
          signed_at?: string
          event_id?: string | null
          signed_title?: string | null
          signed_body?: string | null
          signed_pdf_path?: string | null
          content_sha256?: string | null
          method?: 'e_signed' | 'in_person'
          recorded_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['waiver_signatures']['Insert']>
        Relationships: []
      }
      event_waivers: {
        Row: {
          id: string
          created_at: string
          created_by: string | null
          event_id: string | null
          waiver_code: string
          mode: 'require' | 'exempt'
        }
        Insert: {
          id?: string
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          waiver_code: string
          mode: 'require' | 'exempt'
        }
        Update: Partial<Database['public']['Tables']['event_waivers']['Insert']>
        Relationships: []
      }
      // Shop-authored waiver catalog (moved out of src/config/waivers.ts). Stable
      // `code` + integer `version` are what waiver_signatures / event_waivers
      // reference. Exactly one of `body` / `pdf_path` is set — a text form, or an
      // uploaded PDF in the waiver-pdfs bucket. `language` is a free-form label
      // for the shop's own organization, not tied to the app locale.
      waivers: {
        Row: {
          id: string
          created_at: string
          created_by: string | null
          code: string
          title: string
          language: string | null
          body: string | null
          pdf_path: string | null
          cadence: 'annual' | 'per_event'
          version: number
          applies_to: 'dives' | 'courses' | 'adventures' | 'all' | 'none'
          course_colors: string[] | null
          active: boolean
        }
        Insert: {
          id?: string
          created_at?: string
          created_by?: string | null
          code: string
          title: string
          language?: string | null
          body?: string | null
          pdf_path?: string | null
          cadence?: 'annual' | 'per_event'
          version?: number
          applies_to?: 'dives' | 'courses' | 'adventures' | 'all' | 'none'
          course_colors?: string[] | null
          active?: boolean
        }
        Update: Partial<Database['public']['Tables']['waivers']['Insert']>
        Relationships: []
      }
      // The parent "product": a partner-hosted package with one or more price
      // tiers (package_tiers) and references into our add-on/room catalog. Dates
      // are diver-picked at registration, so no start/end here. kickback_rate is
      // internal (never exposed to divers via the definer functions).
      packages: {
        Row: {
          id: string
          created_at: string
          trusted_partner_id: string
          title: string
          destination: string
          summary: string | null
          description: string | null
          currency: string
          hero_image_url: string | null
          highlights: string[]
          addon_ids: string[]
          room_type_ids: string[]
          kickback_rate: number
          status: 'draft' | 'published' | 'archived'
          published_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          trusted_partner_id: string
          title: string
          destination: string
          summary?: string | null
          description?: string | null
          currency?: string
          hero_image_url?: string | null
          highlights?: string[]
          addon_ids?: string[]
          room_type_ids?: string[]
          kickback_rate?: number
          status?: 'draft' | 'published' | 'archived'
          published_at?: string | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['packages']['Insert']>
        Relationships: []
      }
      // Price tiers for a package (Package A/B/C). Increasing price, admin-managed.
      package_tiers: {
        Row: {
          id: string
          created_at: string
          package_id: string
          name: string
          price: number
          currency: string
          sort_order: number
        }
        Insert: {
          id?: string
          created_at?: string
          package_id: string
          name: string
          price: number
          currency?: string
          sort_order?: number
        }
        Update: Partial<Database['public']['Tables']['package_tiers']['Insert']>
        Relationships: []
      }
      // One row per diver-registration; carries the frozen estimate snapshot and
      // doubles as the kickback ledger (kickback_amount generated from
      // estimated_cost * kickback_rate). Base table is admin-only.
      package_registrations: {
        Row: {
          id: string
          created_at: string
          package_id: string
          tier_id: string | null
          diver_id: string
          preferred_start: string | null
          preferred_end: string | null
          estimated_cost: number | null
          estimated_currency: string | null
          details: RegistrationDetails
          notes: string | null
          status: 'registered' | 'completed' | 'cancelled'
          kickback_rate: number | null
          kickback_amount: number | null
          kickback_status: 'expected' | 'paid'
          paid_at: string | null
          admin_notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          package_id: string
          tier_id?: string | null
          diver_id: string
          preferred_start?: string | null
          preferred_end?: string | null
          estimated_cost?: number | null
          estimated_currency?: string | null
          details?: RegistrationDetails
          notes?: string | null
          status?: 'registered' | 'completed' | 'cancelled'
          kickback_rate?: number | null
          kickback_status?: 'expected' | 'paid'
          paid_at?: string | null
          admin_notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['package_registrations']['Insert']>
        Relationships: []
      }
      // Scheduled Trips — the shop's own curated, dated trips. Self-contained
      // registration: the trip carries catalog add-on/room ids and divers register
      // directly (estimate + notify). Admin-managed (base table admin-only); divers
      // read published rows via list_scheduled_trips().
      scheduled_trips: {
        Row: {
          id: string
          created_at: string
          title: string
          destination: string
          summary: string | null
          description: string | null
          start_date: string | null
          end_date: string | null
          price: number | null
          currency: string
          hero_image_url: string | null
          highlights: string[]
          addon_ids: string[]
          room_type_ids: string[]
          status: 'draft' | 'published' | 'archived'
          published_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          title: string
          destination: string
          summary?: string | null
          description?: string | null
          start_date?: string | null
          end_date?: string | null
          price?: number | null
          currency?: string
          hero_image_url?: string | null
          highlights?: string[]
          addon_ids?: string[]
          room_type_ids?: string[]
          status?: 'draft' | 'published' | 'archived'
          published_at?: string | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['scheduled_trips']['Insert']>
        Relationships: []
      }
      // One row per diver-registration for a scheduled trip; carries the frozen
      // estimate snapshot. No kickback (the shop's own trip). Base table admin-only.
      scheduled_trip_registrations: {
        Row: {
          id: string
          created_at: string
          scheduled_trip_id: string
          diver_id: string
          estimated_cost: number | null
          estimated_currency: string | null
          details: RegistrationDetails
          notes: string | null
          status: 'registered' | 'completed' | 'cancelled'
          admin_notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          scheduled_trip_id: string
          diver_id: string
          estimated_cost?: number | null
          estimated_currency?: string | null
          details?: RegistrationDetails
          notes?: string | null
          status?: 'registered' | 'completed' | 'cancelled'
          admin_notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['scheduled_trip_registrations']['Insert']>
        Relationships: []
      }
      // Unified dive+course catalog (kind discriminates). Replaced the split
      // EO_dives / EO_courses tables. A dive uses the start_date/end_date
      // envelope; a course uses course_days (the two temporal models coexist).
      events: {
        Row: {
          id: string
          kind: 'dive' | 'course' | 'adventure'
          admin_title: string | null
          display_title: string | null
          calendar_title: string | null
          price: string | null
          dive_days: number | null
          prereq_cert_id: string | null
          site_id: string | null
          cancel_date: string | null
          cancel_policy: string | null
          fully_booked: boolean
          capacity: number | null
          full_payment_deadline: string | null
          cancelled_at: string | null
          featured_image: string | null
          prereqs: string | null
          featured: boolean
          req_dives: number | null
          start_date: string | null
          end_date: string | null
          start_time: string | null
          course_days: string[] | null
          is_private: boolean
          /** False when the shop drives nobody to this event — a dry course
           *  held at the shop (20260821000000). The registration form then
           *  puts no ride question and the event takes no cars. */
          has_transport: boolean
          is_boat_dive: boolean | null
          is_trip: boolean | null
          nitrox_required: boolean
          gear_rental: string | null
          notes: string | null
          trip_template_id: string | null
          course_name: string | null
          included: string | null
          schedule: string | null
          /** The recurrence batch this event was generated in (20260804000000),
           *  or null for a one-off. Grouping only — the occurrence itself is
           *  fully independent. */
          series_id: string | null
        }
        Insert: {
          id?: string
          kind: 'dive' | 'course' | 'adventure'
          admin_title?: string | null
          display_title?: string | null
          calendar_title?: string | null
          price?: string | null
          dive_days?: number | null
          prereq_cert_id?: string | null
          site_id?: string | null
          cancel_date?: string | null
          cancel_policy?: string | null
          fully_booked?: boolean
          capacity?: number | null
          full_payment_deadline?: string | null
          cancelled_at?: string | null
          featured_image?: string | null
          prereqs?: string | null
          featured?: boolean
          req_dives?: number | null
          start_date?: string | null
          end_date?: string | null
          start_time?: string | null
          course_days?: string[] | null
          is_private?: boolean
          has_transport?: boolean
          is_boat_dive?: boolean | null
          is_trip?: boolean | null
          nitrox_required?: boolean
          gear_rental?: string | null
          notes?: string | null
          trip_template_id?: string | null
          course_name?: string | null
          included?: string | null
          schedule?: string | null
          series_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['events']['Insert']>
        Relationships: []
      }
      // A recurrence rule and the batch of events generated from it
      // (20260804000000). Stores no dates of its own: the rule is re-anchored
      // on the last occurrence to extend the series, so the two can never
      // disagree. Staff read, admin write; divers see the occurrences only.
      event_series: {
        Row: {
          id: string
          created_at: string
          created_by: string | null
          /** Admin-facing name for the batch. Occurrences carry their own titles. */
          label: string | null
          kind: 'dive' | 'course' | 'adventure'
          freq: 'daily' | 'weekly' | 'monthly_weekday'
          interval: number
          /** `weekly` only: ISO weekdays, 1 = Monday … 7 = Sunday. NULL otherwise. */
          weekdays: number[] | null
        }
        Insert: {
          id?: string
          created_by?: string | null
          label?: string | null
          kind: 'dive' | 'course' | 'adventure'
          freq: 'daily' | 'weekly' | 'monthly_weekday'
          interval: number
          weekdays?: number[] | null
        }
        Update: Partial<Database['public']['Tables']['event_series']['Insert']>
        Relationships: []
      }
      cert_levels: {
        Row: {
          id: string
          code: string
          name: string
          name_zh: string | null
          rank: number
          /** 'PADI' / 'BSAC' / 'CMAS' / 'SSI' / 'NAUI' / 'SAA' / 'SDI' / 'TDI'. */
          organization: string
          /** PADI rank this level resolves to for prereq comparisons.
           *  Self-id for PADI rows; closest PADI rank for agency rows. */
          padi_equivalent_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          name_zh?: string | null
          rank: number
          organization: string
          padi_equivalent_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['cert_levels']['Insert']>
        Relationships: []
      }
      duties: {
        Row: {
          id: string
          created_at: string
          created_by: string | null
          assignee_id: string
          role: 'instructor' | 'guide' | 'support'
          start_date: string
          end_date: string | null
          event_id: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          created_by?: string | null
          assignee_id: string
          role: 'instructor' | 'guide' | 'support'
          start_date: string
          end_date?: string | null
          event_id?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          created_by?: string | null
          assignee_id?: string
          role?: 'instructor' | 'guide' | 'support'
          start_date?: string
          end_date?: string | null
          event_id?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      admin_notes: {
        Row: {
          id: string
          created_at: string
          created_by: string
          event_id: string | null
          booking_id: string | null
          tag: 'urgent' | 'payment' | 'gear' | 'logistics' | 'cert' | 'medical' | 'note' | 'general'
          content: string
          resolved: boolean
          resolved_by: string | null
          resolved_at: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          created_by: string
          event_id?: string | null
          booking_id?: string | null
          tag: 'urgent' | 'payment' | 'gear' | 'logistics' | 'cert' | 'medical' | 'note' | 'general'
          content: string
          resolved?: boolean
          resolved_by?: string | null
          resolved_at?: string | null
        }
        Update: {
          id?: string
          created_by?: string
          event_id?: string | null
          booking_id?: string | null
          tag?: 'urgent' | 'payment' | 'gear' | 'logistics' | 'cert' | 'medical' | 'note' | 'general'
          content?: string
          resolved?: boolean
          resolved_by?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      diver_notes: {
        Row: {
          id: string
          profile_id: string
          created_by: string
          content: string
          created_at: string
          edited_by: string | null
          edited_at: string | null
        }
        Insert: {
          id?: string
          profile_id: string
          created_by: string
          content: string
          created_at?: string
          edited_by?: string | null
          edited_at?: string | null
        }
        Update: {
          id?: string
          content?: string
          edited_by?: string | null
          edited_at?: string | null
        }
        Relationships: []
      }
      prices: {
        Row: {
          id: string
          admin_title: string
          starting_at: number | null
          deposit_amount: number | null
          /** Per-tier transportation surcharge in NTD. NULL or 0 means
           *  transportation is bundled into the base price. */
          transport: number | null
        }
        Insert: {
          id: string
          admin_title: string
          starting_at?: number | null
          deposit_amount?: number | null
          transport?: number | null
        }
        Update: Partial<Database['public']['Tables']['prices']['Insert']>
        Relationships: []
      }
      rooms: {
        Row: {
          id: string
          admin_title: string | null
          display_title: string | null
          added_price: number | null
          currency: string | null
        }
        Insert: {
          id: string
          admin_title?: string | null
          display_title?: string | null
          added_price?: number | null
          currency?: string | null
        }
        Update: Partial<Database['public']['Tables']['rooms']['Insert']>
        Relationships: []
      }
      addons: {
        Row: {
          id: string
          admin_title: string | null
          display_title: string | null
          price: number | null
          currency: string | null
        }
        Insert: {
          id: string
          admin_title?: string | null
          display_title?: string | null
          price?: number | null
          currency?: string | null
        }
        Update: Partial<Database['public']['Tables']['addons']['Insert']>
        Relationships: []
      }
      trip_templates: {
        Row: {
          id: string
          admin_title: string | null
          included: string | null
          not_included: string | null
          transportation: string | null
          itinerary: string | null
          prerequisites: string | null
          tagline_text: string | null
        }
        Insert: {
          id: string
          admin_title?: string | null
          included?: string | null
          not_included?: string | null
          transportation?: string | null
          itinerary?: string | null
          prerequisites?: string | null
          tagline_text?: string | null
        }
        Update: Partial<Database['public']['Tables']['trip_templates']['Insert']>
        Relationships: []
      }
      // Shop-authored Terms of Use (20260711100000). Exactly one row: `singleton`
      // is a constant-true primary key. Only an admin may UPDATE it; nobody may
      // insert or delete, so there is no Insert type worth exposing.
      terms: {
        Row: {
          singleton: true
          title: string
          /** Markdown. Rendered read-only; never injected as HTML. */
          body: string
          /** Bumped only on a material change; gates RequireCurrentTerms. */
          version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: never
        Update: {
          title?: string
          body?: string
          version?: number
          updated_by?: string | null
        }
        Relationships: []
      }
      // One-time links letting a diver accept the Terms with no session
      // (20260803000000). Minted by the service-role edge functions, redeemed
      // by accept_terms_with_token(). Admin-readable so the user card can show
      // "link sent / accepted"; no client ever inserts or updates.
      terms_consent_tokens: {
        Row: {
          token: string
          user_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          /** Set when the diver redeemed it — the audit trail for an
           *  email-route consent. */
          used_at: string | null
          accepted_version: number | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      cancellation_policies: {
        Row: {
          id: string
          title: string | null
          cancellation_policy: string | null
          // Free-form label for the shop's own organization (e.g. 'en', 'zh-TW').
          language: string | null
          active: boolean
          /** False when the deposit is money the shop cannot recover — a PADI
           *  eLearning code, a prepaid room. `bookings_credit_on_cancel` then
           *  withholds it from the cancellation credit and stamps the booking
           *  settled for that amount. */
          deposit_refundable: boolean
        }
        Insert: {
          id?: string
          title?: string | null
          cancellation_policy?: string | null
          language?: string | null
          active?: boolean
          deposit_refundable?: boolean
        }
        Update: Partial<Database['public']['Tables']['cancellation_policies']['Insert']>
        Relationships: []
      }
      // Crowdsourced environmental observations for dive sites and adventure
      // events. Divers submit; staff/admin approve; approved records show
      // on the event detail and the almanac page.
      // Defined in 20260820000000_almanac_by_dive_site.sql. The shop's places:
      // `kind` is the events vocabulary narrowed to the kinds that travel to a
      // site, so the almanac's dive/adventure toggle filters on it.
      dive_sites: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          name: string
          kind: SiteKind
          region: string | null
          notes: string | null
          active: boolean
        }
        Insert: {
          id?: string
          created_at?: string
          updated_at?: string
          name: string
          kind: SiteKind
          region?: string | null
          notes?: string | null
          active?: boolean
        }
        Update: Partial<Database['public']['Tables']['dive_sites']['Insert']>
        Relationships: []
      }
      almanac_records: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          diver_id: string
          site_id: string
          obs_date: string
          air_temp_c: number | null
          water_temp_c: number | null
          visibility_m: number | null
          current_strength: 'calm' | 'light' | 'moderate' | 'strong' | 'very_strong' | null
          wave_height_m: number | null
          wave_period_s: number | null
          weather: 'clear' | 'partly_cloudy' | 'cloudy' | 'overcast' | 'rain' | 'thunderstorm' | 'windy' | 'fog' | 'typhoon' | null
          wildlife: string[] | null
          coral_health: 'excellent' | 'good' | 'fair' | 'poor' | 'bleaching' | null
          elevation_m: number | null
          route_condition: 'dry' | 'wet' | 'muddy' | 'icy' | 'snow' | 'rockfall' | null
          summit_visible: boolean | null
          status: 'pending' | 'approved' | 'rejected'
          approved_by: string | null
          approved_at: string | null
          staff_notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          updated_at?: string
          diver_id?: string
          site_id: string
          obs_date: string
          air_temp_c?: number | null
          water_temp_c?: number | null
          visibility_m?: number | null
          current_strength?: 'calm' | 'light' | 'moderate' | 'strong' | 'very_strong' | null
          wave_height_m?: number | null
          wave_period_s?: number | null
          weather?: 'clear' | 'partly_cloudy' | 'cloudy' | 'overcast' | 'rain' | 'thunderstorm' | 'windy' | 'fog' | 'typhoon' | null
          wildlife?: string[] | null
          coral_health?: 'excellent' | 'good' | 'fair' | 'poor' | 'bleaching' | null
          elevation_m?: number | null
          route_condition?: 'dry' | 'wet' | 'muddy' | 'icy' | 'snow' | 'rockfall' | null
          summit_visible?: boolean | null
          status?: 'pending' | 'approved' | 'rejected'
          approved_by?: string | null
          approved_at?: string | null
          staff_notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['almanac_records']['Insert']>
        Relationships: []
      }
      travel_destinations: {
        Row: {
          id: string
          admin_title: string | null
          slug: string | null
          tagline: string | null
          country: string | null
          divetype: string | null
          sort_order: number | null
          international: boolean | null
          location_picture: string | null
          background_picture: string | null
          diver_requirements: string | null
        }
        Insert: {
          id: string
          admin_title?: string | null
          slug?: string | null
          tagline?: string | null
          country?: string | null
          divetype?: string | null
          sort_order?: number | null
          international?: boolean | null
          location_picture?: string | null
          background_picture?: string | null
          diver_requirements?: string | null
        }
        Update: Partial<Database['public']['Tables']['travel_destinations']['Insert']>
        Relationships: []
      }
      event_addons: {
        Row: { event_id: string; addon_id: string }
        Insert: { event_id: string; addon_id: string }
        Update: Partial<{ event_id: string; addon_id: string }>
        Relationships: []
      }
      event_destinations: {
        Row: { event_id: string; destination_id: string }
        Insert: { event_id: string; destination_id: string }
        Update: Partial<{ event_id: string; destination_id: string }>
        Relationships: []
      }
      event_rooms: {
        Row: { event_id: string; room_id: string }
        Insert: { event_id: string; room_id: string }
        Update: Partial<{ event_id: string; room_id: string }>
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
          last_seen_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
          last_seen_at?: string
        }
        Update: Partial<Database['public']['Tables']['push_subscriptions']['Insert']>
        Relationships: []
      }
      push_notifications_sent: {
        Row: {
          user_id: string
          event_id: string
          event_type: 'dive' | 'course' | 'adventure'
          kind: string
          sent_at: string
        }
        Insert: {
          user_id: string
          event_id: string
          event_type: 'dive' | 'course' | 'adventure'
          kind: string
          sent_at?: string
        }
        Update: Partial<Database['public']['Tables']['push_notifications_sent']['Insert']>
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          body: string | null
          url: string | null
          kind: string
          event_id: string | null
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          body?: string | null
          url?: string | null
          kind: string
          event_id?: string | null
          created_at?: string
          read_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
        Relationships: []
      }
      dive_logs: {
        Row: {
          id: string
          user_id: string
          dive_number: number
          title: string | null
          dived_on: string
          site: string
          dive_type: DiveType | null
          max_depth_m: number | null
          dive_time_min: number | null
          visibility_m: number | null
          water_temp_c: number | null
          air_temp_c: number | null
          weather: string | null
          wave_height_m: number | null
          weight_kg: number | null
          gear_used: string[]
          wetsuit_thickness: string | null
          gas_mix: GasMix | null
          tank_size_l: number | null
          start_pressure_bar: number | null
          end_pressure_bar: number | null
          buddy_name: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          // Optional on insert — the trigger fills it in when omitted.
          dive_number?: number
          title?: string | null
          dived_on: string
          site: string
          dive_type?: DiveType | null
          max_depth_m?: number | null
          dive_time_min?: number | null
          visibility_m?: number | null
          water_temp_c?: number | null
          air_temp_c?: number | null
          weather?: string | null
          wave_height_m?: number | null
          weight_kg?: number | null
          gear_used?: string[]
          wetsuit_thickness?: string | null
          gas_mix?: GasMix | null
          tank_size_l?: number | null
          start_pressure_bar?: number | null
          end_pressure_bar?: number | null
          buddy_name?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['dive_logs']['Insert']>
        Relationships: []
      }
      dive_log_export_requests: {
        Row: {
          id: string
          user_id: string
          requested_at: string
        }
        Insert: {
          id?: string
          user_id: string
          requested_at?: string
        }
        Update: Partial<Database['public']['Tables']['dive_log_export_requests']['Insert']>
        Relationships: []
      }
      waitlist_offers: {
        Row: {
          id: string
          booking_id: string
          offered_at: string
          expires_at: string
          notified_at: string | null
          status: WaitlistOfferStatus
        }
        Insert: {
          id?: string
          booking_id: string
          offered_at?: string
          expires_at?: string
          notified_at?: string | null
          status?: WaitlistOfferStatus
        }
        Update: Partial<Database['public']['Tables']['waitlist_offers']['Insert']>
        Relationships: []
      }
      staff_availability: {
        Row: {
          id: string
          user_id: string
          start_date: string
          start_time: string
          end_date: string
          title: string
          details: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          start_date: string
          start_time: string
          end_date: string
          title: string
          details?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['staff_availability']['Insert']>
        Relationships: []
      }
    }
  }
}

// Convenience row types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
export type BookingAmendment = Database['public']['Tables']['booking_amendments']['Row']
export type AdminAuditLog = Database['public']['Tables']['admin_audit_log']['Row']
/**
 * Where a credit row came from. Pinned to the DB's credits_source_check
 * (20260822100000). The two "money returned" values are the ones that block a
 * second automatic refund for the same booking — see RETURN_SOURCES in
 * src/lib/credits.ts.
 */
export type CreditSource =
  | 'manual'
  | 'event_cancellation'
  | 'booking_cancellation_return'
  | 'carry_forward'
  /** A `booking_cancellation_return` that was taken back when the booking was
   *  restored. Terminal, and deliberately NOT one of RETURN_SOURCES: the money
   *  is applied to the booking again, so the next cancellation must refund it
   *  afresh rather than treating it as already given back. */
  | 'return_reclaimed'
  /** An account charge: money the diver owes the shop for something with no
   *  event behind it. The ONE source whose `amount` is negative, and the one
   *  that is never tied to a booking — both enforced by
   *  `credits_amount_check` / `credits_charge_untied` (20260823130000). */
  | 'admin_charge'

export type Credit = Database['public']['Tables']['credits']['Row']
export type CreditInsert = Database['public']['Tables']['credits']['Insert']
export type EventRow = Database['public']['Tables']['events']['Row']
export type EventSeries = Database['public']['Tables']['event_series']['Row']
export type EventSeriesInsert = Database['public']['Tables']['event_series']['Insert']
export type EOPrice = Database['public']['Tables']['prices']['Row']
export type EORoom = Database['public']['Tables']['rooms']['Row']
export type EOAddon = Database['public']['Tables']['addons']['Row']
export type TripTemplateEntry = Database['public']['Tables']['trip_templates']['Row']
export type TravelDestination = Database['public']['Tables']['travel_destinations']['Row']
export type CancellationPolicy = Database['public']['Tables']['cancellation_policies']['Row']
export type CertLevel = Database['public']['Tables']['cert_levels']['Row']
export type AdminNote = Database['public']['Tables']['admin_notes']['Row']
export type DiverNote = Database['public']['Tables']['diver_notes']['Row']
export const NOTE_TAGS = ['urgent','payment','gear','logistics','cert','medical','note','general'] as const
export type NoteTag = typeof NOTE_TAGS[number]
export type Duty = Database['public']['Tables']['duties']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']

export const DIVE_TYPES = ['shore','boat','training','drift','night','wreck','other'] as const
export type DiveType = typeof DIVE_TYPES[number]

export const GAS_MIXES = ['air','EAN32','EAN36','other'] as const
export type GasMix = typeof GAS_MIXES[number]

export type DiveLog = Database['public']['Tables']['dive_logs']['Row']
export type DiveLogInsert = Database['public']['Tables']['dive_logs']['Insert']

// Transport fleet — shop vehicles for logistics ride planning
export type Vehicle = Database['public']['Tables']['vehicles']['Row']
export type VehicleInsert = Database['public']['Tables']['vehicles']['Insert']
// Trusted partners — the unified "dive shops abroad we vouch for" table. The
// admin/full row (incl. contact email + kickback) and its Insert; also hosts
// Packages via packages.trusted_partner_id.
export type TrustedPartnerRow = Database['public']['Tables']['trusted_partners']['Row']
export type TrustedPartnerInsert = Database['public']['Tables']['trusted_partners']['Insert']
// The diver-facing projection — no email (see list_trusted_partners()).
export type TrustedPartner = Database['public']['Functions']['list_trusted_partners']['Returns'][number]
export type EventVehicle = Database['public']['Tables']['event_vehicles']['Row']
export type EventVehicleInsert = Database['public']['Tables']['event_vehicles']['Insert']
export type EventRideGroup = Database['public']['Tables']['event_ride_groups']['Row']
export type EventRideGroupInsert = Database['public']['Tables']['event_ride_groups']['Insert']
// Gear sizing charts — per-shop wetsuit/BCD/fins models + size bands
export const GEAR_TYPES = ['wetsuit', 'bcd', 'fins'] as const
export type GearType = typeof GEAR_TYPES[number]
export type GearModel = Database['public']['Tables']['gear_models']['Row']
export type GearModelInsert = Database['public']['Tables']['gear_models']['Insert']
export type GearModelSize = Database['public']['Tables']['gear_model_sizes']['Row']
export type GearModelSizeInsert = Database['public']['Tables']['gear_model_sizes']['Insert']
export type WaiverSignature = Database['public']['Tables']['waiver_signatures']['Row']
export type WaiverSignatureInsert = Database['public']['Tables']['waiver_signatures']['Insert']
export type EventWaiver = Database['public']['Tables']['event_waivers']['Row']
export type EventWaiverInsert = Database['public']['Tables']['event_waivers']['Insert']
export type WaiverRow = Database['public']['Tables']['waivers']['Row']
export type WaiverInsert = Database['public']['Tables']['waivers']['Insert']
export type WaiverUpdate = Database['public']['Tables']['waivers']['Update']

// Packages — partner-shop registration network. A parent "product" (Package)
// holds price tiers (PackageTier) and references our add-on/room catalog; divers
// register (PackageRegistration) picking a tier, a date range and extras. The
// hosting partner is a trusted_partners row (TrustedPartnerRow, above).
export type Package = Database['public']['Tables']['packages']['Row']
export type PackageInsert = Database['public']['Tables']['packages']['Insert']
export type PackageTier = Database['public']['Tables']['package_tiers']['Row']
export type PackageTierInsert = Database['public']['Tables']['package_tiers']['Insert']
export type PackageRegistration = Database['public']['Tables']['package_registrations']['Row']
export type PackageRegistrationInsert = Database['public']['Tables']['package_registrations']['Insert']
export type PackageBoardItem = Database['public']['Functions']['list_package_board']['Returns'][number]
export type PackageTierItem = Database['public']['Functions']['list_package_tiers']['Returns'][number]
export type MyPackageRegistration = Database['public']['Functions']['list_my_package_registrations']['Returns'][number]
export const PACKAGE_STATUSES = ['draft','published','archived'] as const
export type PackageStatus = typeof PACKAGE_STATUSES[number]
export const REGISTRATION_STATUSES = ['registered','completed','cancelled'] as const
export type RegistrationStatus = typeof REGISTRATION_STATUSES[number]
export const KICKBACK_STATUSES = ['expected','paid'] as const
export type KickbackStatus = typeof KICKBACK_STATUSES[number]

// Scheduled Trips — the shop's own curated, dated trips
export type ScheduledTrip = Database['public']['Tables']['scheduled_trips']['Row']
export type ScheduledTripInsert = Database['public']['Tables']['scheduled_trips']['Insert']
export type ScheduledTripItem = Database['public']['Functions']['list_scheduled_trips']['Returns'][number]
export type ScheduledTripRegistration = Database['public']['Tables']['scheduled_trip_registrations']['Row']
export type ScheduledTripRegistrationInsert = Database['public']['Tables']['scheduled_trip_registrations']['Insert']
export type MyScheduledTripRegistration = Database['public']['Functions']['list_my_scheduled_trip_registrations']['Returns'][number]
export const SCHEDULED_TRIP_STATUSES = ['draft','published','archived'] as const
export type ScheduledTripStatus = typeof SCHEDULED_TRIP_STATUSES[number]

export const WAITLIST_OFFER_STATUSES = ['pending', 'accepted', 'expired'] as const
export type WaitlistOfferStatus = typeof WAITLIST_OFFER_STATUSES[number]
export type WaitlistOffer = Database['public']['Tables']['waitlist_offers']['Row']

// Almanac: crowdsourced environmental observations
export const ALMANAC_CURRENT_STRENGTHS = ['calm', 'light', 'moderate', 'strong', 'very_strong'] as const
export type AlmanacCurrentStrength = typeof ALMANAC_CURRENT_STRENGTHS[number]
export const ALMANAC_WEATHERS = ['clear', 'partly_cloudy', 'cloudy', 'overcast', 'rain', 'thunderstorm', 'windy', 'fog', 'typhoon'] as const
export type AlmanacWeather = typeof ALMANAC_WEATHERS[number]
export const ALMANAC_CORAL_HEALTHS = ['excellent', 'good', 'fair', 'poor', 'bleaching'] as const
export type AlmanacCoralHealth = typeof ALMANAC_CORAL_HEALTHS[number]
export const ALMANAC_ROUTE_CONDITIONS = ['dry', 'wet', 'muddy', 'icy', 'snow', 'rockfall'] as const
export type AlmanacRouteCondition = typeof ALMANAC_ROUTE_CONDITIONS[number]
// The dive_sites vocabulary: the event kinds the shop travels to a site for.
// Pinned to the DB's `dive_sites_kind_check`, and asserted against
// SITE_CONDITION_KINDS in dive-sites.test.ts — the two answer the same
// question from either side of the wire, so they must not drift.
export const SITE_KINDS = ['dive', 'adventure'] as const
export type SiteKind = typeof SITE_KINDS[number]

export const ALMANAC_STATUSES = ['pending', 'approved', 'rejected'] as const

/** A colony as the read RPCs return it: the submitted shape plus the position
 *  the survey assigned it, so a revision can be talked about colony by colony. */
export interface CoralColonyRow extends CoralColony {
  ordinal: number
}

/** One survey with its colony observations aggregated in, as both coral
 *  read RPCs return it. */
export interface CoralSurveyRow {
  id: string
  site_id: string
  site_name: string
  surveyed_on: string
  surveyed_at: string | null
  depth_m: number | null
  water_temp_c: number | null
  survey_method: CoralSurveyMethod
  transect_length_m: number | null
  notes: string | null
  created_at: string
  diver_display: string | null
  colonies: CoralColonyRow[]
}
export type AlmanacStatus = typeof ALMANAC_STATUSES[number]
export const DUTY_ROLES = ['instructor', 'guide', 'support'] as const
export type DutyRole = typeof DUTY_ROLES[number]

export type StaffAvailabilityInsert = Database['public']['Tables']['staff_availability']['Insert']
export type StaffAvailabilityUpdate = Database['public']['Tables']['staff_availability']['Update']

export type DiveSite = Database['public']['Tables']['dive_sites']['Row']
export type DiveSiteInsert = Database['public']['Tables']['dive_sites']['Insert']

// Almanac RPC return types
export type AlmanacEventRecord = Database['public']['Functions']['almanac_records_in_range']['Returns'][number]
export type AlmanacPendingRecord = Database['public']['Functions']['almanac_pending_records']['Returns'][number]
/** Privacy-projected row used by the UI. title/details are NULL for any
 *  entry not owned by the calling user. owner_display_name comes from the
 *  joined profiles row in staff_availability_view. */
export type StaffBusyEntry = Database['public']['Views']['staff_availability_view']['Row']

// The CoralWatch chart vocabulary lives in lib/coral-survey.ts with the
// arithmetic that reads it, so the page and the analysis share one definition.
export type { CoralColony, CoralHue, CoralLevel, CoralType, CoralSurveyMethod }

// The event vocabulary lives in lib/event-kinds.ts, which is import-free so the
// Deno edge functions and the push worker can share it. Re-exported here
// because this is where the rest of the app reaches for event types.
export type { EventKind } from '../lib/event-kinds'
export { EVENT_KINDS } from '../lib/event-kinds'

// Guard: the vocabulary must cover the generated `events.kind` union. Adding a
// kind to the DB without adding it to EVENT_KINDS would leave every
// kind-iterating caller quietly skipping it; this fails to compile until they
// agree.
type UncoveredEventKind = Exclude<
  Database['public']['Tables']['events']['Row']['kind'],
  import('../lib/event-kinds').EventKind
>
export type _EventKindsAreExhaustive = UncoveredEventKind extends never ? true
  : ['EVENT_KINDS is missing an event kind:', UncoveredEventKind]

/** Normalized event shape used across Calendar + Bookings UI. */
export interface AppEvent {
  id: string
  type: EventKind
  /** Diver-facing title — display_title with admin_title fallback. Used on
   *  every diver-facing surface (event detail, bookings, register form,
   *  notifications) EXCEPT the calendar grid pills, which use calendar_title
   *  when set so admins can give long-named events a short label that fits
   *  in a day square. */
  title: string
  /** Short label for the calendar grid pill — falls back to `title` at the
   *  call site when blank. Null when the source row has no calendar_title set. */
  calendar_title: string | null
  /** Course-only administrative category (events.admin_title, kind=course), e.g.
   *  "OW" / "AOW" / "EFR". Groups courses by type for the calendar's course
   *  filter — the diver-facing `title` varies per offering (and carries a
   *  capacity suffix), so it makes a noisy filter key. Null/absent for dives. */
  course_category?: string | null
  start_time: string // ISO timestamp
  end_time: string | null
  /**
   * Raw 24h start time as 'HH:mm', or null when the source row has no time
   * set. Carried separately from start_time because round-tripping through
   * Date+toISOString shifts to UTC and loses the "unset vs midnight" signal.
   */
  start_time_hhmm: string | null
  featured: boolean
  /** Stored image ref for the event's featured photo (a `wix:image://…` ref or
   *  a plain URL). Resolve to a displayable URL with resolveImageUrl() from
   *  src/lib/images.ts. Null/absent when the event has no image. Optional so
   *  lighter event literals can omit it. */
  featured_image?: string | null
  /** Admin-set manual "no more registrations" flag. Independent of capacity:
   *  set it to force an event onto the waitlist regardless of capacity. */
  fully_booked: boolean
  /** Maximum number of confirmed bookings the event accepts. NULL = no cap.
   *  Pending bookings don't count toward this — only status='confirmed' does. */
  capacity: number | null
  /** Live count of confirmed bookings (NULL if not loaded — most call sites
   *  populate it via fetchEventsInRange / fetchEventsForBookings). Combined
   *  with `capacity` to derive "X spots remaining" / fully-booked state. */
  confirmed_count: number | null
  price: number | null
  deposit_amount: number | null
  /** Per-tier transport surcharge from prices.transport (NTD). NULL or
   *  0 means transportation is bundled into the base price; the registration
   *  form hides the opt-in checkbox in that case. */
  transport_price: number | null
  currency: string
  /** Gating flags computed from the event_rooms / event_addons junctions. */
  has_rooms: boolean
  room_type_ids: string[]
  has_addons: boolean
  addon_ids: string[]
  /** Free text describing gear-rental pricing on dives; null/empty = no gear offered. */
  gear_rental_info: string | null
  /** dive: nitrox_required flag; course: always false (courses handle cert separately). */
  nitrox_required: boolean
  /** Number of in-water days. Used to gate the gear section on courses. */
  dive_days: number | null
  /** ISO timestamp of when the event was cancelled by an admin; null = active. */
  cancelled_at: string | null
  /** Dive flagged private: hidden from all diver-facing listings (in-app +
   *  Wix calendars, upcoming feeds), registerable only via a direct link.
   *  Always false for courses. */
  is_private: boolean
  /** Admin-set: does the shop drive anybody to this event? False for a dry
   *  course held at the shop (EFR, Equipment, O2 provider) — the registration
   *  form then puts no ride question at all and no car is assigned. True for
   *  everything else, including the courses that do travel to open water. */
  has_transport: boolean
  /**
   * Admin-set full-payment deadline (YYYY-MM-DD). When null the
   * registration form falls back to "7 days before start_date" — see
   * computeEffectiveFullPaymentDeadline in src/lib/payment-deadlines.ts.
   * The deposit deadline is always "ASAP" and is not stored per-event.
   */
  full_payment_deadline: string | null
  /** FK → cancellation_policies._id; null = no policy attached. */
  cancel_policy: string | null
  /** YYYY-MM-DD — the cancel-by date the policy text references. */
  cancel_date: string | null
  /** Dive-only calendar classification derived from the dive's linked
   *  travel_destinations: 'trip' = a boat dive or a destination beyond the
   *  local Northeast shore (→ yellow); 'local' = a Northeast shore dive
   *  (→ green); null/absent when no destination is tagged, so the calendar
   *  falls back to matching the title. Always absent for courses. */
  dive_outing?: 'local' | 'trip' | null
  /** Dive-only, admin-set, and INDEPENDENT of each other: a Kenting boat trip
   *  is both, a local day boat dive is only `is_boat_dive`, a Palau liveaboard
   *  is only `is_trip`. `is_trip` is a multi-day/liveaboard classification
   *  synced to the Wix `events` collection; the diver Scheduled Trips tab
   *  now reads the curated `scheduled_trips` table, not this flag. Absent for
   *  courses; optional so lighter event literals can omit them (default false). */
  is_boat_dive?: boolean
  is_trip?: boolean
  /** Human-readable event detail surfaced to divers in the calendar modal.
   *  Assembled in src/lib/events.ts from the descriptive columns admins fill
   *  in (a dive's `notes` + linked trip_templates row; a course's `included` /
   *  `schedule`) plus the prereq cert/dive requirements. Null when the event
   *  has no descriptive content at all. Always populated by fetchEventsInRange
   *  / fetchEventsForBookings; optional so lighter event literals can omit it. */
  details?: EventDetails | null
}

/** Descriptive, diver-facing detail for an event. Every field is optional
 *  content; a section renders only when its field is non-null. */
export interface EventDetails {
  /** Free-text overview — a dive's `notes`. Courses have no equivalent. */
  description: string | null
  /** What the price covers — a course's `included` or a dive's trip_templates.included. */
  included: string | null
  /** What the price excludes — dive trip_templates.not_included. Null for courses. */
  not_included: string | null
  /** Day-by-day plan — a course's `schedule` or a dive's trip_templates.itinerary. */
  schedule: string | null
  /** Transport arrangements — dive trip_templates.transportation. Null for courses. */
  transportation: string | null
  /** Free-text prerequisites — the event's `prereqs` (dive falls back to
   *  trip_templates.prerequisites). */
  prerequisites: string | null
  /** Minimum certification level name, resolved from `prereq_cert_id`. */
  required_cert: string | null
  /** Minimum logged dives required. */
  required_dives: number | null
}
