import { useState, type ReactNode } from 'react'
import { personName } from '../../lib/names'
import { supabase } from '../../lib/supabase'
import { gearPackList } from '../../lib/gear'
import { shoeAsJp } from '../../lib/shoe-size'
import { useToast } from '../../hooks/useToast'
import { AdminNotes } from './AdminNotes'
import type { Booking, Profile } from '../../types/database'

export interface DiverGearRow {
  booking: Booking
  profile: Profile | null
}

/**
 * One diver's gear card: what to pack (from the booking-time selection),
 * sizing, an inline fin/BCD/wetsuit size editor (persisted via the
 * update_diver_gear_sizes RPC), and the gear-tagged admin notes. Shared by the
 * per-event gear map and the day-of Logistics view. Both surfaces are gated by
 * StaffOrAdminRoute and the RPC rechecks the role server-side.
 */
export function DiverGearCard({
  row, onProfilePatched,
}: {
  row: DiverGearRow
  onProfilePatched: (diverId: string, patch: Partial<Profile>) => void
}) {
  const { profile, booking } = row
  const pack = gearPackList(booking)
  const toast = useToast()
  const owned = new Set(profile?.gear_owned ?? [])
  const shoeLabel = profile?.shoe_size ? (shoeAsJp(profile.shoe_size) ?? profile.shoe_size) : null
  const sizing = [
    profile?.height_cm && `${profile.height_cm}cm`,
    profile?.weight_kg && `${profile.weight_kg}kg`,
    shoeLabel,
  ].filter(Boolean).join(' · ')

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
    if (error) {
      setSizeError(error.message)
      toast.error(`Could not save sizes: ${error.message}`)
      return
    }
    onProfilePatched(profile.id, {
      fin_size:     finSize     || null,
      bcd_size:     bcdSize     || null,
      wetsuit_size: wetsuitSize || null,
    })
    toast.success(`Saved sizes for ${personName(profile.name, profile.nickname) || 'diver'}`)
  }

  return (
    <article className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-900">
            {personName(profile?.name, profile?.nickname) || '(unknown)'}
          </h2>
          {sizing && <p className="text-xs text-brand-900 font-medium">{sizing}</p>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
          pack.items.length > 0 || pack.note ? 'bg-red-100 text-red-700 border border-accent' : 'bg-surface-100 text-brand-950 font-medium'
        }`}>
          {pack.summary}
        </span>
      </header>

      {pack.note && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">
          {pack.note}
        </p>
      )}

      {pack.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pack.items.map(item => (
            <span
              key={item}
              className={`text-xs px-2 py-0.5 rounded-full border ${
                owned.has(item)
                  ? 'border-brand-900/40 text-brand-950 font-medium line-through'
                  : 'border-brand-900 text-brand-900'
              }`}
              title={owned.has(item) ? 'Diver owns this item' : 'Needs packing'}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {profile && (
        <div className="border-t border-surface-200 pt-2 space-y-2">
          <div className="flex items-end gap-2">
            <SizeField label="Fin"     value={finSize}     onChange={setFinSize} />
            <SizeField label="BCD"     value={bcdSize}     onChange={setBcdSize} />
            <SizeField label="Wetsuit" value={wetsuitSize} onChange={setWetsuitSize} />
            <button
              type="button"
              onClick={saveSizes}
              disabled={!sizesDirty || savingSizes}
              className="shrink-0 bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-xs font-semibold py-1 px-2.5 rounded-md"
            >
              {savingSizes ? '…' : 'Save'}
            </button>
          </div>
          {sizeError && <span className="text-xs text-red-600">{sizeError}</span>}
        </div>
      )}

      <AdminNotes target={{ kind: 'booking', id: booking.id }} tagFilter="gear" title="Gear flags" compact />
    </article>
  )
}

function SizeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): ReactNode {
  return (
    <label className="block">
      <span className="block text-[10px] text-brand-900 font-medium mb-0.5 uppercase tracking-wide">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-white border border-surface-300 rounded-md px-2 py-1 text-brand-900 text-xs focus:outline-none focus:border-brand-900"
        placeholder="—"
      />
    </label>
  )
}
