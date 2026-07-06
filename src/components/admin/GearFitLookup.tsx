import { useState } from 'react'
import { matchGear, fitSizeLabel, type GearModelWithSizes, type DiverMeasures, type GearFit } from '../../lib/gear-sizing'
import { GEAR_TYPES, type GearType } from '../../types/database'

// Read-only packing aid on the logistics board: tap a gear type the diver rents
// and see the shop's models/sizes that fit them, ranked (exact fits first). Pure
// display — nothing is saved. Matching lives in gear-sizing.ts.

const LABEL: Record<GearType, string> = { wetsuit: 'Wetsuit', bcd: 'BCD', fins: 'Fins' }

// Does the diver carry the measurements this gear type matches on? Mirrors the
// matcher's expected axes (BCD is weight-only), so the empty state tells
// "profile incomplete" apart from "no model fits this diver".
function hasMeasures(type: GearType, m: DiverMeasures): boolean {
  if (type === 'fins') return !!m.shoe_size
  if (type === 'bcd') return m.weight_kg != null
  return m.height_cm != null && m.weight_kg != null
}

export function GearFitLookup({ measures, models, rentalTypes }: {
  measures: DiverMeasures
  models: GearModelWithSizes[]
  /** Gear types the diver needs a rental for (doesn't own). */
  rentalTypes: GearType[]
}) {
  const [open, setOpen] = useState<GearType | null>(null)
  // Offer a lookup only where the diver rents AND the shop has active charts.
  const types = GEAR_TYPES.filter(t => rentalTypes.includes(t) && models.some(m => m.gear_type === t && m.active))
  if (types.length === 0) return null

  const fits = open ? matchGear(measures, models, open) : []
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {types.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setOpen(open === t ? null : t)}
            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
              open === t ? 'bg-brand-900 text-white border-brand-900' : 'border-brand-900/40 text-brand-900 hover:bg-brand-900/10'
            }`}
          >
            {LABEL[t]} fit?
          </button>
        ))}
      </div>
      {open && (
        <div className="bg-white/70 border border-surface-200 rounded-md p-2 space-y-1">
          {fits.length === 0 ? (
            <p className="text-xs text-brand-900/70">
              {hasMeasures(open, measures)
                ? 'No matching model stocked for this diver.'
                : `No match — needs ${open === 'fins' ? 'a shoe size' : 'height & weight'} on the diver's profile.`}
            </p>
          ) : (
            fits.map(f => <FitRow key={f.model.id} fit={f} />)
          )}
        </div>
      )}
    </div>
  )
}

function FitRow({ fit }: { fit: GearFit }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-brand-950 font-medium">{fit.model.name}</span>
      <span className="text-right shrink-0">
        <span className="font-semibold text-brand-900">{fitSizeLabel(fit)}</span>{' '}
        {fit.fit === 'exact' ? (
          <span className="text-emerald-700">fits</span>
        ) : (
          <span className="text-amber-700">closest{fit.notes.length ? ` · ${fit.notes.join(', ')}` : ''}</span>
        )}
      </span>
    </div>
  )
}
