// The data model behind a dive-site map.
//
// Three decisions shape everything here.
//
// 1. POSITIONS ARE SITE-LOCAL METRES, not latitude/longitude. A hand-drawn
//    site map carries a scale bar and a compass rose but no coordinates, and a
//    diver contributing a sounding knows "twelve metres past the Dragon Head",
//    not their WGS84 position. So the frame is metres east/north of a site
//    origin, and georeferencing is a separate, optional transform (`SiteFrame.
//    origin`) applied when — and only when — someone has actually surveyed the
//    origin. A map with no origin is still a usable map.
//
// 2. DEPTH CARRIES ITS DATUM, AND ITS TIME. `depth_m` is metres below the
//    datum named in `datum`, positive downward (matching
//    `dive_logs.max_depth_m`). A dive computer reads depth below whatever
//    surface it is under at that moment, so a diver's contribution is
//    `instantaneous` and moves with the tide; only a reading with a known
//    `observed_at` can later be reduced to `TWCD2021`. A depth read off an
//    undated hand-drawn map can never be, and says `unknown`. Mixing datums
//    silently is how a chart ends up a metre out, so `datum` is required and
//    has no default.
//
// 3. FEATURES ARE NOT ALL 2.5D. A bathymetric grid stores one depth per
//    horizontal position and therefore cannot express an arch, an overhang or
//    a swim-through — which is exactly what divers navigate by, and the reason
//    this model exists rather than a depth raster. `VOLUMETRIC_FEATURES` names
//    the kinds that a grid could never hold.

export type Vec2 = { x: number; y: number }

/**
 * Where a depth or feature came from. Provenance travels per record, not per
 * map: one site accumulates hand-drawn origins plus diver contributions, and
 * the two must stay distinguishable forever.
 *
 * `placeholder` is not an observation at all — it is the starting scaffold a
 * new site opens with, so a diver has something to drag rather than an empty
 * canvas. It is drawn differently, excluded from coverage and contribution
 * counts, and is expected to be edited away. Giving it its own value rather
 * than dressing it up as `hand_drawn` is the whole point: nothing that nobody
 * measured may ever be counted as something somebody did.
 */
export type ObservationSource = 'hand_drawn' | 'diver' | 'survey' | 'placeholder'

/**
 * The vertical reference a depth is measured from.
 *
 *  • `instantaneous` — below the water surface at the moment of the reading.
 *    What every dive computer reports, and therefore what every diver
 *    contribution starts as. Varies with the tide.
 *  • `TWCD2021` — reduced to the national chart datum, so it is comparable
 *    with national products and with readings taken on another day.
 *  • `unknown` — the source states no datum at all, which is the usual case
 *    for an existing hand-drawn site map.
 */
export type DepthDatum = 'unknown' | 'TWCD2021' | 'instantaneous'

export interface Provenance {
  /** The person or organisation who made this observation or drawing. */
  author: string
  year?: number
  /** Free text, reproduced wherever the map is displayed. Hand-drawn sources
   *  routinely carry their own accuracy disclaimer and it must not be dropped. */
  note?: string
  /** Licence or permission status. A map may be digitised for study before it
   *  may be published, so the two states are distinct. */
  licence?: string
}

export interface Sounding {
  id: string
  at: Vec2
  /** Metres below `datum`, positive downward. */
  depth_m: number
  datum: DepthDatum
  /** When the depth was read, ISO 8601.
   *
   *  Load-bearing, not metadata: a dive computer reports depth below the
   *  surface it is under at that moment, so an `instantaneous` reading can only
   *  be reduced to a chart datum if the state of tide is known, and the state
   *  of tide can only be recovered from the time. A sounding without this is
   *  permanently stuck at `instantaneous` — which is the honest state of every
   *  depth read off an undated hand-drawn map, and the state no diver
   *  contribution should ever be left in. */
  observed_at?: string
  source: ObservationSource
  /** The submission this came in on — the equivalent of the commit a line of
   *  code arrived in. Absent on records that predate contribution tracking. */
  contribution_id?: string
  /** The scaffold point this reading replaces, when a diver corrected one of
   *  the starting grid points rather than adding a new position. */
  supersedes?: string
  /** Metres of horizontal uncertainty, when known. A hand-drawn sounding has
   *  no meaningful figure; a diver contribution positioned from a surface
   *  float does. */
  uncertainty_m?: number
}

