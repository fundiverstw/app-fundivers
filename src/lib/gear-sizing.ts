// Gear sizing match — given a diver's body measurements and the shop's sizing
// charts, rank which models/sizes fit. Used read-only on the logistics board so
// staff can see what to pack. Pure and side-effect-free so it's easy to test.
//
// Matching is deliberately TOLERANT: real divers fall between sizes (their
// height points to one size, their weight to another), so a strict "must be in
// every range" rule would return nothing exactly when help is wanted. Instead we
// score every size by how far outside its ranges the diver sits and rank the
// nearest — flagging an exact fit vs. a between-sizes closest.

import { parseShoeSize, convertShoeSize, type ShoeUnit } from './shoe-size'
import type { GearModel, GearModelSize, GearType } from '../types/database'

export interface GearModelWithSizes extends GearModel {
  sizes: GearModelSize[]
}

export interface DiverMeasures {
  height_cm: number | null
  weight_kg: number | null
  shoe_size: string | null
  gender: string | null
}

export interface GearFit {
  model: GearModel
  /** The best-fitting size on this model. */
  size: GearModelSize
  fit: 'exact' | 'closest'
  /** 0 = every measured axis in range; higher = further out. */
  score: number
  /** The adjacent size when the diver sits between two — drives "between X and Y". */
  between?: GearModelSize
  /** Human notes on the best size's misses, e.g. ["weight 3kg over"]. Empty when exact. */
  notes: string[]
}

type Dir = 'in' | 'under' | 'over'

// How far `value` sits outside [min, max] and which way; 0/'in' when inside.
// Open-ended when a bound is null. Returns null when the axis isn't populated.
function compareAxis(value: number, min: number | null, max: number | null): { distance: number; dir: Dir } | null {
  if (min == null && max == null) return null
  if (min != null && value < min) return { distance: min - value, dir: 'under' }
  if (max != null && value > max) return { distance: value - max, dir: 'over' }
  return { distance: 0, dir: 'in' }
}

function normalizeGender(g: string | null): 'female' | 'male' | null {
  const s = (g ?? '').trim().toLowerCase()
  if (s === 'female' || s === 'f' || s === 'woman' || s === 'women') return 'female'
  if (s === 'male' || s === 'm' || s === 'man' || s === 'men') return 'male'
  return null
}

// A model is shown when it's unisex, a kids' model (self-selects by its small
// size ranges), the diver's gender, or when the diver's gender is unknown.
function modelAppliesToGender(modelGender: string | null, diverGender: 'female' | 'male' | null): boolean {
  if (!modelGender) return true
  if (modelGender === 'kids') return true
  if (!diverGender) return true
  return modelGender === diverGender
}

// The diver's shoe size expressed in the fins model's unit (defaults to JP).
function diverShoeIn(unit: string | null, rawShoe: string | null): number | null {
  const parsed = parseShoeSize(rawShoe)
  if (!parsed) return null
  return convertShoeSize(parsed.value, parsed.unit, (unit ?? 'jp') as ShoeUnit, parsed.gender)
}

interface AxisResult { key: string; label: string; unit: string; distance: number; dir: Dir }

// Score one size against the diver: the axes to compare depend on the gear type.
// Returns null when no axis could be compared (missing chart data or diver data).
function scoreSize(
  size: GearModelSize,
  measures: DiverMeasures,
  type: GearType,
  model: GearModel,
): { score: number; axes: AxisResult[] } | null {
  const axes: AxisResult[] = []
  const add = (key: string, label: string, unit: string, value: number | null, min: number | null, max: number | null) => {
    if (value == null) return
    const r = compareAxis(value, min, max)
    if (!r) return
    axes.push({ key, label, unit, distance: r.distance, dir: r.dir })
  }

  if (type === 'fins') {
    add('shoe', 'shoe', model.size_unit ?? 'jp', diverShoeIn(model.size_unit, measures.shoe_size), size.shoe_min, size.shoe_max)
  } else {
    // wetsuit + bcd match on height and weight.
    add('height', 'height', 'cm', measures.height_cm, size.height_min, size.height_max)
    add('weight', 'weight', 'kg', measures.weight_kg, size.weight_min, size.weight_max)
  }

  if (axes.length === 0) return null
  const score = axes.reduce((s, a) => s + a.distance, 0)
  return { score, axes }
}

function missNotes(axes: AxisResult[]): string[] {
  return axes
    .filter(a => a.dir !== 'in')
    .map(a => `${a.label} ${Math.round(a.distance * 10) / 10}${a.unit} ${a.dir}`)
}

/**
 * Rank the shop's models of one gear type by how well each fits the diver.
 * One entry per applicable model (its best-fitting size), exact fits first.
 */
export function matchGear(
  measures: DiverMeasures,
  models: GearModelWithSizes[],
  type: GearType,
): GearFit[] {
  const diverGender = normalizeGender(measures.gender)

  const fits: GearFit[] = []
  for (const model of models) {
    if (model.gear_type !== type || !model.active) continue
    if (!modelAppliesToGender(model.gender, diverGender)) continue

    const scored = model.sizes
      .map(size => ({ size, res: scoreSize(size, measures, type, model) }))
      .filter((x): x is { size: GearModelSize; res: { score: number; axes: AxisResult[] } } => x.res != null)
      .sort((a, b) => a.res.score - b.res.score || a.size.sort_order - b.size.sort_order)

    if (scored.length === 0) continue

    const best = scored[0]
    const fit: 'exact' | 'closest' = best.res.score === 0 ? 'exact' : 'closest'
    // When the best size is a "closest", the runner-up is the size on the other
    // side — that's the "between X and Y" case worth surfacing.
    const between = fit === 'closest' && scored[1] ? scored[1].size : undefined

    fits.push({
      model,
      size: best.size,
      fit,
      score: best.res.score,
      between,
      notes: fit === 'exact' ? [] : missNotes(best.res.axes),
    })
  }

  return fits.sort((a, b) =>
    (a.fit === b.fit ? 0 : a.fit === 'exact' ? -1 : 1) ||
    a.score - b.score ||
    a.model.name.localeCompare(b.model.name),
  )
}

// "3" / "3 – 5" for the UI, ordering the two size labels naturally.
export function fitSizeLabel(fit: GearFit): string {
  if (!fit.between) return fit.size.label
  const [a, b] = [fit.size.label, fit.between.label].sort((x, y) => {
    const nx = parseFloat(x), ny = parseFloat(y)
    if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny
    return x.localeCompare(y)
  })
  return `${a} – ${b}`
}
