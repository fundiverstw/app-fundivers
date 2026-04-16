import { useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { Activity, Booking } from '../types/database'

const TYPE_COLORS: Record<Activity['type'], string> = {
  dive: 'bg-sky-500',
  course: 'bg-emerald-500',
  event: 'bg-violet-500',
}

const TYPE_LABELS: Record<Activity['type'], string> = {
  dive: 'Dive',
  course: 'Course',
  event: 'Event',
}

export function CalendarPage() {
  const { user } = useAuth()
  const [month, setMonth] = useState(new Date())
  const [activities, setActivities] = useState<Activity[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selected, setSelected] = useState<Activity | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })

  useEffect(() => {
    const from = startOfMonth(month).toISOString()
    const to = endOfMonth(month).toISOString()
    supabase
      .from('activities')
      .select('*')
      .eq('is_published', true)
      .gte('start_time', from)
      .lte('start_time', to)
      .order('start_time')
      .then(({ data }) => setActivities(data ?? []))
  }, [month])

  useEffect(() => {
    if (!user) return
    supabase
      .from('bookings')
      .select('*')
      .eq('user_id', user.id)
      .then(({ data }) => setBookings(data ?? []))
  }, [user])

  function activitiesOnDay(day: Date) {
    return activities.filter(a => isSameDay(new Date(a.start_time), day))
  }

  function isBooked(activityId: string) {
    return bookings.some(b => b.activity_id === activityId && b.status !== 'cancelled')
  }

  async function handleBook() {
    if (!user || !selected) return
    setBookingLoading(true)
    if (isBooked(selected.id)) {
      // Cancel
      await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('user_id', user.id)
        .eq('activity_id', selected.id)
      setBookings(prev => prev.map(b =>
        b.activity_id === selected.id ? { ...b, status: 'cancelled' } : b
      ))
    } else {
      // Book
      const { data } = await supabase
        .from('bookings')
        .insert({ user_id: user.id, activity_id: selected.id, status: 'pending' })
        .select()
        .single()
      if (data) setBookings(prev => [...prev, data])
    }
    setBookingLoading(false)
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-2 text-slate-400 hover:text-slate-100">‹</button>
        <h1 className="text-lg font-bold text-slate-100">{format(month, 'MMMM yyyy')}</h1>
        <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 text-slate-400 hover:text-slate-100">›</button>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-xs text-slate-400">
        {(Object.keys(TYPE_COLORS) as Activity['type'][]).map(t => (
          <span key={t} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${TYPE_COLORS[t]}`} />{TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-slate-700 rounded-xl overflow-hidden text-sm">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="bg-slate-800 text-center text-xs text-slate-500 py-1">{d}</div>
        ))}
        {/* leading empty cells */}
        {Array.from({ length: days[0].getDay() }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-slate-800 h-14" />
        ))}
        {days.map(day => {
          const dayActivities = activitiesOnDay(day)
          const isToday = isSameDay(day, new Date())
          const inMonth = isSameMonth(day, month)
          return (
            <div
              key={day.toISOString()}
              className={`bg-slate-800 h-14 p-1 cursor-pointer hover:bg-slate-700 transition-colors ${!inMonth ? 'opacity-30' : ''}`}
              onClick={() => dayActivities.length > 0 && setSelected(dayActivities[0])}
            >
              <span className={`text-xs block text-center rounded-full w-5 h-5 flex items-center justify-center mx-auto ${
                isToday ? 'bg-sky-500 text-white font-bold' : 'text-slate-300'
              }`}>
                {format(day, 'd')}
              </span>
              <div className="flex flex-wrap gap-0.5 mt-0.5 justify-center">
                {dayActivities.map(a => (
                  <span key={a.id} className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[a.type]}`} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Activity list for month */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">This month</h2>
        {activities.length === 0 && (
          <p className="text-slate-500 text-sm">No activities scheduled.</p>
        )}
        {activities.map(activity => (
          <button
            key={activity.id}
            onClick={() => setSelected(activity)}
            className="w-full text-left bg-slate-800 rounded-xl p-3 hover:bg-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${TYPE_COLORS[activity.type]}`}>
                    {TYPE_LABELS[activity.type]}
                  </span>
                  <span className="font-medium text-slate-100 text-sm">{activity.title}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {format(new Date(activity.start_time), 'EEE, MMM d · HH:mm')}
                  {activity.location && ` · ${activity.location}`}
                </p>
              </div>
              {isBooked(activity.id) && (
                <span className="text-xs text-emerald-400 font-medium shrink-0">Booked</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Activity detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-slate-800 rounded-t-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full text-white ${TYPE_COLORS[selected.type]}`}>
                {TYPE_LABELS[selected.type]}
              </span>
              <button onClick={() => setSelected(null)} className="text-slate-400 text-xl leading-none">×</button>
            </div>
            <h2 className="text-xl font-bold text-slate-100">{selected.title}</h2>
            <div className="text-sm text-slate-400 space-y-1">
              <p>{format(new Date(selected.start_time), 'EEEE, MMMM d · HH:mm')}</p>
              {selected.location && <p>📍 {selected.location}</p>}
              {selected.capacity && <p>👥 Capacity: {selected.capacity}</p>}
              {selected.price != null && (
                <p>💰 {selected.price === 0 ? 'Free' : `${selected.currency} ${selected.price.toLocaleString()}`}</p>
              )}
            </div>
            {selected.description && (
              <p className="text-sm text-slate-300 leading-relaxed">{selected.description}</p>
            )}
            <button
              onClick={handleBook}
              disabled={bookingLoading}
              className={`w-full py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
                isBooked(selected.id)
                  ? 'bg-slate-600 hover:bg-red-900 text-slate-200'
                  : 'bg-sky-500 hover:bg-sky-600 text-white'
              }`}
            >
              {bookingLoading ? '…' : isBooked(selected.id) ? 'Cancel booking' : 'Register'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
