import { useEffect, useState } from 'react'
import { PageLoading } from '../../components/ui/Spinner'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchEventsForBookings, formatEventSpan } from '../../lib/events'
import { gearPackList } from '../../lib/gear'
import { DiverGearCard, type DiverGearRow } from '../../components/admin/DiverGearCard'
import { fetchGearModelsWithSizes } from '../../lib/gear-models'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import type { AppEvent, Profile } from '../../types/database'
import { t } from '../../i18n'

const gm = t.admin.gearMap

type Row = DiverGearRow

export function AdminGearMapPage() {
  const { id } = useParams<{ id: string }>()
  const [event, setEvent] = useState<AppEvent | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [gearModels, setGearModels] = useState<GearModelWithSizes[]>([])
  useEffect(() => {
    fetchGearModelsWithSizes().then(setGearModels).catch(() => { /* charts are optional */ })
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const eventMap = await fetchEventsForBookings([id])
      if (cancelled) return
      setEvent(eventMap.get(id) ?? null)

      const { data: bookings } = await supabase
        .from('bookings')
        .select('*')
        .eq('event_id', id)
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
  }, [id])

  // Patch one diver's profile in the rows list — used after a successful
  // gear-size save so the card's displayed values stay in sync without
  // a refetch round-trip.
  function patchProfile(diverId: string, patch: Partial<Profile>) {
    setRows(prev => prev.map(r =>
      r.profile && r.profile.id === diverId
        ? { ...r, profile: { ...r.profile, ...patch } as Profile }
        : r
    ))
  }

  if (loading) {
    return <PageLoading />
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to={`/admin/events/${id}`} className="text-sm text-white/70 hover:text-white">
        {gm.backToEvent}
      </Link>

      <header className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4">
        <h1 className="text-xl font-bold text-brand-900">{gm.title}</h1>
        {event && (
          <p className="text-sm text-brand-900 font-medium mt-1">
            {event.title} · {formatEventSpan(event, { style: 'compact' })}
          </p>
        )}
        <p className="text-sm text-red-600 mt-2">
          {gm.summary(rows.length, rows.filter(r => gearPackList(r.booking).items.length > 0).length)}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-brand-950 font-medium text-sm">{gm.noRegistrants}</p>
      ) : (
        <section className="space-y-3">
          {rows.map(r => <DiverGearCard key={r.booking.id} row={r} onProfilePatched={patchProfile} gearModels={gearModels} />)}
        </section>
      )}
    </div>
  )
}
