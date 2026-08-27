import {
  latticeId, snapToLattice, LATTICE_SPACING_M,
  type DiveSiteMap, type Vec2,
} from './dive-site-map'
import { BASE_DEPTH_M } from './site-seeds'

// The handles a diver grabs, one per metre of seabed.
//
// The surface is a triangulation of measured points, so on an unmeasured site
// there is nothing on screen to take hold of — which is why the editor used to
// work the other way round: type a depth into a box, then tap to stamp it.
// A field of handles turns that into what it should be: the seabed starts flat
// and you pull the bits that are wrong.
//
// ONE METRE APART, and the figure is stated wherever the field is drawn. That
// is the resolution the whole model is built on: LATTICE_SPACING_M is 1 m, ids
// are derived from the coordinate, and two divers who measure the same square
// metre are correcting one another rather than stacking readings. A field drawn
// at any other spacing would quietly redefine what a reading means.
//
// Which is why a site is not a 500 m canvas. At 1 m a 500 m square is 250,000
// handles — undrawable — so the old field was thinned to about 18 m and the
// spacing stopped meaning anything. A site instead starts as one small patch at
// true resolution and is EXTENDED in the direction the diver actually swam.
// `SITE_EXTENT_M`'s own reasoning already pointed here: "the wider the field,
// the fewer meters per screen pixel, and the harder it is to tap the meter you
// meant".

/** One press of Extend: a 20 m strip, which is about a minute of swimming. */
export const PATCH_M = 20

/** Handles drawn before the field has to be thinned. A Points cloud makes
 *  thousands cheap; past this the dots merge into a haze and the frame rate
 *  goes with them. */
export const HANDLES_MAX = 12_000

export interface GridHandle {
  /** The lattice id, so a pull becomes a correction of whatever is there. */
  id: string
  at: Vec2
  depth_m: number
  /** Somebody measured this position. Scaffold handles are drawn faintly and
   *  excluded from coverage; a measured one is a reading with a name on it. */
  measured: boolean
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Patches added beyond what the readings themselves cover, per compass point. */
export interface Expansion {
  north: number
  south: number
  east: number
  west: number
}

export const NO_EXPANSION: Expansion = { north: 0, south: 0, east: 0, west: 0 }

export type Direction = keyof Expansion

export function expand(expansion: Expansion, direction: Direction, patches = 1): Expansion {
  return { ...expansion, [direction]: Math.max(0, expansion[direction] + patches) }
}

/**
 * The ground the field covers.
 *
 * The starting patch sits on the origin, and anything already measured is
 * always inside — a diver has to be able to grab their own readings, wherever
 * on the site they left them. Extending grows one edge, so a site ends up the
 * shape of the dive rather than a square with the dive in one corner.
 */
export function gridBounds(map: DiveSiteMap, expansion: Expansion = NO_EXPANSION): Bounds {
  const half = PATCH_M / 2
  const bounds: Bounds = { minX: -half, maxX: half, minY: -half, maxY: half }

  for (const s of map.soundings) {
    if (s.source === 'placeholder') continue
    const at = snapToLattice(s.at)
    bounds.minX = Math.min(bounds.minX, at.x)
    bounds.maxX = Math.max(bounds.maxX, at.x)
    bounds.minY = Math.min(bounds.minY, at.y)
    bounds.maxY = Math.max(bounds.maxY, at.y)
  }

  // North is +y, matching the compass rose the scene draws.
  bounds.maxY += expansion.north * PATCH_M
  bounds.minY -= expansion.south * PATCH_M
  bounds.maxX += expansion.east * PATCH_M
  bounds.minX -= expansion.west * PATCH_M
  return bounds
}

/**
 * Metres between drawn handles — 1 m, and only ever more when a field has grown
 * past what can be drawn.
 *
 * Reported rather than hidden so the label can state the truth. A thinned field
 * that still claimed 1 m would be telling a diver their reading lands somewhere
 * it does not.
 */
export function gridStep(bounds: Bounds, max = HANDLES_MAX): number {
  const across = (bounds.maxX - bounds.minX) / LATTICE_SPACING_M + 1
  const down = (bounds.maxY - bounds.minY) / LATTICE_SPACING_M + 1
  const step = Math.ceil(Math.sqrt((across * down) / max))
  return Math.max(LATTICE_SPACING_M, step * LATTICE_SPACING_M)
}

/**
 * Every handle: the field at its spacing, plus one for each measured point.
 *
 * The measured ones are added whatever the spacing, because a diver who
 * recorded a depth has to be able to grab that reading again. Dropping it for
 * being off a thinned field would make their own contribution uneditable by
 * them.
 */
export function editableGrid(
  map: DiveSiteMap, expansion: Expansion = NO_EXPANSION, max = HANDLES_MAX,
): GridHandle[] {
  const bounds = gridBounds(map, expansion)
  const step = gridStep(bounds, max)

  const byId = new Map<string, GridHandle>()
  for (let x = bounds.minX; x <= bounds.maxX; x += step) {
    for (let y = bounds.minY; y <= bounds.maxY; y += step) {
      const at = snapToLattice({ x, y })
      const id = latticeId(at)
      byId.set(id, { id, at, depth_m: BASE_DEPTH_M, measured: false })
    }
  }

  // Later readings win over earlier ones at the same position, matching the
  // lattice's own rule that the newest measurement of a place is the one the
  // map draws.
  for (const s of map.soundings) {
    if (s.source === 'placeholder') continue
    const at = snapToLattice(s.at)
    byId.set(latticeId(at), { id: latticeId(at), at, depth_m: s.depth_m, measured: true })
  }

  return [...byId.values()]
}

/** The handle a grab landed on, by its lattice id. */
export function handleAt(handles: readonly GridHandle[], id: string): GridHandle | null {
  return handles.find(h => h.id === id) ?? null
}
