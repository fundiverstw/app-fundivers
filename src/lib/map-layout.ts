// Greedy radial label placement for the dive-region map.
//
// Each label tries 24 angles around its marker, at 4 increasing radii, and
// picks the closest non-colliding slot. "Colliding" means overlapping any
// already-placed label's rect OR any other site's marker rect. A label is
// allowed to overlap its OWN marker (otherwise no label could ever sit
// near its pin) — this is the only exception.
//
// If every (angle, radius) combination collides, a final pass picks the
// outermost-radius angle with the minimum overlap area, so we degrade
// gracefully rather than ignoring overlaps entirely.

export type Anchor = 'start' | 'middle' | 'end'

export interface LabelRect {
  x: number
  y: number
  w: number
  h: number
}

export interface MarkerInput {
  name: string
  vx: number
  vy: number
}

export type Point = [number, number]

export interface PlacedLabel {
  vx: number
  vy: number
  labelX: number
  labelY: number
  anchor: Anchor
  rect: LabelRect
  /** Leader-line endpoints in viewBox coords (start = label edge, end = near marker). */
  leaderStart: Point
  leaderEnd: Point
  /** Index back into the input array (placement reorders internally). */
  index: number
}

export const MARKER_OFFSET = 5 // line endpoint distance from marker center

/**
 * Compute the leader line connecting a label rect to its marker. Start sits
 * one unit outside the rect's edge (so it clears the white text halo); end
 * sits MARKER_OFFSET units short of the marker center so the arrowhead
 * lands cleanly outside the marker circle.
 */
export function leaderLineFor(rect: LabelRect, vx: number, vy: number): { start: Point; end: Point } {
  const rcx = rect.x + rect.w / 2
  const rcy = rect.y + rect.h / 2
  const dx = vx - rcx
  const dy = vy - rcy
  const dist = Math.max(Math.hypot(dx, dy), 0.001)
  const ux = dx / dist
  const uy = dy / dist
  const tx = ux !== 0 ? (rect.w / 2) / Math.abs(ux) : Infinity
  const ty = uy !== 0 ? (rect.h / 2) / Math.abs(uy) : Infinity
  const tEdge = Math.min(tx, ty) + 1
  return {
    start: [rcx + ux * tEdge, rcy + uy * tEdge],
    end:   [vx - ux * MARKER_OFFSET, vy - uy * MARKER_OFFSET],
  }
}

function pointInRect(p: Point, r: LabelRect): boolean {
  return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h
}

function ccw(p: Point, q: Point, r: Point): number {
  return (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
}

/**
 * Strict segment-segment intersection via the CCW orientation test. We
 * require both pairs of orientations to be on *opposite* sides (signs
 * strictly differ). Endpoint touches (where one orientation evaluates to
 * zero) don't count as crossings — this is what we want for the case of
 * three same-coord markers whose three leader lines converge to the same
 * point near the marker; they touch but don't truly cross.
 */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const o1 = ccw(a1, a2, b1)
  const o2 = ccw(a1, a2, b2)
  const o3 = ccw(b1, b2, a1)
  const o4 = ccw(b1, b2, a2)
  return o1 * o2 < 0 && o3 * o4 < 0
}

/** A line segment intersects a rect iff either endpoint is inside, or the
 *  segment crosses any of the rect's four edges. */
export function lineIntersectsRect(p1: Point, p2: Point, r: LabelRect): boolean {
  if (pointInRect(p1, r) || pointInRect(p2, r)) return true
  const tl: Point = [r.x, r.y]
  const tr: Point = [r.x + r.w, r.y]
  const br: Point = [r.x + r.w, r.y + r.h]
  const bl: Point = [r.x, r.y + r.h]
  return (
    segmentsIntersect(p1, p2, tl, tr) ||
    segmentsIntersect(p1, p2, tr, br) ||
    segmentsIntersect(p1, p2, br, bl) ||
    segmentsIntersect(p1, p2, bl, tl)
  )
}

export const FONT_SIZE = 10
export const MARKER_R = 3
const PAD = 4
const MARKER_BUFFER = 1.5 // gap kept around each foreign marker rect
const CHAR_W = FONT_SIZE * 0.55

// 24 angles total: 12 "main" directions every 30° (right first, then
// up-right/up-left, then up/down, etc.), then 12 in-between every 30°
// offset by 15°. Tried in priority order — main angles first.
const ANGLE_PRIORITY_DEG = [
  0, -30, 30, -60, 60, -90, 90, -120, 120, -150, 150, 180,
  -15, 15, -45, 45, -75, 75, -105, 105, -135, 135, -165, 165,
]
const ANGLES = ANGLE_PRIORITY_DEG.map(d => (d * Math.PI) / 180)

// Increasing rings of distance from marker center to label center. Most
// labels land at the closest ring; only dense clusters spill into the
// outer rings.
const RADII = [14, 22, 30, 40, 55]

export function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  )
}

function overlapArea(a: LabelRect, b: LabelRect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return xOverlap * yOverlap
}

interface Candidate {
  labelX: number
  labelY: number
  anchor: Anchor
  rect: LabelRect
}

function buildCandidate(vx: number, vy: number, name: string, dist: number, angle: number): Candidate {
  const w = name.length * CHAR_W + PAD
  const h = FONT_SIZE + PAD
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const cx = vx + dx * dist
  const cy = vy + dy * dist

  let anchor: Anchor
  let rectX: number
  if (dx > 0.5) {
    anchor = 'start'
    rectX = cx - PAD / 2
  } else if (dx < -0.5) {
    anchor = 'end'
    rectX = cx - w + PAD / 2
  } else {
    anchor = 'middle'
    rectX = cx - w / 2
  }

  const labelY = cy + 0.3 * FONT_SIZE
  const rect: LabelRect = { x: rectX, y: cy - h / 2, w, h }
  return { labelX: cx, labelY, anchor, rect }
}

