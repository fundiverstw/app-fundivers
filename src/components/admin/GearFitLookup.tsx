import { useState } from 'react'
import { matchGear, fitSizeLabel, type GearModelWithSizes, type DiverMeasures, type GearFit } from '../../lib/gear-sizing'
import { GEAR_TYPES, type GearType } from '../../types/database'
import { t } from '../../i18n'

const gf = t.admin.gearFit

// Read-only packing aid on the logistics board: tap a gear type the diver rents
// and see the shop's models/sizes that fit them, ranked (exact fits first). Pure
// display — nothing is saved. Matching lives in gear-sizing.ts.

const LABEL: Record<GearType, string> = { wetsuit: gf.wetsuit, bcd: gf.bcd, fins: gf.fins }

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
  const types = GEAR_TYPES.filter(gt => rentalTypes.includes(gt) && models.some(m => m.gear_type === gt && m.active))
  if (types.length === 0) return null

  const fits = open ? matchGear(measures, models, open) : []
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {types.map(gt => (
          <button
            key={gt}
            type="button"
            onClick={() => setOpen(open === gt ? null : gt)}
            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
              open === gt ? 'bg-brand-900 text-white border-brand-900' : 'border-brand-900/40 text-brand-900 hover:bg-brand-900/10'
            }`}
          >
            {gf.fitQuestion(LABEL[gt])}
          </button>
        ))}
      </div>
      {open && (
        <div className="bg-white/70 border border-surface-200 rounded-md p-2 space-y-1">
          {fits.length === 0 ? (
            <p className="text-xs text-brand-900/70">
              {hasMeasures(open, measures)
                ? gf.noModelStocked
                : open === 'fins' ? gf.needsShoeSize : gf.needsHeightWeight}
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
          <span className="text-emerald-700">{gf.fits}</span>
        ) : (
          <span className="text-amber-700">{fit.notes.length ? gf.closestWithNotes(fit.notes.join(', ')) : gf.closest}</span>
        )}
      </span>
    </div>
  )
}