export type FeatureKind =
  | 'rock'
  | 'slope'
  | 'wall'
  | 'sand'
  | 'formation'
  | 'boundary'
  | 'hazard'
  | 'arch'
  | 'swim_through'
  | 'overhang'
  | 'cave'

/** The kinds a depth grid structurally cannot represent, whatever its
 *  resolution — the reason this model is not a raster. */
export const VOLUMETRIC_FEATURES: readonly FeatureKind[] = [
  'arch', 'swim_through', 'overhang', 'cave',
]

export function isVolumetric(kind: FeatureKind): boolean {
  return VOLUMETRIC_FEATURES.includes(kind)
}

export type Geometry =
  | { shape: 'point'; at: Vec2 }
  | { shape: 'path'; points: Vec2[] }
  | { shape: 'area'; points: Vec2[] }

export interface SiteFeature {
  id: string
  kind: FeatureKind
  geometry: Geometry
  /** Shown as drawn. Site features carry local names ("龍頭", "Dragon Head")
   *  that are user-generated content and are never translated. */
  label?: string
  source: ObservationSource
  /** The submission this came in on. See `Sounding.contribution_id`. */
  contribution_id?: string
}

/** A heading a diver follows between two points, as drawn on the source map. */
export interface RouteBearing {
  id: string
  from: Vec2
  /** Degrees true, 0–359. */
  degrees: number
  /** Metres, when the source implies a distance. */
  distance_m?: number
  label?: string
}

export interface EntryPoint {
  id: string
  at: Vec2
  label?: string
}

export interface SiteFrame {
  /** WGS84 position of local (0, 0), when the site has been georeferenced.
   *  Absent means the map is internally consistent but not placed on Earth. */
  origin?: { lat: number; lng: number }
  /** Degrees the local +y axis is rotated east of true north. 0 = +y is north. */
  rotationDeg?: number
}

export interface DiveSiteMap {
  id: string
  /** How far the site extends from its origin, in metres, when nothing has
   *  been recorded yet. Gives an empty site a canvas without inventing data. */
  extent_m?: number
  /** Local name as the shop uses it, plus an optional romanisation. Both are
   *  user-generated content. */
  name: string
  name_en?: string
  frame: SiteFrame
  provenance: Provenance
  soundings: Sounding[]
  features: SiteFeature[]
  bearings: RouteBearing[]
  entries: EntryPoint[]
}

// ── The editing lattice ────────────────────────────────────────────
//
// Divers correct depths on a 1 m lattice. The lattice is IMPLICIT: no record
// exists for a position until somebody puts a reading there.
//
// Storing it would not work. A site a kilometre across at 1 m spacing is over
// a million positions; as rows they are a million writes of nothing, as meshes
// a million draw calls, and as input to a triangulation a multi-second stall on
// a phone. Implied, the same lattice costs nothing at rest — only the part on
// screen is ever drawn, and only corrected points are ever stored.
//
// The id is derived from the coordinate, so two divers correcting the same
// position produce the same id and can be reconciled rather than duplicated.

export const LATTICE_SPACING_M = 1

/** The lattice position a tap belongs to. */
export function snapToLattice(at: Vec2, spacing_m = LATTICE_SPACING_M): Vec2 {
  return {
    x: Math.round(at.x / spacing_m) * spacing_m,
    y: Math.round(at.y / spacing_m) * spacing_m,
  }
}

/** Stable id for a lattice position — the same coordinate always yields the
 *  same id, whoever taps it and whenever. */
