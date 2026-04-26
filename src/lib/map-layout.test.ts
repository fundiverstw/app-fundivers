import { describe, it, expect } from 'vitest'
import {
  placeLabels, rectsOverlap, lineIntersectsRect, segmentsIntersect,
  MARKER_R, type LabelRect, type MarkerInput, type PlacedLabel,
} from './map-layout'

// Marker rect must match the one map-layout uses internally (MARKER_R + 1.5
// buffer). These tests pin the contract: no label should overlap any other
// label, and no label should overlap any other site's marker.

const MARKER_BUFFER = 1.5

function markerRect(vx: number, vy: number): LabelRect {
  const r = MARKER_R + MARKER_BUFFER
  return { x: vx - r, y: vy - r, w: r * 2, h: r * 2 }
}

function pairwiseOverlap(rects: LabelRect[]): [number, number] | null {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) return [i, j]
    }
  }
  return null
}

function findLabelMarkerOverlap(
  inputs: MarkerInput[],
  placed: { rect: LabelRect; index: number }[],
): { labelIdx: number; markerIdx: number } | null {
  for (const p of placed) {
    for (let m = 0; m < inputs.length; m++) {
      if (m === p.index) continue
      if (rectsOverlap(p.rect, markerRect(inputs[m].vx, inputs[m].vy))) {
        return { labelIdx: p.index, markerIdx: m }
      }
    }
  }
  return null
}

function findLineLabelOverlap(placed: PlacedLabel[]): { lineIdx: number; rectIdx: number } | null {
  for (const p of placed) {
    for (const q of placed) {
      if (p.index === q.index) continue
      if (lineIntersectsRect(p.leaderStart, p.leaderEnd, q.rect)) {
        return { lineIdx: p.index, rectIdx: q.index }
      }
    }
  }
  return null
}

function findLineMarkerOverlap(
  inputs: MarkerInput[],
  placed: PlacedLabel[],
): { lineIdx: number; markerIdx: number } | null {
  for (const p of placed) {
    for (let m = 0; m < inputs.length; m++) {
      if (m === p.index) continue
      if (lineIntersectsRect(p.leaderStart, p.leaderEnd, markerRect(inputs[m].vx, inputs[m].vy))) {
        return { lineIdx: p.index, markerIdx: m }
      }
    }
  }
  return null
}

function findLineLineCrossing(placed: PlacedLabel[]): [number, number] | null {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (segmentsIntersect(placed[i].leaderStart, placed[i].leaderEnd, placed[j].leaderStart, placed[j].leaderEnd)) {
        return [placed[i].index, placed[j].index]
      }
    }
  }
  return null
}

