import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { personName } from '../../lib/names'
import { supabase } from '../../lib/supabase'
import { gearPackList } from '../../lib/gear'
import { gearPieceKey, packedCount } from '../../lib/gear-packed'
import { packedGearTypes } from '../../lib/logistics'
import { shoeAsJp } from '../../lib/shoe-size'
import { useToast } from '../../hooks/useToast'
import { AdminNotes } from './AdminNotes'
import { GearFitLookup } from './GearFitLookup'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import type { Booking, Profile } from '../../types/database'
import { t } from '../../i18n'

const gc = t.admin.gearCard
const gf = t.admin.gearFit

// Route under-13s (by date of birth) to kids' gear charts; otherwise use the
// profile's gender as-is. Keeps the pure matcher free of date handling.
function resolveGearGender(profile: Profile): string | null {
  const dob = profile.date_of_birth
  if (dob) {
    // Parse the 'YYYY-MM-DD' as a LOCAL date (new Date(str) is UTC midnight),
    // so the age comparison against local "now" doesn't slip a day at the
    // timezone boundary.
    const [y, m, d] = dob.split('-').map(Number)
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      const now = new Date()
      let age = now.getFullYear() - y
      const mo = now.getMonth() - (m - 1)
      if (mo < 0 || (mo === 0 && now.getDate() < d)) age--
      if (age < 13) return 'kids'
    }
  }
  return profile.gender ?? null
}

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
 *
 * Given `packed`, every item becomes a tick and the header carries a
 * packed/not-packed chip for the whole kit — the day-of view walks these cards
 * guest by guest to answer "is this one on the van yet?". Without it the items
 * are plain labels, which is what the per-event gear map wants: that page
 * plans a trip rather than loading it, and has no day to tick against.
 */
