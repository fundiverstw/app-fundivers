export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

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
          cert_number: string | null
          cert_date: string | null
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
          cert_number?: string | null
          cert_date?: string | null
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
          cert_number?: string | null
          cert_date?: string | null
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
        }
        Insert: {
          id?: string
          created_at?: string
          user_id: string
          eo_dive_id?: string | null
          eo_course_id?: string | null
          status?: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          eo_dive_id?: string | null
          eo_course_id?: string | null
          status?: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes?: string | null
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
        }
        Insert: {
          _id: string
          course_title?: string | null
          title?: string | null
          start_date?: string | null
          start_time?: string | null
          end_date?: string | null
          price?: string | null
        }
        Update: Partial<Database['public']['Tables']['EO_courses']['Insert']>
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
  currency: string
}
