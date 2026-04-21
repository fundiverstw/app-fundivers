export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
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
          role: 'customer' | 'staff' | 'admin'
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
          role?: 'customer' | 'staff' | 'admin'
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
          role?: 'customer' | 'staff' | 'admin'
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
    }
    Views: {
      events: {
        Row: {
          id: string
          type: 'dive' | 'course'
          title: string
          start_time: string
          end_time: string | null
          featured: boolean
          fully_booked: boolean
          price: number | null
          deposit_amount: number | null
          currency: string
        }
      }
    }
  }
}

// Convenience row types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
export type Event = Database['public']['Views']['events']['Row']
