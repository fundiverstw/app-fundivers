import { entryId, snapToLattice } from './dive-site-map'
import type {
  DiveSiteMap, EntryPoint, FeatureKind, SiteFeature, Sounding, Vec2,
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

export type EditorTool = 'sounding' | 'entry' | 'contour' | 'feature'

export interface Draft {
  tool: EditorTool
  /** Vertices of the line or outline currently being drawn. */
  pending: Vec2[]
  soundings: Sounding[]
  features: SiteFeature[]
  entries: EntryPoint[]
  /** Kind applied to the next committed feature. */
  featureKind: FeatureKind
  /**
   * The soundings each placement act produced, oldest act first.
   *
   * Undo reverses an ACT, and one act can now be forty readings: saying "this
   * whole ledge is twelve meters" with a selection is one thing the diver did,
   * and undoing it forty times would be forty presses to take back one
   * sentence. Held as ids rather than counts because a correction replaces an
   * earlier reading at the same position, so the ids in a batch outlive their
   * ordinal positions in `soundings`.
   */
  batches: string[][]
}

export function emptyDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    tool: 'sounding',
    pending: [],
    soundings: [],
    features: [],
    entries: [],
    featureKind: 'rock',
    batches: [],
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

export function setFeatureKind(draft: Draft, featureKind: FeatureKind): Draft {
  return { ...draft, featureKind }
}

/**
 * Place a reading at the depth the drag ended on.
 *
 * The depth is an argument rather than a setting on the draft because it comes
 * out of the gesture. Arming a figure and then tapping a target was the older
 * flow, and it made the number the subject and the place an afterthought.
 */
export function placeSounding(
  draft: Draft,
  at: Vec2,
  depth_m: number,
  observedAt: string,
  supersedes?: string,
): Draft {
  const sounding: Sounding = {
    id: nextId('draft-s'),
    at,
    depth_m,
    datum: 'instantaneous',
    observed_at: observedAt,
    source: 'diver',
    supersedes,
  }
  // Correcting the same grid point twice replaces the earlier correction
  // rather than stacking two readings on one spot.
  const dropped = supersedes
    ? draft.soundings.filter(s => s.supersedes === supersedes).map(s => s.id)
    : []
  const kept = draft.soundings.filter(s => !dropped.includes(s.id))
  return {
    ...draft,
    soundings: [...kept, sounding],
    batches: [...withoutIds(draft.batches, dropped), [sounding.id]],
  }
}

/**
 * One depth, stated over every position in a selection.
 *
 * The multi-point act, and the reason it is a single call rather than a loop
 * over `placeSounding`: a diver who selects a ledge and types 12 has done ONE
 * thing, and undo has to be able to take back the thing they did. Each position
 * still gets its own reading, superseding whatever was at that lattice id — the
 * depth is stated once but claimed everywhere it is written, which is exactly
 * what the diver said.
 */
export function placeSoundings(
  draft: Draft,
  points: readonly { id: string; at: Vec2 }[],
  depth_m: number,
  observedAt: string,
): Draft {
  if (!points.length) return draft
  const placed: Sounding[] = points.map(point => ({
    id: nextId('draft-s'),
    at: point.at,
    depth_m,
    datum: 'instantaneous',
    observed_at: observedAt,
    source: 'diver',
    supersedes: point.id,
  }))
  const superseded = new Set(points.map(p => p.id))
  const replaced = draft.soundings.filter(s => s.supersedes && superseded.has(s.supersedes))
  const kept = draft.soundings.filter(s => !replaced.includes(s))
  return {
    ...draft,
    soundings: [...kept, ...placed],
    batches: [
      ...withoutIds(draft.batches, replaced.map(s => s.id)),
      placed.map(s => s.id),
    ],
  }
}

/** Batches with dead readings forgotten, and any batch emptied by that
 *  forgetting dropped — an undo must never land on an act with nothing left in
 *  it and appear to do nothing. */
function withoutIds(batches: string[][], ids: string[]): string[][] {
  if (!ids.length) return batches
  return batches
    .map(batch => batch.filter(id => !ids.includes(id)))
    .filter(batch => batch.length > 0)
}

/**
 * Mark, or unmark, a way into the water.
 *
 * Toggling rather than adding, because the gesture that places one is a tap on
 * a point of seabed and taps land where they were not meant to. An entry that
 * can only be added is an entry somebody has to ask staff to remove.
 *
 * The id comes off the lattice, so marking a slipway another diver already
 * marked corrects their record instead of stacking a second entry on it.
 */
export function markEntry(draft: Draft, at: Vec2, label?: string): Draft {
  const point = snapToLattice(at)
  const id = entryId(point)
  const existing = draft.entries.find(e => e.id === id)
  if (existing) return { ...draft, entries: draft.entries.filter(e => e.id !== id) }
  return {
    ...draft,
    entries: [...draft.entries, {
      id,
      at: point,
      ...(label ? { label } : {}),
      source: 'diver',
    }],
  }
}

/** Name an entry already marked. A slipway and a scramble down the rocks are
 *  not interchangeable, and the label is the only thing that says which. */
export function nameEntry(draft: Draft, id: string, label: string): Draft {
  const trimmed = label.trim()
  return {
    ...draft,
    entries: draft.entries.map(e => {
      if (e.id !== id) return e
      const renamed: EntryPoint = { id: e.id, at: e.at, source: e.source }
      if (e.contribution_id) renamed.contribution_id = e.contribution_id
      if (trimmed) renamed.label = trimmed
      return renamed
    }),
  }
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
  if (draft.entries.length) return { ...draft, entries: draft.entries.slice(0, -1) }
  // A whole act at a time: the last batch, whether it was one point pulled or
  // a hundred set at once.
  if (draft.batches.length) {
    const last = draft.batches[draft.batches.length - 1]
    return {
      ...draft,
      soundings: draft.soundings.filter(s => !last.includes(s.id)),
      batches: draft.batches.slice(0, -1),
    }
  }
  if (draft.soundings.length) return { ...draft, soundings: draft.soundings.slice(0, -1) }
  return draft
}

export function contributionCount(draft: Draft): number {
  return draft.soundings.length + draft.features.length + draft.entries.length
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
  entries: EntryPoint[]
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
    entries: draft.entries,
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
  map.entries.forEach(e => bump(e.contribution_id))
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
    // Draft entries replace a stored one on the same lattice position rather
    // than doubling it, matching what the database does on submission.
    entries: [
      ...map.entries.filter(e => !draft.entries.some(d => d.id === e.id)),
      ...draft.entries,
    ],
  }
}
