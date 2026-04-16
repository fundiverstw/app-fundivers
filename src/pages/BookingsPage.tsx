import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { Activity, Booking } from '../types/database'

type BookingWithActivity = Booking & { activity: Activity }

const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-amber-400',
  confirmed: 'text-emerald-400',
  cancelled: 'text-slate-500 line-through',
  waitlisted: 'text-violet-400',
}

export function BookingsPage() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState<BookingWithActivity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('bookings')
      .select('*, activity:activities(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setBookings((data as BookingWithActivity[]) ?? [])
        setLoading(false)
      })
  }, [user])

  const upcoming = bookings.filter(b =>
    b.status !== 'cancelled' && new Date(b.activity.start_time) >= new Date()
  )
  const past = bookings.filter(b =>
    b.status === 'cancelled' || new Date(b.activity.start_time) < new Date()
  )

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  function BookingCard({ b }: { b: BookingWithActivity }) {
    return (
      <div className="bg-slate-800 rounded-xl p-4 space-y-1">
        <div className="flex items-start justify-between">
          <span className="font-medium text-slate-100 text-sm">{b.activity.title}</span>
          <span className={`text-xs font-medium capitalize ${STATUS_STYLES[b.status]}`}>{b.status}</span>
        </div>
        <p className="text-xs text-slate-400">
          {format(new Date(b.activity.start_time), 'EEE, MMM d yyyy · HH:mm')}
        </p>
        {b.activity.location && (
          <p className="text-xs text-slate-400">📍 {b.activity.location}</p>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-100">My Bookings</h1>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Upcoming</h2>
        {upcoming.length === 0
          ? <p className="text-slate-500 text-sm">No upcoming bookings. Check the calendar!</p>
          : <div className="space-y-2">{upcoming.map(b => <BookingCard key={b.id} b={b} />)}</div>
        }
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Past / Cancelled</h2>
          <div className="space-y-2">{past.map(b => <BookingCard key={b.id} b={b} />)}</div>
        </section>
      )}
    </div>
  )
}
