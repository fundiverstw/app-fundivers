import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  if (!g) return { summary: 'Own gear', items: [] }
  // Course-bundled gear (g.included) is functionally a full set the shop
  // packs — same item list, just labeled differently so the gear map
  // distinguishes "diver paid to rent" from "shop provides as part of
  // the course".
  if (g.included) return { summary: 'Included with course', items: [...GEAR_ITEMS] }
  if (!g.rent) return { summary: 'Own gear', items: [] }
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
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to={`/admin/events/${type}/${id}`} className="text-sm text-white/70 hover:text-white">
        ‹ back to event
      </Link>

      <header className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4">
        <h1 className="text-xl font-bold text-blue-900">Gear map</h1>
        {event && (
          <p className="text-sm text-blue-900 font-medium mt-1">
            {event.title} · {formatEventSpan(event, { style: 'compact' })}
          </p>
        )}
        <p className="text-sm text-red-600 mt-2">
          {rows.length} diver{rows.length === 1 ? '' : 's'} · {rows.filter(r => packList(r.booking).items.length > 0).length} to pack
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-blue-950 font-medium text-sm">No registrants yet.</p>
      ) : (
        <section className="space-y-3">
          {rows.map(r => <DiverGearCard key={r.booking.id} row={r} onProfilePatched={patchProfile} />)}
        </section>
      )}
    </div>
  )
}

function DiverGearCard({ row, onProfilePatched }: { row: Row; onProfilePatched: (diverId: string, patch: Partial<Profile>) => void }) {
  const { profile, booking } = row
  const pack = packList(booking)
  const owned = new Set(profile?.gear_owned ?? [])
  const shoeLabel = profile?.shoe_size ? (shoeAsJp(profile.shoe_size) ?? profile.shoe_size) : null
  const sizing = [
    profile?.height_cm && `${profile.height_cm}cm`,
    profile?.weight_kg && `${profile.weight_kg}kg`,
    shoeLabel,
  ].filter(Boolean).join(' · ')

  // Inline gear-size editor — staff/admin only (the page itself is gated
  // by StaffOrAdminRoute, and the RPC server-side rechecks the role). The
  // three inputs always reflect the saved profile values; when any field
  // is dirty the Save button activates and a single RPC call persists
  // the new values for the diver.
  const [finSize,     setFinSize]     = useState(profile?.fin_size     ?? '')
  const [bcdSize,     setBcdSize]     = useState(profile?.bcd_size     ?? '')
  const [wetsuitSize, setWetsuitSize] = useState(profile?.wetsuit_size ?? '')
  const [savingSizes, setSavingSizes] = useState(false)
  const [sizeError,   setSizeError]   = useState<string | null>(null)
  const sizesDirty =
    (profile?.fin_size     ?? '') !== finSize ||
    (profile?.bcd_size     ?? '') !== bcdSize ||
    (profile?.wetsuit_size ?? '') !== wetsuitSize

  async function saveSizes() {
    if (!profile) return
    setSavingSizes(true); setSizeError(null)
    const { error } = await supabase.rpc('update_diver_gear_sizes', {
      diver_id:     profile.id,
      fin_size:     finSize     || null,
      bcd_size:     bcdSize     || null,
      wetsuit_size: wetsuitSize || null,
    })
    setSavingSizes(false)
    if (error) { setSizeError(error.message); return }
    onProfilePatched(profile.id, {
      fin_size:     finSize     || null,
      bcd_size:     bcdSize     || null,
      wetsuit_size: wetsuitSize || null,
    })
  }

  return (
    <article className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-blue-900">
            {profile?.display_name || profile?.full_name || '(unknown)'}
          </h2>
          {sizing && <p className="text-xs text-blue-900 font-medium">{sizing}</p>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
          pack.items.length > 0 ? 'bg-red-100 text-red-700 border border-red-500' : 'bg-sky-100 text-blue-950 font-medium'
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
                  ? 'border-blue-900/40 text-blue-950 font-medium line-through'
                  : 'border-blue-900 text-blue-900'
              }`}
              title={owned.has(item) ? 'Diver owns this item' : 'Needs packing'}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {profile && (
        <div className="border-t border-sky-200 pt-3 space-y-2">
          <p className="text-xs font-semibold text-blue-900 uppercase tracking-wider">Sizes</p>
          <div className="grid grid-cols-3 gap-2">
            <SizeField label="Fin"     value={finSize}     onChange={setFinSize} />
            <SizeField label="BCD"     value={bcdSize}     onChange={setBcdSize} />
            <SizeField label="Wetsuit" value={wetsuitSize} onChange={setWetsuitSize} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveSizes}
              disabled={!sizesDirty || savingSizes}
              className="bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white text-xs font-semibold py-1.5 px-3 rounded-md"
            >
              {savingSizes ? 'Saving…' : 'Save sizes'}
            </button>
            {sizeError && <span className="text-xs text-red-600">{sizeError}</span>}
          </div>
        </div>
      )}

      <AdminNotes target={{ kind: 'booking', id: booking.id }} tagFilter="gear" title="Gear flags" />
    </article>
  )
}

function SizeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): ReactNode {
  return (
    <label className="block">
      <span className="block text-[10px] text-blue-900 font-medium mb-0.5 uppercase tracking-wide">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-white border border-sky-300 rounded-md px-2 py-1 text-blue-900 text-xs focus:outline-none focus:border-blue-900"
        placeholder="—"
      />
    </label>
  )
}