export function latticeId(at: Vec2, spacing_m = LATTICE_SPACING_M): string {
  const p = snapToLattice(at, spacing_m)
  return `lat:${p.x}:${p.y}`
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function pointsOf(map: DiveSiteMap): Vec2[] {
  const out: Vec2[] = [
    ...map.soundings.map(s => s.at),
    ...map.entries.map(e => e.at),
    ...map.bearings.map(b => b.from),
  ]
  for (const f of map.features) {
    if (f.geometry.shape === 'point') out.push(f.geometry.at)
    else out.push(...f.geometry.points)
  }
  return out
}

/** The extent of everything on the map, in site-local metres. Returns null for
 *  an empty map so the caller renders an empty state rather than a degenerate
 *  viewBox, which SVG draws as a single stretched pixel. */
export function boundsOf(map: DiveSiteMap): Bounds | null {
  const points = pointsOf(map)
  if (!points.length) return null
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/**
 * SVG viewBox for the map, padded, with the y axis flipped so that north is up.
 *
 * SVG's y grows downward and the site frame's y grows north, so a map rendered
 * without the flip comes out mirrored — legible enough to pass a glance and
 * wrong in the one way a navigation aid must never be.
 */
export function viewBoxFor(bounds: Bounds, padding_m = 10): string {
  const w = bounds.maxX - bounds.minX + padding_m * 2
  const h = bounds.maxY - bounds.minY + padding_m * 2
  const x = bounds.minX - padding_m
  const y = -(bounds.maxY + padding_m)
  return `${x} ${y} ${Math.max(w, 1)} ${Math.max(h, 1)}`
}

/** Flip a site-local point into SVG space (north up). */
export function toSvg(p: Vec2): Vec2 {
  return { x: p.x, y: -p.y }
}

export function pathData(points: Vec2[], close = false): string {
  if (!points.length) return ''
  const [head, ...rest] = points.map(toSvg)
  const d = `M ${head.x} ${head.y}` + rest.map(p => ` L ${p.x} ${p.y}`).join('')
  return close ? `${d} Z` : d
}

/** Where a bearing arrow ends, given its heading in degrees true.
 *  0° is north (+y), 90° east (+x) — compass convention, not trigonometric. */
export function bearingEnd(from: Vec2, degrees: number, length_m: number): Vec2 {
  const rad = (degrees * Math.PI) / 180
  return {
    x: from.x + Math.sin(rad) * length_m,
    y: from.y + Math.cos(rad) * length_m,
  }
}

/** A round scale-bar length that fits comfortably inside the map's width. */
export function scaleBarMetres(bounds: Bounds): number {
  const width = bounds.maxX - bounds.minX
  const candidates = [5, 10, 20, 25, 50, 100, 200, 500]
  const target = width / 4
  return candidates.filter(c => c <= target).pop() ?? candidates[0]
}

/** Depths render the way divers write them: a leading minus. */
export function depthLabel(depth_m: number): string {
  return `-${Math.round(depth_m)}m`
}

/** True when every sounding shares one datum, so the map can state it once
 *  instead of per point. A map mixing datums must say so loudly. */
export function singleDatum(map: DiveSiteMap): DepthDatum | null {
  if (!map.soundings.length) return null
  const first = map.soundings[0].datum
  return map.soundings.every(s => s.datum === first) ? first : null
}

/** Counts by provenance, for the contribution figures the study reports. */
export function countsBySource(map: DiveSiteMap): Record<ObservationSource, number> {
  const counts: Record<ObservationSource, number> = { hand_drawn: 0, diver: 0, survey: 0, placeholder: 0 }
  for (const s of map.soundings) counts[s.source] += 1
  for (const f of map.features) counts[f.source] += 1
  return counts
}

/**
 * Whether a sounding could still be reduced to a chart datum.
 *
 * Only an instantaneous reading with a known time can be: the tide at that
 * moment is what stands between "24 m under me" and "24 m below chart datum".
 * An undated reading never can be, however carefully it was taken.
 */
export function canReduceToDatum(s: Sounding): boolean {
  return s.datum === 'instantaneous' && !!s.observed_at
}

/** Soundings that are stuck at their as-read depth forever, because nothing
 *  records when they were taken. Surfaced so a site can show how much of its
 *  data can never be brought onto a common datum. */
export function unreducibleSoundings(map: DiveSiteMap): Sounding[] {
  return map.soundings.filter(s => s.datum !== 'TWCD2021' && !canReduceToDatum(s))
}

/** True when a record is real observation rather than starting scaffold. */
export function isObserved(source: ObservationSource): boolean {
  return source !== 'placeholder'
}

/** What the site actually knows, with the scaffold stripped out — the figure
 *  the study reports and the one a diver should judge coverage by. */
export function observedOnly(map: DiveSiteMap): DiveSiteMap {
  return {
    ...map,
    soundings: map.soundings.filter(s => isObserved(s.source)),
    features: map.features.filter(f => isObserved(f.source)),
  }
}
