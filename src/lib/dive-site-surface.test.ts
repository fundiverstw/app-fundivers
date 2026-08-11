import { describe, it, expect } from 'vitest'
import {
  confidenceForEdge, triangulate, depthRange, depthColor, buildSurface, coverageFraction,
} from './dive-site-surface'
import type { DiveSiteMap, Sounding } from './dive-site-map'

function sounding(id: string, x: number, y: number, depth_m: number): Sounding {
  return { id, at: { x, y }, depth_m, datum: 'unknown', source: 'hand_drawn' }
}

function mapWith(soundings: Sounding[]): DiveSiteMap {
  return {
    id: 's', name: 'test', frame: {}, provenance: { author: 'test' },
    soundings, features: [], bearings: [], entries: [],
  }
}

describe('confidenceForEdge', () => {
  it('draws a tightly-sampled triangle at full confidence', () => {
    expect(confidenceForEdge(5)).toBe(1)
    expect(confidenceForEdge(15)).toBe(1)
  })

  it('falls off linearly across the interpolated span', () => {
    expect(confidenceForEdge(37.5)).toBeCloseTo(0.5)
  })

  it('reaches zero at the cutoff and stays there', () => {
    expect(confidenceForEdge(60)).toBe(0)
    expect(confidenceForEdge(500)).toBe(0)
  })

  it('honours a site-specific threshold', () => {
    expect(confidenceForEdge(20, { solidEdge_m: 30, cutoffEdge_m: 90 })).toBe(1)
    expect(confidenceForEdge(60, { solidEdge_m: 30, cutoffEdge_m: 90 })).toBeCloseTo(0.5)
  })
})

describe('triangulate', () => {
  it('needs three soundings before there is a surface at all', () => {
    expect(triangulate([])).toEqual([])
    expect(triangulate([sounding('a', 0, 0, 5), sounding('b', 1, 1, 6)])).toEqual([])
  })

  it('triangulates a tight cluster into drawable triangles', () => {
    const tris = triangulate([
      sounding('a', 0, 0, 5),
      sounding('b', 10, 0, 8),
      sounding('c', 0, 10, 9),
      sounding('d', 10, 10, 12),
    ])
    expect(tris.length).toBe(2)
    expect(tris.every(t => t.confidence === 1)).toBe(true)
  })

  it('drops triangles that would span further than the cutoff', () => {
    // Three points 200 m apart: every edge is far past the 60 m cutoff, so
    // there is nothing honest to draw between them.
    const tris = triangulate([
      sounding('a', 0, 0, 5),
      sounding('b', 200, 0, 8),
      sounding('c', 0, 200, 9),
    ])
    expect(tris).toEqual([])
  })

  it('keeps a partially-supported triangle but marks it down', () => {
    const tris = triangulate([
      sounding('a', 0, 0, 5),
      sounding('b', 30, 0, 8),
      sounding('c', 0, 30, 9),
    ])
    expect(tris.length).toBe(1)
    expect(tris[0].confidence).toBeGreaterThan(0)
    expect(tris[0].confidence).toBeLessThan(1)
  })

  it('records the span each triangle interpolates across', () => {
    const tris = triangulate([
      sounding('a', 0, 0, 5),
      sounding('b', 20, 0, 8),
      sounding('c', 0, 20, 9),
    ])
    expect(tris[0].maxEdge_m).toBeCloseTo(Math.hypot(20, 20))
  })
})

describe('depthRange / depthColor', () => {
  it('reports null for a map with no soundings', () => {
    expect(depthRange([])).toBeNull()
  })

  it('spans shallowest to deepest', () => {
    expect(depthRange([sounding('a', 0, 0, 6), sounding('b', 1, 1, 24)])).toEqual({ min_m: 6, max_m: 24 })
  })

  it('darkens monotonically with depth, so it survives greyscale', () => {
    const range = { min_m: 0, max_m: 30 }
    const lum = (d: number) => {
      const [r, g, b] = depthColor(d, range)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    expect(lum(0)).toBeGreaterThan(lum(10))
    expect(lum(10)).toBeGreaterThan(lum(20))
    expect(lum(20)).toBeGreaterThan(lum(30))
  })

  it('clamps outside the range instead of running off the ramp', () => {
    const range = { min_m: 10, max_m: 20 }
    expect(depthColor(5, range)).toEqual(depthColor(10, range))
    expect(depthColor(99, range)).toEqual(depthColor(20, range))
  })

  it('does not divide by zero when every sounding is the same depth', () => {
    const c = depthColor(12, { min_m: 12, max_m: 12 })
    expect(c.every(Number.isFinite)).toBe(true)
  })
})

describe('buildSurface', () => {
  const map = mapWith([
    sounding('a', 0, 0, 5),
    sounding('b', 10, 0, 8),
    sounding('c', 0, 10, 9),
    sounding('d', 10, 10, 12),
  ])

  it('returns null when there is nothing to triangulate', () => {
    expect(buildSurface(mapWith([]))).toBeNull()
    expect(buildSurface(mapWith([sounding('a', 0, 0, 5)]))).toBeNull()
  })

  it('emits three unshared vertices per triangle', () => {
    const surface = buildSurface(map)!
    expect(surface.triangles.length).toBe(2)
    expect(surface.positions.length).toBe(2 * 3 * 3)
    expect(surface.alphas.length).toBe(2 * 3)
    expect(Array.from(surface.indices)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('puts depth on the y axis, pointing down', () => {
    const surface = buildSurface(map)!
    const ys: number[] = []
    for (let i = 1; i < surface.positions.length; i += 3) ys.push(surface.positions[i])
    expect(ys.every(y => y <= 0)).toBe(true)
    expect(Math.min(...ys)).toBeCloseTo(-12)
  })

  it('carries per-vertex confidence so gaps can fade', () => {
    const sparse = mapWith([
      sounding('a', 0, 0, 5),
      sounding('b', 10, 0, 8),
      sounding('c', 0, 10, 9),
      sounding('far', 45, 40, 20),
    ])
    const surface = buildSurface(sparse)!
    const alphas = Array.from(surface.alphas)
    expect(Math.max(...alphas)).toBe(1)
    expect(Math.min(...alphas)).toBeLessThan(1)
  })
})

describe('coverageFraction', () => {
  it('is zero when nothing is drawn', () => {
    expect(coverageFraction([])).toBe(0)
  })

  it('is one when every triangle is well supported', () => {
    const tris = triangulate([
      sounding('a', 0, 0, 5),
      sounding('b', 10, 0, 8),
      sounding('c', 0, 10, 9),
    ])
    expect(coverageFraction(tris)).toBe(1)
  })

  it('drops as triangles stretch across unmeasured water', () => {
    const tris = triangulate([
      sounding('a', 0, 0, 5),
      sounding('b', 35, 0, 8),
      sounding('c', 0, 35, 9),
    ])
    expect(coverageFraction(tris)).toBeLessThan(1)
    expect(coverageFraction(tris)).toBeGreaterThan(0)
  })
})
