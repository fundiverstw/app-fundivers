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
    mode?: 'full' | 'a-la-carte' | 'provided'
    items?: string[]
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
  payment_method?: 'bank_transfer' | 'credit_card' | 'cash'
  nitrox_course_addon?: boolean
  total?: number
  deposit?: number
}

/**
 * EO_* table Row shapes are minimal here — only the columns the app
 * actually reads. Those tables carry dozens of legacy columns from the
 * Wix import; if the app ever needs more, add them.
 */
export interface Database {
  public: {
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
    Views: Record<string, never>
    Tables: {
      profiles: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          full_name: string | null
          display_name: string | null
          phone: string | null
          date_of_birth: string | null
          nationality: string | null
          id_number: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          cert_agency: string | null
          cert_level: string | null
          cert_card_path: string | null
          medical_notes: string | null
          avatar_url: string | null
          role: 'diver' | 'admin'
          height_cm: number | null
          weight_kg: number | null
          shoe_size: string | null
          gender: string | null
          contact_method: 'whatsapp' | 'line' | 'phone' | 'email' | null
          contact_id: string | null
          nitrox_certified: boolean
          logged_dives: number
          last_dive_date: string | null
          gear_owned: string[]
          agreed_to_terms_at: string | null
        }
        Insert: {
          id: string
          created_at?: string
          updated_at?: string
          full_name?: string | null
          display_name?: string | null
          phone?: string | null
          date_of_birth?: string | null
          nationality?: string | null
          id_number?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          cert_agency?: string | null
          cert_level?: string | null
          cert_card_path?: string | null
          medical_notes?: string | null
          avatar_url?: string | null
          role?: 'diver' | 'admin'
          height_cm?: number | null
          weight_kg?: number | null
          shoe_size?: string | null
          gender?: string | null
          contact_method?: 'whatsapp' | 'line' | 'phone' | 'email' | null
          contact_id?: string | null
          nitrox_certified?: boolean
          logged_dives?: number
          last_dive_date?: string | null
          gear_owned?: string[]
        }
        Update: {
          id?: string
          updated_at?: string
          full_name?: string | null
          display_name?: string | null
          phone?: string | null
          date_of_birth?: string | null
          nationality?: string | null
          id_number?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          cert_agency?: string | null
          cert_level?: string | null
          cert_card_path?: string | null
          medical_notes?: string | null
          avatar_url?: string | null
          role?: 'diver' | 'admin'
          height_cm?: number | null
          weight_kg?: number | null
          shoe_size?: string | null
          gender?: string | null
          contact_method?: 'whatsapp' | 'line' | 'phone' | 'email' | null
          contact_id?: string | null
          nitrox_certified?: boolean
          logged_dives?: number
          last_dive_date?: string | null
          gear_owned?: string[]
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
        }
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
          status: 'pending' | 'paid' | 'refunded'
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
          status?: 'pending' | 'paid' | 'refunded'
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
          status?: 'pending' | 'paid' | 'refunded'
          method?: string | null
          note?: string | null
          recorded_by?: string | null
        }
        Relationships: []
      }
      EO_dives: {
        Row: {
          _id: string
          dive_title: string | null
          title: string | null
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
          nitrox_required: string | null
          dive_days: number | null
        }
        Insert: {
          _id: string
          dive_title?: string | null
          title?: string | null
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
          nitrox_required?: string | null
          dive_days?: number | null
        }
        Update: Partial<Database['public']['Tables']['EO_dives']['Insert']>
        Relationships: []
      }
      EO_courses: {
        Row: {
          _id: string
          course_title: string | null
          title: string | null
          start_date: string | null
          start_time: string | null
          end_date: string | null
          price: string | null
          other_addons: string | null
          dive_days: number | null
          special_date: string | null
        }
        Insert: {
          _id: string
          course_title?: string | null
          title?: string | null
          start_date?: string | null
          start_time?: string | null
          end_date?: string | null
          price?: string | null
          other_addons?: string | null
          dive_days?: number | null
          special_date?: string | null
        }
        Update: Partial<Database['public']['Tables']['EO_courses']['Insert']>
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
      EO_prices: {
        Row: {
          _id: string
          title: string
          starting_at: number | null
          deposit_amount: number | null
        }
        Insert: {
          _id: string
          title: string
          starting_at?: number | null
          deposit_amount?: number | null
        }
        Update: Partial<Database['public']['Tables']['EO_prices']['Insert']>
        Relationships: []
      }
      EO_rooms: {
        Row: {
          _id: string
          title: string | null
          display_name: string | null
          added_price: number | null
          currency: string | null
        }
        Insert: {
          _id: string
          title?: string | null
          display_name?: string | null
          added_price?: number | null
          currency?: string | null
        }
        Update: Partial<Database['public']['Tables']['EO_rooms']['Insert']>
        Relationships: []
      }
      Other_Addons: {
        Row: {
          _id: string
          title: string | null
          display_name: string | null
          price: number | null
          currency: string | null
        }
        Insert: {
          _id: string
          title?: string | null
          display_name?: string | null
          price?: number | null
          currency?: string | null
        }
        Update: Partial<Database['public']['Tables']['Other_Addons']['Insert']>
        Relationships: []
      }
      eo_dive_addons: {
        Row: { eo_dive_id: string; addon_id: string }
        Insert: { eo_dive_id: string; addon_id: string }
        Update: Partial<{ eo_dive_id: string; addon_id: string }>
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
    }
  }
}

// Convenience row types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
export type EODive = Database['public']['Tables']['EO_dives']['Row']
export type EOCourse = Database['public']['Tables']['EO_courses']['Row']
export type EOPrice = Database['public']['Tables']['EO_prices']['Row']
export type EORoom = Database['public']['Tables']['EO_rooms']['Row']
export type EOAddon = Database['public']['Tables']['Other_Addons']['Row']
export type AdminNote = Database['public']['Tables']['admin_notes']['Row']
export const NOTE_TAGS = ['urgent','payment','gear','logistics','cert','medical','note','general'] as const
export type NoteTag = typeof NOTE_TAGS[number]
export type Duty = Database['public']['Tables']['duties']['Row']
export const DUTY_ROLES = ['instructor', 'guide', 'support'] as const
export type DutyRole = typeof DUTY_ROLES[number]

/** Normalized event shape used across Calendar + Bookings UI. */
export interface AppEvent {
  id: string
  type: 'dive' | 'course'
  title: string
  start_time: string // ISO timestamp
  end_time: string | null
  featured: boolean
  fully_booked: boolean
  price: number | null
  deposit_amount: number | null
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
}
