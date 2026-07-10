// Gear sizing match — given a diver's body measurements and the shop's sizing
// charts, rank which models/sizes fit. Used read-only on the logistics board so
// staff can see what to pack. Pure and side-effect-free so it's easy to test.
//
// Matching is deliberately TOLERANT: real divers fall between sizes (their
// height points to one size, their weight to another), so a strict "must be in
// every range" rule would return nothing exactly when help is wanted. Instead we
// score every size by how far outside its ranges the diver sits and rank the
// nearest — but a size is only called an "exact" fit when the diver is confirmed
// in-range on every axis the gear type expects.

import { parseShoeSize, convertShoeSize, type ShoeUnit } from './shoe-size'
import type { GearModel, GearModelSize, GearType } from '../types/database'
import { t } from '../i18n'

export interface GearModelWithSizes extends GearModel {
  sizes: GearModelSize[]
}

export interface DiverMeasures {
  height_cm: number | null
  weight_kg: number | null
  shoe_size: string | null
  /** 'female' | 'male' | 'kids' | free text | null. The caller resolves minors
   *  to 'kids' (from date of birth) before passing this in. */
  gender: string | null
}

export interface GearFit {
  model: GearModel
  /** The best-fitting size on this model. */
  size: GearModelSize
  fit: 'exact' | 'closest'
  /** 0 = every expected axis in range; higher = further out (unit-normalized). */
  score: number
  /** The adjacent size when the diver sits between two — drives "between X and Y". */
  between?: GearModelSize
  /** Human notes on the best size's misses, e.g. ["weight 3kg over"]. Empty when exact. */
  notes: string[]
}

// Axes the matcher expects for each gear type — a fit is only "exact" when the
// diver is confirmed in-range on ALL of them, so a chart that leaves an axis
// blank (or a diver missing a measurement) can't read as a false exact fit.
const EXPECTED_AXES: Record<GearType, readonly string[]> = {
  wetsuit: ['height', 'weight'],
  bcd: ['weight'],
  fins: ['shoe'],
}

// Per-axis scale so distances on unlike axes (cm vs kg vs shoe sizes) are
// commensurable when summed — roughly "one size band" per unit.
const AXIS_SCALE: Record<string, number> = { height: 5, weight: 6, shoe: 1.5 }

const round1 = (x: number) => Math.round(x * 10) / 10

type Dir = 'in' | 'under' | 'over'

// How far `value` sits outside [min, max] and which way; 0/'in' when inside.
// Open-ended when a bound is null. Returns null when the axis isn't populated.
function compareAxis(value: number, min: number | null, max: number | null): { distance: number; dir: Dir } | null {
  if (min == null && max == null) return null
  if (min != null && value < min) return { distance: min - value, dir: 'under' }
  if (max != null && value > max) return { distance: value - max, dir: 'over' }
  return { distance: 0, dir: 'in' }
}

function normalizeGender(g: string | null): 'female' | 'male' | 'kids' | null {
  const s = (g ?? '').trim().toLowerCase()
  if (s === 'female' || s === 'f' || s === 'woman' || s === 'women') return 'female'
  if (s === 'male' || s === 'm' || s === 'man' || s === 'men') return 'male'
  if (s === 'kids' || s === 'kid' || s === 'child' || s === 'children') return 'kids'
  return null
}

// Unisex models apply to everyone; a kids' model only to a resolved kid; an
// unknown-gender diver sees adult (non-kids) models. Otherwise gender must match.
function modelAppliesToGender(modelGender: string | null, diverGender: 'female' | 'male' | 'kids' | null): boolean {
  if (!modelGender) return true
  if (diverGender === null) return modelGender !== 'kids'
  return modelGender === diverGender
}

// The diver's shoe size expressed in the fins model's unit (defaults to JP).
// Uses the gender tagged on the stored shoe string when present, else the
// diver's own gender — so cross-unit conversion doesn't silently assume men's.
function diverShoeIn(unit: string | null, rawShoe: string | null, diverGender: string | null): number | null {
  const parsed = parseShoeSize(rawShoe)
  if (!parsed) return null
  const explicit = /[mf]\s*$/i.test((rawShoe ?? '').trim())
  const g: 'm' | 'f' = explicit ? parsed.gender : (normalizeGender(diverGender) === 'female' ? 'f' : 'm')
  return convertShoeSize(parsed.value, parsed.unit, (unit ?? 'jp') as ShoeUnit, g)
}

interface AxisResult { key: string; label: string; unit: string; distance: number; dir: Dir; norm: number }

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
    axes.push({ key, label, unit, distance: r.distance, dir: r.dir, norm: r.distance / (AXIS_SCALE[key] ?? 1) })
  }

  if (type === 'fins') {
    add('shoe', 'shoe', model.size_unit ?? 'jp', diverShoeIn(model.size_unit, measures.shoe_size, measures.gender), size.shoe_min, size.shoe_max)
  } else {
    // wetsuit + bcd match on height and/or weight (whichever the chart fills).
    add('height', 'height', 'cm', measures.height_cm, size.height_min, size.height_max)
    add('weight', 'weight', 'kg', measures.weight_kg, size.weight_min, size.weight_max)
  }

  if (axes.length === 0) return null
  const score = axes.reduce((s, a) => s + a.norm, 0)
  return { score, axes }
}

function missNotes(axes: AxisResult[]): string[] {
  return axes
    .filter(a => a.dir !== 'in')
    .map(a => `${a.label} ${round1(a.distance)}${a.unit} ${a.dir}`)
}

function primaryRange(size: GearModelSize, type: GearType): { min: number | null; max: number | null } {
  return type === 'fins'
    ? { min: size.shoe_min, max: size.shoe_max }
    : { min: size.weight_min, max: size.weight_max }
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
  const expected = EXPECTED_AXES[type]

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
    // Exact only when the diver is confirmed in-range on every EXPECTED axis —
    // a single-axis or partial match on a two-axis chart is "closest", not exact.
    const inRange = new Set(best.res.axes.filter(a => a.dir === 'in').map(a => a.key))
    const fit: 'exact' | 'closest' = expected.every(k => inRange.has(k)) ? 'exact' : 'closest'

    const notes = fit === 'exact' ? [] : missNotes(best.res.axes)
    let between: GearModelSize | undefined

    if (fit === 'closest') {
      // Bracket check on the primary axis (weight for wetsuit/bcd, shoe for
      // fins): "between X and Y" only when a stocked size sits below the diver
      // AND one sits above. Off-the-end gets an explicit note instead.
      const pVal = type === 'fins'
        ? diverShoeIn(model.size_unit, measures.shoe_size, measures.gender)
        : measures.weight_kg
      if (pVal != null) {
        // Off-the-end = below every size's min (or above every max). Otherwise
        // the diver sits within the range but no single size contains them
        // (e.g. height wants one size, weight another) — a genuine "between".
        const belowAll = scored.every(s => { const r = primaryRange(s.size, type); return r.min != null && pVal < r.min })
        const aboveAll = scored.every(s => { const r = primaryRange(s.size, type); return r.max != null && pVal > r.max })
        if (belowAll) notes.push(t.admin.gearFit.belowSmallest)
        else if (aboveAll) notes.push(t.admin.gearFit.aboveLargest)
        else between = scored[1]?.size
      }
    }

    fits.push({ model, size: best.size, fit, score: best.res.score, between, notes })
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
