import type {
  DiveSiteMap, FeatureKind, SiteFeature, Sounding, Vec2,
} from './dive-site-map'

// What a diver builds before they submit anything.
//
// A draft is deliberately separate from the map it will be added to. A
// contribution is a proposal — it belongs to the diver who made it, is
// reviewable before it lands, and must survive being rejected without
// disturbing what was already there. Merging a draft straight into the map
// would lose all three properties.
//
// Every sounding placed here is stamped `instantaneous` with the time it was
// recorded, because that is what a dive computer reads and because a depth
// without a time can never be reduced to a chart datum later. The editor
// refuses to submit soundings that lack one, which is why the field is
// captured at placement rather than asked for at the end.

export type EditorTool = 'sounding' | 'contour' | 'feature'

export interface Draft {
  tool: EditorTool
  /** Vertices of the line or outline currently being drawn. */
  pending: Vec2[]
  soundings: Sounding[]
  features: SiteFeature[]
  /** Depth applied to the next placed sounding, in meters. */
  depth_m: number
  /** Kind applied to the next committed feature. */
  featureKind: FeatureKind
}

export function emptyDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    tool: 'sounding',
    pending: [],
    soundings: [],
    features: [],
    depth_m: 10,
    featureKind: 'rock',
    ...overrides,
  }
}

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

export function setTool(draft: Draft, tool: EditorTool): Draft {
  // Switching tools abandons a half-drawn line rather than carrying its
  // vertices into a different shape, which would silently produce a contour
  // made of points meant for something else.
  return { ...draft, tool, pending: [] }
}

export function setDepth(draft: Draft, depth_m: number): Draft {
  return { ...draft, depth_m }
}

export function setFeatureKind(draft: Draft, featureKind: FeatureKind): Draft {
  return { ...draft, featureKind }
}

export function placeSounding(
  draft: Draft,
  at: Vec2,
  observedAt: string,
  supersedes?: string,
): Draft {
  const sounding: Sounding = {
    id: nextId('draft-s'),
    at,
    depth_m: draft.depth_m,
    datum: 'instantaneous',
    observed_at: observedAt,
    source: 'diver',
    supersedes,
  }
  // Correcting the same grid point twice replaces the earlier correction
  // rather than stacking two readings on one spot.
  const kept = supersedes
    ? draft.soundings.filter(s => s.supersedes !== supersedes)
    : draft.soundings
  return { ...draft, soundings: [...kept, sounding] }
}

export function addVertex(draft: Draft, at: Vec2): Draft {
  return { ...draft, pending: [...draft.pending, at] }
}

/** Minimum vertices before a shape is worth keeping: a line needs two, an
 *  outline needs three. */
export function canCommitPath(draft: Draft): boolean {
  const needed = draft.tool === 'contour' ? 2 : 3
  return draft.pending.length >= needed
}

export function commitPath(draft: Draft, label?: string): Draft {
  if (!canCommitPath(draft)) return draft
  const feature: SiteFeature = {
    id: nextId('draft-f'),
    kind: draft.tool === 'contour' ? 'boundary' : draft.featureKind,
    label,
    source: 'diver',
    geometry: draft.tool === 'contour'
      ? { shape: 'path', points: draft.pending }
      : { shape: 'area', points: draft.pending },
  }
  return { ...draft, features: [...draft.features, feature], pending: [] }
}

/** Undo drops the last vertex of a shape in progress before it touches
 *  anything already committed — otherwise a mis-tap while drawing would delete
 *  the previous finished shape instead. */
export function undo(draft: Draft): Draft {
  if (draft.pending.length) return { ...draft, pending: draft.pending.slice(0, -1) }
  if (draft.features.length) return { ...draft, features: draft.features.slice(0, -1) }
  if (draft.soundings.length) return { ...draft, soundings: draft.soundings.slice(0, -1) }
  return draft
}

export function contributionCount(draft: Draft): number {
  return draft.soundings.length + draft.features.length
}

export function isEmpty(draft: Draft): boolean {
  return contributionCount(draft) === 0
}

/**
 * Who a contribution is attributed to.
 *
 * Modeled on a commit author, with one deliberate difference: git publishes an
 * author's email because it is a tool for developers who chose that trade.
 * A dive-site map is read by strangers, so only the DISPLAY name travels with a
 * published contribution. The email stays in `profiles`, reachable by an admin
 * who needs to ask about an odd reading, and is never rendered.
 */