function markerRectOf(vx: number, vy: number): LabelRect {
  const r = MARKER_R + MARKER_BUFFER
  return { x: vx - r, y: vy - r, w: r * 2, h: r * 2 }
}

export interface PlaceLabelsOptions {
  /**
   * Constrains label rects to stay inside [0, width] x [0, height]. Used
   * by the map page to keep text from spilling outside the SVG viewBox.
   */
  bounds?: { width: number; height: number }
}

function inBounds(rect: LabelRect, b?: { width: number; height: number }): boolean {
  if (!b) return true
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= b.width &&
    rect.y + rect.h <= b.height
  )
}

function outOfBoundsArea(rect: LabelRect, b?: { width: number; height: number }): number {
  if (!b) return 0
  const overX = Math.max(0, -rect.x) + Math.max(0, rect.x + rect.w - b.width)
  const overY = Math.max(0, -rect.y) + Math.max(0, rect.y + rect.h - b.height)
  return overX * rect.h + overY * rect.w
}

export function placeLabels(inputs: MarkerInput[], options: PlaceLabelsOptions = {}): PlacedLabel[] {
  // Sort north-to-south (smaller vy first) so the layout reads top-down,
  // but remember each input's original index so the caller can match.
  const indexed = inputs.map((s, index) => ({ ...s, index }))
  const sorted = [...indexed].sort((a, b) => a.vy - b.vy)
  const markerRects = sorted.map(s => markerRectOf(s.vx, s.vy))

  const placedLabels: LabelRect[] = []
  const placedLines: { start: Point; end: Point }[] = []

  // Picks the lowest-penalty candidate when nothing fits cleanly. Leader-
  // line collisions are weighted heaviest because a line crossing a label
  // is the visual disaster we're trying to avoid.
  function fallbackPenalty(cand: Candidate, line: { start: Point; end: Point }, ownIdx: number): number {
    let penalty = 0
    for (const p of placedLabels) penalty += overlapArea(cand.rect, p)
    for (let j = 0; j < markerRects.length; j++) {
      if (j === ownIdx) continue
      penalty += overlapArea(cand.rect, markerRects[j]) * 5
    }
    penalty += outOfBoundsArea(cand.rect, options.bounds) * 8
    // Line collisions add a flat penalty per offence; counts more than a
    // small label-overlap area.
    for (const p of placedLabels) {
      if (lineIntersectsRect(line.start, line.end, p)) penalty += 25
    }
    for (let j = 0; j < markerRects.length; j++) {
      if (j === ownIdx) continue
      if (lineIntersectsRect(line.start, line.end, markerRects[j])) penalty += 50
    }
    for (const other of placedLines) {
      if (segmentsIntersect(line.start, line.end, other.start, other.end)) penalty += 25
    }
    for (const other of placedLines) {
      if (lineIntersectsRect(other.start, other.end, cand.rect)) penalty += 25
    }
    return penalty
  }

  const placements: PlacedLabel[] = sorted.map((s, i) => {
    let chosen: { cand: Candidate; line: { start: Point; end: Point } } | null = null

    outer:
    for (const dist of RADII) {
      for (const angle of ANGLES) {
        const cand = buildCandidate(s.vx, s.vy, s.name, dist, angle)
        if (!inBounds(cand.rect, options.bounds)) continue
        if (placedLabels.some(p => rectsOverlap(cand.rect, p))) continue
        if (markerRects.some((m, j) => j !== i && rectsOverlap(cand.rect, m))) continue

        const line = leaderLineFor(cand.rect, s.vx, s.vy)
        // This label's own elements never collide with itself by construction
        // (line ends 5 units short of own marker, starts 1 unit outside own
        // rect). All "self" checks are skipped via index === i.
        if (placedLabels.some(p => lineIntersectsRect(line.start, line.end, p))) continue
        if (markerRects.some((m, j) => j !== i && lineIntersectsRect(line.start, line.end, m))) continue
        if (placedLines.some(o => segmentsIntersect(line.start, line.end, o.start, o.end))) continue
        if (placedLines.some(o => lineIntersectsRect(o.start, o.end, cand.rect))) continue

        chosen = { cand, line }
        break outer
      }
    }

    if (!chosen) {
      let bestPenalty = Infinity
      for (const angle of ANGLES) {
        const cand = buildCandidate(s.vx, s.vy, s.name, RADII[RADII.length - 1], angle)
        const line = leaderLineFor(cand.rect, s.vx, s.vy)
        const penalty = fallbackPenalty(cand, line, i)
        if (penalty < bestPenalty) {
          bestPenalty = penalty
          chosen = { cand, line }
        }
      }
    }

    const { cand: c, line } = chosen as { cand: Candidate; line: { start: Point; end: Point } }
    placedLabels.push(c.rect)
    placedLines.push(line)
    return {
      vx: s.vx,
      vy: s.vy,
      labelX: c.labelX,
      labelY: c.labelY,
      anchor: c.anchor,
      rect: c.rect,
      leaderStart: line.start,
      leaderEnd: line.end,
      index: s.index,
    }
  })

  // Return in original input order so the caller can map back trivially.
  return placements.sort((a, b) => a.index - b.index)
}
