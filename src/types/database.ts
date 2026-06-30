import type { ChargeLine } from '../lib/booking-charges'

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
    /** Gear is rented à-la-carte only; `items` lists the chosen pieces. */
    mode?: 'a-la-carte'
    items?: string[]
    /** Set when the diver picked "I'm not sure — I need to ask a human" on
     *  the gear step. Free text describing their situation; surfaced
     *  prominently in the gear field on the PDF and every admin view so
     *  staff can follow up. When present, `rent` is false. */
    assistance_note?: string
    size_overrides?: {
      height_cm?: number | null
      weight_kg?: number | null
      shoe_size?: string | null
    }
  }
  room?: {
    option_id?: string | null
    notes?: string | null
  }
  add_ons?: string[]
  transportation?: boolean
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
        Args: {
          p_event_id:   string
          p_event_type: 'dive' | 'course'
        }
        Returns: string | null
      }
      // Defined in 20260507000000_waitlist_offers.sql; security-definer.
      // Atomically flips waitlist_offers.status -> 'accepted' and
      // bookings.status -> 'pending'. auth.uid() must own the booking.
      accept_waitlist_offer: {
        Args: { p_offer_id: string }
        Returns: void
      }
      // Defined in 20260514010000_event_capacity.sql; security-definer.
      // Returns one row per event with at least one confirmed booking.
      // Lets divers see real aggregate capacity numbers past their RLS.
      event_confirmed_counts: {
        Args: {
          p_dive_ids:   string[]
          p_course_ids: string[]
        }
        Returns: Array<{ event_id: string; event_type: 'dive' | 'course'; n: number }>
      }
      // Defined in 20260628000000_event_ride_seats.sql. Ride-seat tally for an
      // event: capacity (sum of passenger_seats over the distinct assigned
      // vehicles) and claimed (non-cancelled bookings with transportation=true).
      // SECURITY DEFINER so the registration form can read it as a plain diver.
      event_ride_seats: {
        Args: {
          p_dive_id:   string | null
          p_course_id: string | null
        }
        Returns: Array<{ capacity: number; claimed: number }>
      }
      // Defined in 20260603000000_terms_consent_versioning.sql.
      // Server-stamps both agreed_to_terms_at (now()) and
      // agreed_to_terms_version (caller-supplied) on the caller's
      // profile. Called by the re-acceptance UI on TermsPage when
      // RequireCurrentTerms detects a stale version.
      accept_current_terms: {
        Args: { p_version: number }
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
        Args: { p_lead: string; p_amount: number; p_group_id?: string | null }
        Returns: number
      }
      // Defined in 20260623000000_trip_board.sql. A diver expresses interest
      // in a published trip; mints (or returns the existing live) referral and
      // returns just the FD-XXXXXX code. Idempotent. authenticated-only.
      express_trip_interest: {
        Args: { p_trip_id: string }
        Returns: string
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
      // p_dive_id / p_course_id are set only for per-event waivers; annual
      // waivers pass neither. Returns the new signature's id.
      sign_waiver: {
        Args: {
          p_code:        string
          p_version:     number
          p_signed_name: string
          p_dive_id?:    string | null
          p_course_id?:  string | null
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
      // Defined in 20260623000000_trip_board.sql. Owner-privileged projection
      // of published trips joined to the partner shop we vouch for — diver-safe
      // columns only (no kickback rate). Divers have no access to base `trips`.
      trip_board: {
        Row: {
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
          booking_url: string | null
          published_at: string | null
          partner_shop_id: string
          partner_name: string
          partner_country: string
          partner_location: string | null
          partner_website: string | null
          partner_logo_url: string | null
          partner_vouch_notes: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      // Defined in 20260623000000_trip_board.sql. The caller's own referrals
      // (scoped to auth.uid()) with trip/partner labels — the kickback ledger
      // columns are intentionally absent.
      my_trip_referrals: {
        Row: {
          id: string
          trip_id: string
          referral_code: string
          status: 'interested' | 'introduced' | 'booked' | 'completed' | 'cancelled'
          created_at: string
          trip_title: string
          trip_destination: string
          partner_name: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
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
           *  by handle_new_user / accept_current_terms). When the SPA's
           *  CURRENT_TERMS_VERSION constant exceeds this, RequireCurrentTerms
           *  bounces the user to /terms for re-acceptance. Null = never
           *  consented. */
          agreed_to_terms_version: number | null
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
          role?: 'diver' | 'admin'
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
          role?: 'diver' | 'admin'
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
          eo_dive_id: string | null
          eo_course_id: string | null
          status: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes: string | null
          details: BookingDetails
          refund_requested_at: string | null
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
        }
        Insert: {
          id?: string
          created_at?: string
          user_id: string
          eo_dive_id?: string | null
          eo_course_id?: string | null
          status?: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes?: string | null
          details?: BookingDetails
          refund_requested_at?: string | null
          group_id?: string | null
          payer_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          eo_dive_id?: string | null
          eo_course_id?: string | null
          status?: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes?: string | null
          details?: BookingDetails
          refund_requested_at?: string | null
          group_id?: string | null
          payer_id?: string | null
        }
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
        }
        Relationships: []
      }
      partner_shops: {
        Row: {
          id: string
          created_at: string
          name: string
          country: string
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
          country: string
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
        Update: Partial<Database['public']['Tables']['partner_shops']['Insert']>
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
      event_vehicles: {
        Row: {
          id: string
          created_at: string
          created_by: string | null
          vehicle_id: string
          event_date: string
          eo_dive_id: string | null
          eo_course_id: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          created_by?: string | null
          vehicle_id: string
          event_date: string
          eo_dive_id?: string | null
          eo_course_id?: string | null
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['event_vehicles']['Insert']>
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
          eo_dive_id: string | null
          eo_course_id: string | null
        }
        // Divers never insert directly — sign_waiver() is the only write path.
        // Insert here covers the admin-correction policy.
        Insert: {
          id?: string
          created_at?: string
          diver_id: string
          waiver_code: string
          waiver_version: number
          signed_name: string
          signed_at?: string
          eo_dive_id?: string | null
          eo_course_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['waiver_signatures']['Insert']>
        Relationships: []
      }
      event_waivers: {
        Row: {
          id: string
          created_at: string
          created_by: string | null
          eo_dive_id: string | null
          eo_course_id: string | null
          waiver_code: string
          mode: 'require' | 'exempt'
        }
        Insert: {
          id?: string
          created_at?: string
          created_by?: string | null
          eo_dive_id?: string | null
          eo_course_id?: string | null
          waiver_code: string
          mode: 'require' | 'exempt'
        }
        Update: Partial<Database['public']['Tables']['event_waivers']['Insert']>
        Relationships: []
      }
      trips: {
        Row: {
          id: string
          created_at: string
          partner_shop_id: string
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
          booking_url: string | null
          kickback_rate: number
          status: 'draft' | 'published' | 'archived'
          published_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          partner_shop_id: string
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
          booking_url?: string | null
          kickback_rate?: number
          status?: 'draft' | 'published' | 'archived'
          published_at?: string | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['trips']['Insert']>
        Relationships: []
      }
      trip_referrals: {
        Row: {
          id: string
          created_at: string
          trip_id: string
          diver_id: string
          referral_code: string
          status: 'interested' | 'introduced' | 'booked' | 'completed' | 'cancelled'
          booked_amount: number | null
          booked_currency: string | null
          kickback_rate: number | null
          kickback_amount: number | null
          kickback_status: 'pending' | 'invoiced' | 'received'
          received_at: string | null
          admin_notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          trip_id: string
          diver_id: string
          referral_code?: string
          status?: 'interested' | 'introduced' | 'booked' | 'completed' | 'cancelled'
          booked_amount?: number | null
          booked_currency?: string | null
          kickback_rate?: number | null
          kickback_status?: 'pending' | 'invoiced' | 'received'
          received_at?: string | null
          admin_notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['trip_referrals']['Insert']>
        Relationships: []
      }
      EO_dives: {
        Row: {
          _id: string
          admin_title: string | null
          display_title: string | null
          calendar_title: string | null
          start_date: string | null
          time: string | null
          end_date: string | null
          featured: boolean | null
          fully_booked: boolean | null
          price: string | null
          has_rooms: boolean | null
          room_types: string | null
          hasotheraddons: boolean | null
          other_addons: string | null
          gear_rental: string | null
          nitrox_required: boolean | null
          dive_days: number | null
          // Read by /admin/new's preload-from-past picker.
          featured_image: string | null
          second_image: string | null
          prereqs: string | null
          req_dives: number | null
          notes: string | null
          cancel_date: string | null
          cancel_policy: string | null
          destination_reference: string | null
          DiveTravel_reference: string | null
          prereq_cert_id: string | null
          cancelled_at: string | null
          full_payment_deadline: string | null
          capacity: number | null
          is_private: boolean | null
        }
        Insert: {
          _id: string
          admin_title?: string | null
          display_title?: string | null
          calendar_title?: string | null
          start_date?: string | null
          time?: string | null
          end_date?: string | null
          featured?: boolean | null
          fully_booked?: boolean | null
          price?: string | null
          notes?: string | null
          has_rooms?: boolean | null
          room_types?: string | null
          hasotheraddons?: boolean | null
          other_addons?: string | null
          gear_rental?: string | null
          nitrox_required?: boolean | null
          dive_days?: number | null
          cancelled_at?: string | null
          full_payment_deadline?: string | null
          capacity?: number | null
          is_private?: boolean | null
        }
        Update: Partial<Database['public']['Tables']['EO_dives']['Insert']>
        Relationships: []
      }
      EO_courses: {
        Row: {
          _id: string
          admin_title: string | null
          display_title: string | null
          calendar_title: string | null
          start_time: string | null
          price: string | null
          other_addons: string | null
          dive_days: number | null
          // Sole source of truth for the days a course runs on (max 4).
          // Replaced the old start_date/end_date envelope.
          course_days: string[] | null
          // Read by /admin/new's preload-from-past picker.
          course_name: string | null
          featured_image: string | null
          prereqs: string | null
          req_dives: string | null
          included: string | null
          schedule: string | null
          starting_at: number | null
          prereq_cert_id: string | null
          cancelled_at: string | null
          full_payment_deadline: string | null
          cancel_date: string | null
          cancel_policy: string | null
          fully_booked: boolean | null
          capacity: number | null
        }
        Insert: {
          _id: string
          admin_title?: string | null
          display_title?: string | null
          calendar_title?: string | null
          start_time?: string | null
          price?: string | null
          other_addons?: string | null
          dive_days?: number | null
          course_days?: string[] | null
          cancelled_at?: string | null
          full_payment_deadline?: string | null
          cancel_date?: string | null
          cancel_policy?: string | null
          fully_booked?: boolean | null
          capacity?: number | null
        }
        Update: Partial<Database['public']['Tables']['EO_courses']['Insert']>
        Relationships: []
      }
      dive_sites: {
        Row: {
          id: string
          name: string
          tagline: string | null
          latitude: number
          longitude: number
          region: 'keelung' | 'longdong' | 'yilan' | 'greenisland' | 'lanyu' | 'xiaoliuqiu' | 'kenting' | 'penghu'
          dive_type: 'shore' | 'boat' | null
          wix_slug: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          tagline?: string | null
          latitude: number
          longitude: number
          region: 'keelung' | 'longdong' | 'yilan' | 'greenisland' | 'lanyu' | 'xiaoliuqiu' | 'kenting' | 'penghu'
          dive_type?: 'shore' | 'boat' | null
          wix_slug?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['dive_sites']['Insert']>
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
          eo_dive_id: string | null
          eo_course_id: string | null
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
          eo_dive_id?: string | null
          eo_course_id?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          created_by?: string | null
          assignee_id?: string
          role?: 'instructor' | 'guide' | 'support'
          start_date?: string
          end_date?: string | null
          eo_dive_id?: string | null
          eo_course_id?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      admin_notes: {
        Row: {
          id: string
          created_at: string
          created_by: string
          eo_dive_id: string | null
          eo_course_id: string | null
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
          eo_dive_id?: string | null
          eo_course_id?: string | null
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
          eo_dive_id?: string | null
          eo_course_id?: string | null
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
      EO_prices: {
        Row: {
          _id: string
          admin_title: string
          starting_at: number | null
          deposit_amount: number | null
          /** Per-tier transportation surcharge in NTD. NULL or 0 means
           *  transportation is bundled into the base price. */
          transport: number | null
        }
        Insert: {
          _id: string
          admin_title: string
          starting_at?: number | null
          deposit_amount?: number | null
          transport?: number | null
        }
        Update: Partial<Database['public']['Tables']['EO_prices']['Insert']>
        Relationships: []
      }
      EO_rooms: {
        Row: {
          _id: string
          admin_title: string | null
          display_title: string | null
          added_price: number | null
          currency: string | null
        }
        Insert: {
          _id: string
          admin_title?: string | null
          display_title?: string | null
          added_price?: number | null
          currency?: string | null
        }
        Update: Partial<Database['public']['Tables']['EO_rooms']['Insert']>
        Relationships: []
      }
      Other_Addons: {
        Row: {
          _id: string
          admin_title: string | null
          display_title: string | null
          price: number | null
          currency: string | null
        }
        Insert: {
          _id: string
          admin_title?: string | null
          display_title?: string | null
          price?: number | null
          currency?: string | null
        }
        Update: Partial<Database['public']['Tables']['Other_Addons']['Insert']>
        Relationships: []
      }
      DiveTravel: {
        Row: {
          _id: string
          admin_title: string | null
          included: string | null
          not_included: string | null
          transportation: string | null
          itinerary: string | null
          prerequisites: string | null
          tagline_text: string | null
        }
        Insert: {
          _id: string
          admin_title?: string | null
          included?: string | null
          not_included?: string | null
          transportation?: string | null
          itinerary?: string | null
          prerequisites?: string | null
          tagline_text?: string | null
        }
        Update: Partial<Database['public']['Tables']['DiveTravel']['Insert']>
        Relationships: []
      }
      cancellation_policies: {
        // 'cancelation_policy' (single l) preserved from the Wix CSV import.
        Row: {
          _id: string
          title: string | null
          cancelation_policy: string | null
        }
        Insert: {
          _id: string
          title?: string | null
          cancelation_policy?: string | null
        }
        Update: Partial<Database['public']['Tables']['cancellation_policies']['Insert']>
        Relationships: []
      }
      TravelDestinations: {
        Row: {
          _id: string
          admin_title: string | null
          slug: string | null
          tagline: string | null
          country: string | null
          divetype: string | null
          sort_order: number | null
          latitude: number | null
          longitude: number | null
          international: boolean | null
          northeast_diving: boolean | null
          location_picture: string | null
          background_picture: string | null
          diver_requirements: string | null
        }
        Insert: {
          _id: string
          admin_title?: string | null
          slug?: string | null
          tagline?: string | null
          country?: string | null
          divetype?: string | null
          sort_order?: number | null
          latitude?: number | null
          longitude?: number | null
          international?: boolean | null
          northeast_diving?: boolean | null
          location_picture?: string | null
          background_picture?: string | null
          diver_requirements?: string | null
        }
        Update: Partial<Database['public']['Tables']['TravelDestinations']['Insert']>
        Relationships: []
      }
      eo_dive_addons: {
        Row: { eo_dive_id: string; addon_id: string }
        Insert: { eo_dive_id: string; addon_id: string }
        Update: Partial<{ eo_dive_id: string; addon_id: string }>
        Relationships: []
      }
      eo_dive_destinations: {
        Row: { eo_dive_id: string; destination_id: string }
        Insert: { eo_dive_id: string; destination_id: string }
        Update: Partial<{ eo_dive_id: string; destination_id: string }>
        Relationships: []
      }
      eo_dive_rooms: {
        Row: { eo_dive_id: string; room_id: string }
        Insert: { eo_dive_id: string; room_id: string }
        Update: Partial<{ eo_dive_id: string; room_id: string }>
        Relationships: []
      }
      eo_course_addons: {
        Row: { eo_course_id: string; addon_id: string }
        Insert: { eo_course_id: string; addon_id: string }
        Update: Partial<{ eo_course_id: string; addon_id: string }>
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
          event_type: 'dive' | 'course'
          kind: string
          sent_at: string
        }
        Insert: {
          user_id: string
          event_id: string
          event_type: 'dive' | 'course'
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
          gas_mix: GasMix | null
          tank_size_l: number | null
          start_pressure_bar: number | null
          end_pressure_bar: number | null
          buddy_name: string | null
          instructor_name: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          // Optional on insert — the trigger fills it in when omitted.
          dive_number?: number
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
          gas_mix?: GasMix | null
          tank_size_l?: number | null
          start_pressure_bar?: number | null
          end_pressure_bar?: number | null
          buddy_name?: string | null
          instructor_name?: string | null
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
export type Credit = Database['public']['Tables']['credits']['Row']
export type CreditInsert = Database['public']['Tables']['credits']['Insert']
export type EODive = Database['public']['Tables']['EO_dives']['Row']
export type EOCourse = Database['public']['Tables']['EO_courses']['Row']
export type EOPrice = Database['public']['Tables']['EO_prices']['Row']
export type EORoom = Database['public']['Tables']['EO_rooms']['Row']
export type EOAddon = Database['public']['Tables']['Other_Addons']['Row']
export type DiveTravelEntry = Database['public']['Tables']['DiveTravel']['Row']
export type TravelDestination = Database['public']['Tables']['TravelDestinations']['Row']
export type CancellationPolicy = Database['public']['Tables']['cancellation_policies']['Row']
export type DiveSite = Database['public']['Tables']['dive_sites']['Row']
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
export type EventVehicle = Database['public']['Tables']['event_vehicles']['Row']
export type EventVehicleInsert = Database['public']['Tables']['event_vehicles']['Insert']
export type WaiverSignature = Database['public']['Tables']['waiver_signatures']['Row']
export type WaiverSignatureInsert = Database['public']['Tables']['waiver_signatures']['Insert']
export type EventWaiver = Database['public']['Tables']['event_waivers']['Row']
export type EventWaiverInsert = Database['public']['Tables']['event_waivers']['Insert']

// Trip Board — partner referral network
export type PartnerShop = Database['public']['Tables']['partner_shops']['Row']
export type PartnerShopInsert = Database['public']['Tables']['partner_shops']['Insert']
export type Trip = Database['public']['Tables']['trips']['Row']
export type TripInsert = Database['public']['Tables']['trips']['Insert']
export type TripReferral = Database['public']['Tables']['trip_referrals']['Row']
export type TripBoardItem = Database['public']['Views']['trip_board']['Row']
export type MyTripReferral = Database['public']['Views']['my_trip_referrals']['Row']
export const TRIP_STATUSES = ['draft','published','archived'] as const
export type TripStatus = typeof TRIP_STATUSES[number]
export const REFERRAL_STATUSES = ['interested','introduced','booked','completed','cancelled'] as const
export type ReferralStatus = typeof REFERRAL_STATUSES[number]
export const KICKBACK_STATUSES = ['pending','invoiced','received'] as const
export type KickbackStatus = typeof KICKBACK_STATUSES[number]

export const WAITLIST_OFFER_STATUSES = ['pending', 'accepted', 'expired'] as const
export type WaitlistOfferStatus = typeof WAITLIST_OFFER_STATUSES[number]
export type WaitlistOffer = Database['public']['Tables']['waitlist_offers']['Row']
export const DUTY_ROLES = ['instructor', 'guide', 'support'] as const
export type DutyRole = typeof DUTY_ROLES[number]

export type StaffAvailabilityInsert = Database['public']['Tables']['staff_availability']['Insert']
export type StaffAvailabilityUpdate = Database['public']['Tables']['staff_availability']['Update']
/** Privacy-projected row used by the UI. title/details are NULL for any
 *  entry not owned by the calling user. owner_display_name comes from the
 *  joined profiles row in staff_availability_view. */
export type StaffBusyEntry = Database['public']['Views']['staff_availability_view']['Row']

/** Normalized event shape used across Calendar + Bookings UI. */
export interface AppEvent {
  id: string
  type: 'dive' | 'course'
  /** Diver-facing title — display_title with admin_title fallback. Used on
   *  every diver-facing surface (event detail, bookings, register form,
   *  notifications) EXCEPT the calendar grid pills, which use calendar_title
   *  when set so admins can give long-named events a short label that fits
   *  in a day square. */
  title: string
  /** Short label for the calendar grid pill — falls back to `title` at the
   *  call site when blank. Null when the source row has no calendar_title set. */
  calendar_title: string | null
  /** Course-only administrative category (EO_courses.admin_title), e.g.
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
  /** Per-tier transport surcharge from EO_prices.transport (NTD). NULL or
   *  0 means transportation is bundled into the base price; the registration
   *  form hides the opt-in checkbox in that case. */
  transport_price: number | null
  currency: string
  /** Source table gating flags — parsed from EO_dives/EO_courses columns. */
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
   *  TravelDestinations: 'trip' = a boat dive or a destination beyond the
   *  local Northeast shore (→ yellow); 'local' = a Northeast shore dive
   *  (→ green); null/absent when no destination is tagged, so the calendar
   *  falls back to matching the title. Always absent for courses. */
  dive_outing?: 'local' | 'trip' | null
  /** Human-readable event detail surfaced to divers in the calendar modal.
   *  Assembled in src/lib/events.ts from the descriptive columns admins fill
   *  in (a dive's `notes` + linked DiveTravel row; a course's `included` /
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
  /** What the price covers — a course's `included` or a dive's DiveTravel.included. */
  included: string | null
  /** What the price excludes — dive DiveTravel.not_included. Null for courses. */
  not_included: string | null
  /** Day-by-day plan — a course's `schedule` or a dive's DiveTravel.itinerary. */
  schedule: string | null
  /** Transport arrangements — dive DiveTravel.transportation. Null for courses. */
  transportation: string | null
  /** Free-text prerequisites — the event's `prereqs` (dive falls back to
   *  DiveTravel.prerequisites). */
  prerequisites: string | null
  /** Minimum certification level name, resolved from `prereq_cert_id`. */
  required_cert: string | null
  /** Minimum logged dives required. */
  required_dives: number | null
}
