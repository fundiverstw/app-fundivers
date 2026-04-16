export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Views: Record<string, never>
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
      activities: {
        Row: {
          id: string
          created_at: string
          title: string
          description: string | null
          type: 'dive' | 'course' | 'event'
          start_time: string
          end_time: string | null
          location: string | null
          capacity: number | null
          price: number | null
          currency: string
          is_published: boolean
        }
        Insert: {
          id?: string
          created_at?: string
          title: string
          description?: string | null
          type: 'dive' | 'course' | 'event'
          start_time: string
          end_time?: string | null
          location?: string | null
          capacity?: number | null
          price?: number | null
          currency?: string
          is_published?: boolean
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          type?: 'dive' | 'course' | 'event'
          start_time?: string
          end_time?: string | null
          location?: string | null
          capacity?: number | null
          price?: number | null
          currency?: string
          is_published?: boolean
        }
        Relationships: []
      }
      bookings: {
        Row: {
          id: string
          created_at: string
          user_id: string
          activity_id: string
          status: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          user_id: string
          activity_id: string
          status?: 'pending' | 'confirmed' | 'cancelled' | 'waitlisted'
          notes?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          activity_id?: string
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
  }
}

// Convenience row types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Activity = Database['public']['Tables']['activities']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