export function DiverGearCard({
  row, onProfilePatched, linkToProfile = false, gearModels, packed, onTogglePiece, onToggleAllPacked,
}: {
  row: DiverGearRow
  onProfilePatched: (diverId: string, patch: Partial<Profile>) => void
  // When true, the diver's name links to their admin People card. Gated by the
  // caller because that page is admin-only, while this card also renders on the
  // staff-accessible gear map.
  linkToProfile?: boolean
  // The shop's gear sizing charts. When supplied, a rental "which fits?" lookup
  // is shown per gear type the diver doesn't own.
  gearModels?: GearModelWithSizes[]
  // The day's ticked pieces (`gearPieceKey`). Supplying it, with both handlers,
  // turns the pack list into the packing checklist described above.
  packed?: Set<string>
  onTogglePiece?: (bookingId: string, item: string) => void
  onToggleAllPacked?: (bookingId: string, items: string[], value: boolean) => void
}) {
  const { profile, booking } = row
  const diverName = personName(profile?.name) || gc.unknown
  const pack = gearPackList(booking)
  const toast = useToast()
  const owned = new Set(profile?.gear_owned ?? [])
  const shoeLabel = profile?.shoe_size ? (shoeAsJp(profile.shoe_size) ?? profile.shoe_size) : null
  const sizing = [
    profile?.height_cm && `${profile.height_cm}cm`,
    profile?.weight_kg && `${profile.weight_kg}kg`,
    shoeLabel,
  ].filter(Boolean).join(' · ')

  // Ticking is offered only when the caller owns the day's list and both
  // handlers came with it — a chip that looked live but dropped its taps would
  // read as "already packed" to the next person down the van.
  const ticking = !!packed && !!onTogglePiece && !!onToggleAllPacked && pack.items.length > 0
  const packedHere = packed ? packedCount(packed, booking.id, pack.items) : 0
  const allPacked = ticking && packedHere === pack.items.length

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
      toast.error(gc.saveSizesFailed(error.message))
      return
    }
    onProfilePatched(profile.id, {
      fin_size:     finSize     || null,
      bcd_size:     bcdSize     || null,
      wetsuit_size: wetsuitSize || null,
    })
    toast.success(gc.savedSizesFor(personName(profile.name) || t.admin.family.diverFallback))
  }

  return (
    <article className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-brand-900">
              {linkToProfile && profile ? (
                <Link to={`/admin/users?diver=${profile.id}`} className="hover:underline">
                  {diverName}
                </Link>
              ) : (
                diverName
              )}
            </h2>
            {/* Waitlisted divers have no confirmed seat yet — flag their card so
                their gear reads as tentative, not part of the boat's pack list. */}
            {booking.status === 'waitlisted' && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-300 font-semibold shrink-0">
                {gc.waitlisted}
              </span>
            )}
          </div>
          {sizing && <p className="text-xs text-brand-900 font-medium">{sizing}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            pack.items.length > 0 || pack.note ? 'bg-red-100 text-red-700 border border-accent' : 'bg-surface-100 text-brand-950 font-medium'
          }`}>
            {pack.summary}
          </span>
          {ticking && (
            <button
              type="button"
              onClick={() => onToggleAllPacked!(booking.id, pack.items, !allPacked)}
              aria-pressed={allPacked}
              aria-label={allPacked ? gc.unmarkAllPacked(diverName) : gc.markAllPacked(diverName)}
              className={`text-xs px-2 py-0.5 rounded-full border font-semibold transition-colors ${
                allPacked
                  ? 'border-emerald-400 bg-emerald-100 text-emerald-800'
                  : packedHere > 0
                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                    : 'border-surface-300 bg-surface-100 text-brand-950'
              }`}
            >
              {allPacked ? gc.packedAll : packedHere > 0 ? gc.packedSome(packedHere, pack.items.length) : gc.packedNone}
            </button>
          )}
        </div>
      </header>

      {pack.note && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">
          {pack.note}
        </p>
      )}

      {pack.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pack.items.map(item => {
            const isPacked = ticking && packed!.has(gearPieceKey(booking.id, item))
            // A packed piece answers "is it on the van?", which outranks both
            // "the diver owns one" and "this still needs pulling" — so the
            // green wins over the other two tones rather than layering on them.
            const chip = `text-xs px-2 py-0.5 rounded-full border ${
              isPacked
                ? 'border-emerald-400 bg-emerald-100 text-emerald-800 font-semibold'
                : owned.has(item)
                  ? 'border-brand-900/40 text-brand-950 font-medium line-through'
                  : 'border-brand-900 text-brand-900'
            }`
            const title = owned.has(item) ? gc.ownsItem : gc.needsPacking
            if (!ticking) return <span key={item} className={chip} title={title}>{item}</span>
            return (
              <button
                key={item}
                type="button"
                onClick={() => onTogglePiece!(booking.id, item)}
                aria-pressed={isPacked}
                aria-label={isPacked ? gc.unmarkItemPacked(diverName, item) : gc.markItemPacked(diverName, item)}
                title={title}
                className={`${chip} transition-colors hover:border-emerald-500`}
              >
                {isPacked ? `${item} ✓` : item}
              </button>
            )
          })}
        </div>
      )}

      {profile && (
        <div className="border-t border-surface-200 pt-2 space-y-2">
          <div className="flex items-end gap-2">
            <SizeField label={gc.fin}      value={finSize}     onChange={setFinSize} />
            <SizeField label={gf.bcd}      value={bcdSize}     onChange={setBcdSize} />
            <SizeField label={gf.wetsuit}  value={wetsuitSize} onChange={setWetsuitSize} />
            <button
              type="button"
              onClick={saveSizes}
              disabled={!sizesDirty || savingSizes}
              className="shrink-0 bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-xs font-semibold py-1 px-2.5 rounded-md"
            >
              {savingSizes ? '…' : gc.save}
            </button>
          </div>
          {sizeError && <span className="text-xs text-red-600">{sizeError}</span>}
          {gearModels && gearModels.length > 0 && (
            <GearFitLookup
              measures={{
                height_cm: profile.height_cm ?? null,
                weight_kg: profile.weight_kg ?? null,
                shoe_size: profile.shoe_size ?? null,
                gender: resolveGearGender(profile),
              }}
              models={gearModels}
              // Rentals come from the booking's pack list (the packing source of
              // truth), not profile.gear_owned.
              rentalTypes={packedGearTypes(pack.items)}
            />
          )}
        </div>
      )}

      <AdminNotes target={{ kind: 'booking', id: booking.id }} tagFilter="gear" title={gc.gearFlags} compact />
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
