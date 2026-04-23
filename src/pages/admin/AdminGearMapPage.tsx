import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { fetchEventsForBookings, formatEventSpan } from '../../lib/events'
import { AdminNotes } from '../../components/admin/AdminNotes'
import { GEAR_ITEMS } from '../../lib/gear'
import { shoeAsJp } from '../../lib/shoe-size'
import type { AppEvent, Booking, Profile } from '../../types/database'

// What items the shop actually needs to pack for this diver. Derived from
// the booking-time gear selection — `details.gear.mode` + `items` — not from
// profile.gear_owned. The diver made a choice at registration; that's the
// source of truth for what to physically pack.
function packList(booking: Booking): { summary: string; items: string[] } {
  const g = booking.details?.gear
  if (!g || !g.rent) return { summary: 'Own gear', items: [] }
  if (g.mode === 'provided') return { summary: 'Provided by shop', items: [] }
  if (g.mode === 'full') return { summary: 'Full set', items: [...GEAR_ITEMS] }
  if (g.mode === 'a-la-carte') return {
    summary: g.items?.length ? `À-la-carte (${g.items.length})` : 'À-la-carte (none)',
    items: g.items ?? [],
  }
  return { summary: 'Own gear', items: [] }
}

interface Row {
  booking: Booking
  profile: Profile | null
}

export function AdminGearMapPage() {
  const { type, id } = useParams<{ type: 'dive' | 'course'; id: string }>()
  const [event, setEvent] = useState<AppEvent | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!type || !id) return
    let cancelled = false
    ;(async () => {
      const eventMap = await fetchEventsForBookings(
        type === 'dive' ? [id] : [],
        type === 'course' ? [id] : [],
      )
      if (cancelled) return
      setEvent(eventMap.get(id) ?? null)

      const column = type === 'dive' ? 'eo_dive_id' : 'eo_course_id'
      const { data: bookings } = await supabase
        .from('bookings')
        .select('*')
        .eq(column, id)
        .neq('status', 'cancelled')
        .order('created_at')

      if (cancelled) return
      if (!bookings?.length) { setRows([]); setLoading(false); return }

      const userIds = [...new Set(bookings.map(b => b.user_id))]
      const { data: profs } = await supabase.from('profiles').select('*').in('id', userIds)
      const profMap = new Map((profs ?? []).map(p => [p.id, p]))

      setRows(bookings.map(b => ({ booking: b, profile: profMap.get(b.user_id) ?? null })))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [type, id])

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to={`/admin/events/${type}/${id}`} className="text-sm text-slate-400 hover:text-slate-100">
        ‹ back to event
      </Link>

      <header className="bg-slate-800 rounded-xl p-4">
        <h1 className="text-xl font-bold text-slate-100">Gear map</h1>
        {event && (
          <p className="text-sm text-slate-400 mt-1">
            {event.title} · {formatEventSpan(event, { style: 'compact' })}
          </p>
        )}
        <p className="text-sm text-amber-400 mt-2">
          {rows.length} diver{rows.length === 1 ? '' : 's'} · {rows.filter(r => packList(r.booking).items.length > 0).length} to pack
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-slate-500 text-sm">No registrants yet.</p>
      ) : (
        <section className="space-y-3">
          {rows.map(r => <DiverGearCard key={r.booking.id} row={r} />)}
        </section>
      )}
    </div>
  )
}

function DiverGearCard({ row }: { row: Row }) {
  const { profile, booking } = row
  const pack = packList(booking)
  const owned = new Set(profile?.gear_owned ?? [])
  const shoeLabel = profile?.shoe_size ? (shoeAsJp(profile.shoe_size) ?? profile.shoe_size) : null
  const sizing = [
    profile?.height_cm && `${profile.height_cm}cm`,
    profile?.weight_kg && `${profile.weight_kg}kg`,
    shoeLabel,
  ].filter(Boolean).join(' · ')

  return (
    <article className="bg-slate-800 rounded-xl p-4 space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            {profile?.display_name || profile?.full_name || '(unknown)'}
          </h2>
          {sizing && <p className="text-xs text-slate-400">{sizing}</p>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
          pack.items.length > 0 ? 'bg-amber-700 text-amber-100' : 'bg-slate-700 text-slate-300'
        }`}>
          {pack.summary}
        </span>
      </header>

      {pack.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pack.items.map(item => (
            <span
              key={item}
              className={`text-xs px-2 py-0.5 rounded-full border ${
                owned.has(item)
                  ? 'border-emerald-700 text-emerald-300 line-through'
                  : 'border-sky-700 text-sky-200'
              }`}
              title={owned.has(item) ? 'Diver owns this item' : 'Needs packing'}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      <AdminNotes target={{ kind: 'booking', id: booking.id }} tagFilter="gear" title="Gear flags" />
    </article>
  )
}
