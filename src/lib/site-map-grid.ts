import {
  latticeId, snapToLattice, LATTICE_SPACING_M,
  type DiveSiteMap, type Vec2,
} from './dive-site-map'
import { BASE_DEPTH_M, SITE_EXTENT_M } from './site-seeds'

// The handles a diver actually grabs.
//
// The surface is a triangulation of measured points, so on an unmeasured site
// there is nothing on screen to take hold of — which is why the old editor had
// to work the other way round: type a depth into a box, then tap the seabed to
// stamp it. Five different depths meant typing five times.
//
// A regular field of handles turns that into what it should have been: the
// seabed starts flat at BASE_DEPTH_M and you pull the bits of it that are
// wrong. That is not a new idea bolted on; `placeholder` in the data model is
// already documented as "the starting scaffold a new site opens with, so a
// diver has something to drag rather than an empty canvas", and the flat base
// exists precisely so that it reads as unmeasured.
//
// Handles are lattice positions, so their ids are derived from their
// coordinates and two divers who pull the same square metre are correcting one
// another rather than stacking readings. Nothing here is stored: a handle
// nobody has moved has no row, and pulling one is what brings it into being.

/** Drawing more than this is unreadable, and slower than it is useful. */
export const HANDLES_MAX = 900

export interface GridHandle {
  /** The lattice id, so a pull becomes a correction of whatever is there. */
  id: string
  at: Vec2
  depth_m: number
  /** Somebody measured this position. Scaffold handles are drawn faintly and
   *  excluded from coverage; a measured one is a reading with a name on it. */
  measured: boolean
}

/**
 * Spacing that keeps the field readable on a site of this size.
 *
 * Always a whole number of lattice steps, so every handle lands on a real
 * lattice position rather than between two of them — a handle at 3.5 m would
 * snap on grab and jump out from under the finger that grabbed it.
 */
export function handleSpacing(extent_m: number, max = HANDLES_MAX): number {
  const span = extent_m * 2
  const perSide = Math.max(1, Math.floor(Math.sqrt(max)) - 1)
  const raw = span / perSide
  return Math.max(LATTICE_SPACING_M, Math.ceil(raw / LATTICE_SPACING_M) * LATTICE_SPACING_M)
}

/**
 * Every handle for a site: a regular field across the canvas, plus one for
 * each measured point.
 *
 * The measured ones are added whatever the spacing, because a diver who
 * recorded a depth at 1 m resolution must be able to grab that reading again.
 * Dropping it for being off the drawn field would make their own contribution
 * uneditable by them.
 */
export function editableGrid(map: DiveSiteMap, max = HANDLES_MAX): GridHandle[] {
  const extent = map.extent_m ?? SITE_EXTENT_M
  const step = handleSpacing(extent, max)

  const byId = new Map<string, GridHandle>()
  for (let x = -extent; x <= extent; x += step) {
    for (let y = -extent; y <= extent; y += step) {
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
