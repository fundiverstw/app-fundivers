import { useState } from 'react'
import { personName } from '../../lib/names'
import { supabase } from '../../lib/supabase'
import { packedGearTypes } from '../../lib/logistics'
import { useToast } from '../../hooks/useToast'
import { GearFitLookup } from './GearFitLookup'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import type { Profile } from '../../types/database'
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

/**
 * A diver's fin/BCD/wetsuit sizes, editable in place (persisted via the
 * update_diver_gear_sizes RPC, which rechecks the staff role server-side), plus
 * the rental "which fits?" lookup against the shop's sizing charts for each
 * type the pack list rents.
 */
export function GearSizeEditor({ profile, packItems, gearModels, onProfilePatched }: {
  profile: Profile
  /** The booking's pack list — the packing source of truth, not gear_owned. */
  packItems: string[]
  gearModels?: GearModelWithSizes[]
  onProfilePatched: (diverId: string, patch: Partial<Profile>) => void
}) {
  const toast = useToast()
  const [finSize,     setFinSize]     = useState(profile.fin_size     ?? '')
  const [bcdSize,     setBcdSize]     = useState(profile.bcd_size     ?? '')
  const [wetsuitSize, setWetsuitSize] = useState(profile.wetsuit_size ?? '')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const dirty =
    (profile.fin_size     ?? '') !== finSize ||
    (profile.bcd_size     ?? '') !== bcdSize ||
    (profile.wetsuit_size ?? '') !== wetsuitSize

  async function save() {
    setSaving(true); setError(null)
    const patch = {
      fin_size:     finSize     || null,
      bcd_size:     bcdSize     || null,
      wetsuit_size: wetsuitSize || null,
    }
    const { error } = await supabase.rpc('update_diver_gear_sizes', { diver_id: profile.id, ...patch })
    setSaving(false)
    if (error) {
      setError(error.message)
      toast.error(gc.saveSizesFailed(error.message))
      return
    }
    onProfilePatched(profile.id, patch)
    toast.success(gc.savedSizesFor(personName(profile.name) || t.admin.family.diverFallback))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <SizeField label={gc.fin}     value={finSize}     onChange={setFinSize} />
        <SizeField label={gf.bcd}     value={bcdSize}     onChange={setBcdSize} />
        <SizeField label={gf.wetsuit} value={wetsuitSize} onChange={setWetsuitSize} />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="shrink-0 bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-xs font-semibold py-1 px-2.5 rounded-md"
        >
          {saving ? '…' : gc.save}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {gearModels && gearModels.length > 0 && (
        <GearFitLookup
          measures={{
            height_cm: profile.height_cm ?? null,
            weight_kg: profile.weight_kg ?? null,
            shoe_size: profile.shoe_size ?? null,
            gender: resolveGearGender(profile),
          }}
          models={gearModels}
          rentalTypes={packedGearTypes(packItems)}
        />
      )}
    </div>
  )
}

function SizeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0">
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
