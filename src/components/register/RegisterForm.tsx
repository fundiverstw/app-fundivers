import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import type { AppEvent, BookingDetails, EOAddon, EORoom, Profile } from '../../types/database'

interface Props {
  event: AppEvent
  profile: Profile | null
  userId: string
  onClose: () => void
  onBooked: (booking: unknown) => void
}

const GEAR_ITEMS = ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots']
const GEAR_ALACARTE_PRICES: Record<string, number> = {
  BCD: 450, Regulator: 500, Wetsuit: 200, Fins: 100, Mask: 100, Boots: 100,
}
const GEAR_FULLSET_DAILY = 1500
const NITROX_COURSE_FEE = 6000
const TRANSPORT_FEE = 1300

type Step = 1 | 2 | 3

export function RegisterForm({ event, profile, userId, onClose, onBooked }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [rooms, setRooms] = useState<EORoom[]>([])
  const [addons, setAddons] = useState<EOAddon[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Form state
  const [rentGear, setRentGear] = useState(false)
  const [gearMode, setGearMode] = useState<'full' | 'a-la-carte' | 'provided'>('full')
  const [gearItems, setGearItems] = useState<string[]>([])
  const [roomId, setRoomId] = useState<string>('')
  const [roomNotes, setRoomNotes] = useState('')
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set())
  const [needsTransport, setNeedsTransport] = useState(false)
  const [addNitroxCourse, setAddNitroxCourse] = useState(false)
  const [payment, setPayment] = useState<'bank_transfer' | 'credit_card' | 'cash'>('bank_transfer')
  const [notes, setNotes] = useState('')

  // Assume one dive-day for gear full-set calc; real engine lives in Wix import
  const diveDays = 1

  useEffect(() => {
    ;(async () => {
      const [roomsRes, addonsRes] = await Promise.all([
        supabase.from('EO_rooms' as never).select('_id, title, display_name, added_price, currency'),
        supabase.from('Other_Addons' as never).select('_id, title, display_name, price, currency'),
      ])
      setRooms((roomsRes.data ?? []) as EORoom[])
      setAddons((addonsRes.data ?? []) as EOAddon[])
    })()
  }, [])

  const gearCost = useMemo(() => {
    if (!rentGear) return 0
    if (gearMode === 'full') return GEAR_FULLSET_DAILY * diveDays
    if (gearMode === 'a-la-carte') return gearItems.reduce((s, item) => s + (GEAR_ALACARTE_PRICES[item] ?? 0) * diveDays, 0)
    return 0
  }, [rentGear, gearMode, gearItems])

  const roomCost = useMemo(() => rooms.find(r => r._id === roomId)?.added_price ?? 0, [rooms, roomId])
  const addonsCost = useMemo(() => {
    let total = 0
    for (const a of addons) if (addonIds.has(a._id)) total += a.price ?? 0
    return total
  }, [addons, addonIds])
  const paymentSurcharge = payment === 'credit_card' ? 0.05 : 0
  const base = event.price ?? 0
  const subTotal = base + gearCost + roomCost + addonsCost + (needsTransport ? TRANSPORT_FEE : 0) + (addNitroxCourse ? NITROX_COURSE_FEE : 0)
  const total = Math.round(subTotal * (1 + paymentSurcharge))

  function toggleItem(item: string) {
    setGearItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])
  }
  function toggleAddon(id: string) {
    setAddonIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function submit() {
    setSaving(true); setErr('')
    const details: BookingDetails = {
      gear: rentGear
        ? {
            rent: true,
            mode: gearMode,
            items: gearMode === 'a-la-carte' ? gearItems : undefined,
            size_overrides: {
              height_cm: profile?.height_cm ?? null,
              weight_kg: profile?.weight_kg ?? null,
              shoe_size: profile?.shoe_size ?? null,
            },
          }
        : { rent: false },
      room: roomId ? { option_id: roomId, notes: roomNotes || null } : undefined,
      add_ons: [...addonIds],
      transportation: needsTransport,
      payment_method: payment,
      nitrox_course_addon: addNitroxCourse,
      total,
    }

    const fk = event.type === 'dive'
      ? { eo_dive_id: event.id, eo_course_id: null }
      : { eo_dive_id: null, eo_course_id: event.id }

    const { data, error } = await supabase
      .from('bookings')
      .insert({
        user_id: userId,
        status: 'pending',
        notes: notes || null,
        details,
        ...fk,
      })
      .select().single()

    setSaving(false)
    if (error) { setErr(error.message); return }
    if (data) onBooked(data)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 rounded-t-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Step {step} of 3</span>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </header>

        {step === 1 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-100">{event.title}</h2>
            <p className="text-sm text-slate-400">
              {format(new Date(event.start_time), 'EEEE, MMMM d · HH:mm')}
              {event.end_time && ` → ${format(new Date(event.end_time), 'MMMM d')}`}
            </p>
            <div className="text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3 space-y-1">
              <p><strong>{profile?.full_name ?? '—'}</strong></p>
              {profile?.cert_agency && profile.cert_level && (
                <p className="text-xs">{profile.cert_agency} {profile.cert_level} · {profile.logged_dives ?? 0} dives{profile.nitrox_certified && ' · Nitrox'}</p>
              )}
              {(!profile?.full_name || !profile?.cert_level) && (
                <p className="text-xs text-amber-400">Complete your profile for a faster check-in.</p>
              )}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-slate-100">Extras</h2>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={rentGear} onChange={e => setRentGear(e.target.checked)} className="accent-sky-500" />
                Rent gear
              </label>
              {rentGear && (
                <div className="pl-6 space-y-2">
                  <select
                    value={gearMode}
                    onChange={e => setGearMode(e.target.value as typeof gearMode)}
                    className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100"
                  >
                    <option value="full">Full set ({GEAR_FULLSET_DAILY.toLocaleString()}/day)</option>
                    <option value="a-la-carte">À-la-carte</option>
                    <option value="provided">Provided by shop</option>
                  </select>
                  {gearMode === 'a-la-carte' && (
                    <div className="grid grid-cols-2 gap-1">
                      {GEAR_ITEMS.map(item => (
                        <label key={item} className="flex items-center gap-1 text-xs text-slate-300">
                          <input type="checkbox" checked={gearItems.includes(item)} onChange={() => toggleItem(item)} className="accent-sky-500" />
                          {item} ({GEAR_ALACARTE_PRICES[item]})
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {rooms.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-300 font-semibold">Room (optional)</p>
                <select value={roomId} onChange={e => setRoomId(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100">
                  <option value="">— none —</option>
                  {rooms.map(r => (
                    <option key={r._id} value={r._id}>
                      {r.display_name ?? r.title} {r.added_price != null && `(+${r.added_price.toLocaleString()})`}
                    </option>
                  ))}
                </select>
                {roomId && (
                  <input value={roomNotes} onChange={e => setRoomNotes(e.target.value)} placeholder="Room notes" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100" />
                )}
              </div>
            )}

            {addons.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-300 font-semibold">Add-ons</p>
                <div className="max-h-40 overflow-y-auto grid grid-cols-1 gap-1 pr-1">
                  {addons.map(a => (
                    <label key={a._id} className="flex items-center gap-2 text-xs text-slate-300">
                      <input type="checkbox" checked={addonIds.has(a._id)} onChange={() => toggleAddon(a._id)} className="accent-sky-500" />
                      <span className="flex-1">{a.display_name ?? a.title}</span>
                      {a.price != null && <span className="text-slate-400">+{a.price.toLocaleString()}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={needsTransport} onChange={e => setNeedsTransport(e.target.checked)} className="accent-sky-500" />
              Need transportation (+{TRANSPORT_FEE.toLocaleString()})
            </label>

            {!profile?.nitrox_certified && (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={addNitroxCourse} onChange={e => setAddNitroxCourse(e.target.checked)} className="accent-sky-500" />
                Add Nitrox course (+{NITROX_COURSE_FEE.toLocaleString()})
              </label>
            )}

            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100" />
          </section>
        )}

        {step === 3 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-100">Payment</h2>
            <div className="space-y-1">
              {(['bank_transfer', 'credit_card', 'cash'] as const).map(method => (
                <label key={method} className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="radio" name="payment" checked={payment === method} onChange={() => setPayment(method)} className="accent-sky-500" />
                  {method === 'bank_transfer' && 'Bank transfer'}
                  {method === 'credit_card' && 'Credit card (+5%)'}
                  {method === 'cash' && 'Cash on the day'}
                </label>
              ))}
            </div>

            <div className="text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3 space-y-1">
              <Row label="Base"                value={base} currency={event.currency} />
              {gearCost > 0        && <Row label="Gear"           value={gearCost}     currency={event.currency} />}
              {roomCost > 0        && <Row label="Room"           value={roomCost}     currency={event.currency} />}
              {addonsCost > 0      && <Row label="Add-ons"        value={addonsCost}   currency={event.currency} />}
              {needsTransport      && <Row label="Transport"      value={TRANSPORT_FEE} currency={event.currency} />}
              {addNitroxCourse     && <Row label="Nitrox course"  value={NITROX_COURSE_FEE} currency={event.currency} />}
              {paymentSurcharge > 0 && <Row label="Credit surcharge (5%)" value={total - subTotal} currency={event.currency} />}
              <div className="border-t border-slate-700 pt-1 mt-1">
                <Row label="Total" value={total} currency={event.currency} bold />
              </div>
            </div>
            {err && <p className="text-rose-400 text-sm">{err}</p>}
          </section>
        )}

        <footer className="flex items-center justify-between gap-2 pt-2">
          <button onClick={() => step > 1 && setStep((step - 1) as Step)} disabled={step === 1}
            className="text-sm text-slate-400 hover:text-slate-100 disabled:opacity-40">‹ Back</button>
          {step < 3 ? (
            <button onClick={() => setStep((step + 1) as Step)}
              className="bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold py-2 px-4 rounded-lg">Next ›</button>
          ) : (
            <button onClick={submit} disabled={saving}
              className="bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-sm font-semibold py-2 px-4 rounded-lg">
              {saving ? 'Booking…' : 'Confirm booking'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function Row({ label, value, currency, bold = false }: { label: string; value: number; currency: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold text-slate-100' : ''}`}>
      <span>{label}</span>
      <span>{currency} {value.toLocaleString()}</span>
    </div>
  )
}