export interface Contributor {
  id: string
  /** Name or nickname as the shop already shows it elsewhere. */
  name: string
}

export interface SiteContribution {
  site_id: string
  /**
   * Display identity only, and NOT the authority on who submitted this.
   *
   * The server derives the real contributor from the authenticated session and
   * stamps it; anything the client sends here is a hint for optimistic
   * rendering. Trusting a client-supplied id would let anyone attribute a
   * reading to another diver — the same class of hole the booking guard closed.
   */
  contributor?: Contributor
  soundings: Sounding[]
  features: SiteFeature[]
  note?: string
}

export type SubmissionProblem =
  | 'empty'
  | 'sounding_without_time'
  | 'unfinished_shape'
  | 'implausible_depth'

/** The deepest a recreational diver can plausibly have read a depth. Beyond
 *  this the entry is far more likely a typo than a dive, and a single bad
 *  figure drags a whole interpolated surface with it. */
export const MAX_PLAUSIBLE_DEPTH_M = 100

export function validate(draft: Draft): SubmissionProblem[] {
  const problems: SubmissionProblem[] = []
  if (isEmpty(draft)) problems.push('empty')
  if (draft.pending.length) problems.push('unfinished_shape')
  if (draft.soundings.some(s => !s.observed_at)) problems.push('sounding_without_time')
  if (draft.soundings.some(s => s.depth_m <= 0 || s.depth_m > MAX_PLAUSIBLE_DEPTH_M)) {
    problems.push('implausible_depth')
  }
  return problems
}

export function toContribution(
  draft: Draft,
  siteId: string,
  opts: { contributor?: Contributor; note?: string } = {},
): SiteContribution | null {
  if (validate(draft).length) return null
  return {
    site_id: siteId,
    contributor: opts.contributor,
    soundings: draft.soundings,
    features: draft.features,
    note: opts.note,
  }
}

/** Records grouped by the submission they arrived on, newest first — the
 *  history view, and the per-diver counts the study reports. */
export function contributionsByDiver(map: DiveSiteMap): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (id?: string) => {
    if (!id) return
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  map.soundings.forEach(s => bump(s.contribution_id))
  map.features.forEach(f => bump(f.contribution_id))
  return counts
}

/** The map as it would look with this draft applied — for previewing a
 *  contribution before submitting it. Never persisted: the draft stays a
 *  proposal until it has been accepted. */
export function withDraft(map: DiveSiteMap, draft: Draft): DiveSiteMap {
  return {
    ...map,
    soundings: [...map.soundings, ...draft.soundings],
    features: [...map.features, ...draft.features],
  }
}

/**
 * The scaffold point a tap is correcting, if any.
 *
 * A diver aiming at a grid point will miss it by a meter or two, and a reading
 * dropped one meter from the point it was meant to replace leaves both on the
 * map: the flat placeholder AND the correction, arguing with each other.
 * Snapping means a tap near a point adopts THAT point's position, so the
 * correction lands exactly where the thing it supersedes was.
 */
export function snapTarget(
  at: Vec2,
  candidates: Sounding[],
  radius_m: number,
): Sounding | null {
  let best: Sounding | null = null
  let bestDistance = radius_m
  for (const c of candidates) {
    if (c.source !== 'placeholder') continue
    const d = Math.hypot(c.at.x - at.x, c.at.y - at.y)
    if (d <= bestDistance) {
      best = c
      bestDistance = d
    }
  }
  return best
}

/** Scaffold points a diver has already corrected in this draft — hidden from
 *  the canvas so the flat original does not sit under its own replacement. */
export function supersededIds(draft: Draft): Set<string> {
  return new Set(draft.soundings.map(s => s.supersedes).filter((x): x is string => !!x))
}

export interface Pick {
  /** The existing point the tap landed on, if any. */
  soundingId?: string
  at: Vec2
}

/**
 * Apply a tap to the draft.
 *
 * Only existing points are editable: a tap that hits nothing is ignored rather
 * than dropping a reading into open water. Free placement sounds more capable
 * and is worse — points land wherever a finger happened to be in a perspective
 * view, they supersede nothing, and the site accumulates a lattice of
 * corrections plus a scatter of near-duplicates arguing with it.
 */
export function applyPick(draft: Draft, pick: Pick, observedAt: string): Draft {
  if (!pick.soundingId) return draft
  return placeSounding(draft, pick.at, observedAt, pick.soundingId)
}