describe('placeLabels', () => {
  it('returns one rect per input, in input order', () => {
    const inputs: MarkerInput[] = [
      { name: 'A', vx: 50, vy: 50 },
      { name: 'B', vx: 200, vy: 50 },
      { name: 'C', vx: 50, vy: 200 },
    ]
    const placed = placeLabels(inputs)
    expect(placed).toHaveLength(3)
    expect(placed.map(p => p.index)).toEqual([0, 1, 2])
  })

  it('places a single isolated label without overlap', () => {
    const placed = placeLabels([{ name: 'Solo Site', vx: 100, vy: 100 }])
    expect(placed).toHaveLength(1)
    // First-priority angle is 0° (right); the right ring is clear so the
    // label should land within the closest radius.
    const dist = Math.hypot(placed[0].labelX - 100, placed[0].labelY - 100)
    expect(dist).toBeLessThan(20)
  })

  it('produces non-overlapping labels for two close markers', () => {
    const inputs: MarkerInput[] = [
      { name: 'Site A', vx: 100, vy: 100 },
      { name: 'Site B', vx: 105, vy: 100 },
    ]
    const placed = placeLabels(inputs)
    const hit = pairwiseOverlap(placed.map(p => p.rect))
    expect(hit).toBeNull()
  })

  it('places three same-coord labels in three different angular slots', () => {
    const inputs: MarkerInput[] = [
      { name: 'Iron House',   vx: 100, vy: 100 },
      { name: 'Iron House 2', vx: 100, vy: 100 },
      { name: 'Shipwrecks',   vx: 100, vy: 100 },
    ]
    const placed = placeLabels(inputs)
    expect(pairwiseOverlap(placed.map(p => p.rect))).toBeNull()
  })

  it("doesn't route a leader line through a neighboring label rect (Iron House / Secret Garden case)", () => {
    // The bug the user reported: Iron House / Iron Reef's leader line
    // passed underneath the Secret Garden label. With both markers at
    // ~vy=206 and 12 units apart horizontally, a naive right-side
    // placement makes Iron House's line skim through Secret Garden's rect.
    const inputs: MarkerInput[] = [
      { name: 'Secret Garden', vx: 156, vy: 206 },
      { name: 'Iron House / Iron Reef', vx: 168, vy: 206 },
    ]
    const placed = placeLabels(inputs)
    expect(findLineLabelOverlap(placed)).toBeNull()
  })

  it('keeps labels clear of OTHER sites markers in a tight cluster', () => {
    // Real Keelung sites projected through the production transform at
    // MAX_ZOOM=18. Iron House / Iron House 2 / Shipwrecks share one
    // (vx, vy); the rest spread within ~75 SVG units of the cluster.
    const inputs: MarkerInput[] = [
      { name: 'Iron House / Iron Reef',         vx: 180, vy: 220 },
      { name: 'Iron House 2',                   vx: 180, vy: 220 },
      { name: 'Badouzi Bay: Shipwrecks',        vx: 180, vy: 220 },
      { name: 'Secret Garden',                  vx: 162, vy: 220 },
      { name: 'Badouzi Bay: Crystal Temple Wall', vx: 187, vy: 232 },
      { name: 'Rainbow Reef',                   vx: 139, vy: 133 },
      { name: 'Bat Cave',                       vx: 211, vy: 250 },
    ]
    const placed = placeLabels(inputs)
    expect(pairwiseOverlap(placed.map(p => p.rect))).toBeNull()
    expect(findLabelMarkerOverlap(inputs, placed)).toBeNull()
    // Full collision contract — leader lines don't cross neighboring
    // labels, neighboring markers, or each other.
    expect(findLineLabelOverlap(placed)).toBeNull()
    expect(findLineMarkerOverlap(inputs, placed)).toBeNull()
    expect(findLineLineCrossing(placed)).toBeNull()
  })

  it('keeps labels inside the bounded viewport when bounds are provided', () => {
    // Sites near the right edge — without bounds the algorithm would put
    // their labels offscreen.
    const inputs: MarkerInput[] = [
      { name: 'Eastern Reef A', vx: 280, vy: 100 },
      { name: 'Eastern Reef B', vx: 285, vy: 110 },
    ]
    const placed = placeLabels(inputs, { bounds: { width: 290, height: 360 } })
    for (const p of placed) {
      expect(p.rect.x).toBeGreaterThanOrEqual(0)
      expect(p.rect.y).toBeGreaterThanOrEqual(0)
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(290)
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(360)
    }
  })

  it('handles a dense ten-site cluster without label-label overlap', () => {
    // Stress test approximating a Penghu-density cluster — ten sites in a
    // ring of radius 25 SVG units (~25 km on the ground at 12× zoom).
    // Still tight enough that labels must spill into outer radii.
    const center = { x: 145, y: 180 }
    const inputs: MarkerInput[] = Array.from({ length: 10 }, (_, i) => {
      const angle = (i / 10) * Math.PI * 2
      return {
        name: `Site ${i + 1}`,
        vx: center.x + Math.cos(angle) * 25,
        vy: center.y + Math.sin(angle) * 25,
      }
    })
    const placed = placeLabels(inputs, { bounds: { width: 290, height: 360 } })
    expect(pairwiseOverlap(placed.map(p => p.rect))).toBeNull()
  })
})
