import { entryId, snapToLattice, type EntryPoint, type Vec2 } from './dive-site-map'
import type { Bounds, Scaffold } from './site-map-grid'

// Starting shapes for a site nobody has mapped yet.
//
// An empty site opens as a flat sheet of water, which is honest and is also a
// blank page: the first diver has to pull every metre of a slope that any diver
// who has been there could have described in three words. A base route is that
// description, made grabbable — the shape a shore dive, a wall or a sand flat
// usually has, laid over the field so the work becomes correcting a shape
// rather than building one.
//
// IT IS NOT DATA. A route is a function from position to depth, never a stored
// record: it seeds what the handles start at, exactly as the flat field used to
// (`BASE_DEPTH_M`), and the moment somebody pulls a point that pull is theirs
// and is the only thing written. A site whose diver picked "wall" and submitted
// nothing has contributed nothing, and its coverage is still zero. The one
// record a template does produce is a SUGGESTED entry, and it is stamped
// `placeholder` so it draws faintly and is stripped by `observedOnly` like any
// other scaffold — a template cannot claim somebody got into the water there.
//
// The shapes are deliberately generic. Anything traced from a real site would
// be a survey nobody did, and the shop's own sites are exactly what the divers
// are being asked to measure.

export const ROUTE_TEMPLATE_IDS = ['shore_slope', 'wall', 'sandy_flat', 'gully'] as const
export type RouteTemplateId = typeof ROUTE_TEMPLATE_IDS[number]

export interface RouteTemplate extends Scaffold {
  id: RouteTemplateId
  /** Where the shape assumes the water was entered — a suggestion to confirm
   *  or ignore, never a reading. */
  entry: Vec2
}

/** The ground every template covers: a 40 m wide corridor running 60 m north
 *  from the shore end, which is the shape of an ordinary out-and-back. */
const FOOTPRINT: Bounds = { minX: -20, maxX: 20, minY: -30, maxY: 30 }

/** The shore end of the corridor, where all four shapes put the entry. */
const ENTRY: Vec2 = { x: 0, y: -30 }

/** How far north of the shore end a position sits, 0 at the shore. */
function alongshore(at: Vec2): number {
  return at.y - FOOTPRINT.minY
}

/** Depths carry the resolution a dive computer reads, and no more — a scaffold
 *  quoting centimeters would be claiming a precision even a real reading here
 *  does not have. */
function tenth(depth_m: number): number {
  return Number(depth_m.toFixed(1))
}

function ramp(value: number, from: number, to: number, at0: number, at1: number): number {
  if (value <= at0) return from
  if (value >= at1) return to
  return from + ((to - from) * (value - at0)) / (at1 - at0)
}

function template(id: RouteTemplateId, depthAt: (at: Vec2) => number): RouteTemplate {
  return { id, footprint: FOOTPRINT, entry: ENTRY, depthAt: at => tenth(depthAt(at)) }
}

export const ROUTE_TEMPLATES: readonly RouteTemplate[] = [
  // The commonest shore dive there is: walk in, and the bottom falls away at a
  // steady angle for as far as the air lasts.
  template('shore_slope', at => ramp(alongshore(at), 0, 18, 0, 60)),
  // A shelf you swim out along, then the edge. The drop is deliberately short
  // in plan — that abruptness is the whole character of a wall, and a diver who
  // finds the edge is 5 m further out moves five points, not fifty.
  template('wall', at => ramp(alongshore(at), 5, 30, 25, 35)),
  // Sand at one depth, which is what a training bay or a boat drop onto a flat
  // bottom actually looks like.
  template('sandy_flat', () => 8),
  // A channel between two shoulders of rock, running the way the swim does.
  // Depth is a function of how far off the center line you are, not of how far
  // out — the gully does not get deeper, it gets narrower or wider.
  template('gully', at => ramp(Math.abs(at.x), 12, 6, 5, 8)),
]

export function routeTemplate(id: string | null | undefined): RouteTemplate | null {
  return ROUTE_TEMPLATES.find(r => r.id === id) ?? null
}

/**
 * The entry a template suggests, as a scaffold record.
 *
 * Keyed off the lattice like every other entry, so a diver who agrees taps that
 * point and their own entry replaces the suggestion at the same id rather than
 * landing beside it.
 */
export function suggestedEntry(template: RouteTemplate): EntryPoint {
  const at = snapToLattice(template.entry)
  return { id: entryId(at), at, source: 'placeholder' }
}
