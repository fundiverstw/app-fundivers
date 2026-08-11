import { describe, it, expect } from 'vitest'
import {
  boundsOf, viewBoxFor, toSvg, pathData, bearingEnd, scaleBarMetres,
  depthLabel, singleDatum, countsBySource, isVolumetric, VOLUMETRIC_FEATURES,
  type DiveSiteMap,
} from './dive-site-map'

function emptyMap(): DiveSiteMap {
  return {
    id: 'site-1',
    name: 'Test site',
    frame: {},
    provenance: { author: 'Test' },
    soundings: [],
    features: [],
    bearings: [],
    entries: [],
  }
}

describe('boundsOf', () => {
  it('returns null for a map with nothing on it', () => {
    expect(boundsOf(emptyMap())).toBeNull()
  })

  it('spans soundings, entries, bearings and feature geometry together', () => {
    const map = emptyMap()
    map.soundings = [{ id: 's', at: { x: 5, y: 5 }, depth_m: 12, datum: 'unknown', source: 'hand_drawn' }]
    map.entries = [{ id: 'e', at: { x: -10, y: 0 } }]
    map.bearings = [{ id: 'b', from: { x: 0, y: 20 }, degrees: 90 }]
    map.features = [{
      id: 'f', kind: 'wall', source: 'hand_drawn',
      geometry: { shape: 'area', points: [{ x: 30, y: -8 }, { x: 32, y: -4 }] },
    }]
    expect(boundsOf(map)).toEqual({ minX: -10, minY: -8, maxX: 32, maxY: 20 })
  })
})

describe('viewBoxFor', () => {
  it('pads the extent and flips y so north is up', () => {
    const box = viewBoxFor({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 10)
    // x starts one pad left; y is the NEGATED top edge, because SVG y grows
    // downward while the site frame's y grows north.
    expect(box).toBe('-10 -60 120 70')
  })

  it('never emits a zero-sized box for a single-point map', () => {
    const box = viewBoxFor({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 0)
    const [, , w, h] = box.split(' ').map(Number)
    expect(w).toBeGreaterThan(0)
    expect(h).toBeGreaterThan(0)
  })
})

describe('toSvg / pathData', () => {
  it('mirrors y into SVG space', () => {
    expect(toSvg({ x: 3, y: 7 })).toEqual({ x: 3, y: -7 })
  })

  it('builds an open path by default and closes it on request', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }]
    expect(pathData(pts)).toBe('M 0 0 L 10 -5')
    expect(pathData(pts, true)).toBe('M 0 0 L 10 -5 Z')
  })

  it('returns an empty string for no points rather than a broken path', () => {
    expect(pathData([])).toBe('')
  })
})

describe('bearingEnd', () => {
  const origin = { x: 0, y: 0 }

  it('treats 0 degrees as north, not as the trigonometric x axis', () => {
    const end = bearingEnd(origin, 0, 10)
    expect(end.x).toBeCloseTo(0)
    expect(end.y).toBeCloseTo(10)
  })

  it('treats 90 degrees as east', () => {
    const end = bearingEnd(origin, 90, 10)
    expect(end.x).toBeCloseTo(10)
    expect(end.y).toBeCloseTo(0)
  })

  it('handles the reciprocal of a drawn heading', () => {
    const end = bearingEnd(origin, 180, 4)
    expect(end.x).toBeCloseTo(0)
    expect(end.y).toBeCloseTo(-4)
  })
})

describe('scaleBarMetres', () => {
  it('picks a round bar that fits inside the map width', () => {
    expect(scaleBarMetres({ minX: 0, minY: 0, maxX: 200, maxY: 100 })).toBe(50)
    expect(scaleBarMetres({ minX: 0, minY: 0, maxX: 80, maxY: 40 })).toBe(20)
  })

  it('falls back to the smallest bar for a tiny site', () => {
    expect(scaleBarMetres({ minX: 0, minY: 0, maxX: 4, maxY: 4 })).toBe(5)
  })
})

describe('depthLabel', () => {
  it('writes depths the way divers do', () => {
    expect(depthLabel(24)).toBe('-24m')
    expect(depthLabel(11.4)).toBe('-11m')
  })
})

describe('singleDatum', () => {
  it('reports the shared datum when every sounding agrees', () => {
    const map = emptyMap()
    map.soundings = [
      { id: 'a', at: { x: 0, y: 0 }, depth_m: 6, datum: 'unknown', source: 'hand_drawn' },
      { id: 'b', at: { x: 1, y: 1 }, depth_m: 8, datum: 'unknown', source: 'hand_drawn' },
    ]
    expect(singleDatum(map)).toBe('unknown')
  })

  it('returns null when datums are mixed, so the map cannot claim one', () => {
    const map = emptyMap()
    map.soundings = [
      { id: 'a', at: { x: 0, y: 0 }, depth_m: 6, datum: 'unknown', source: 'hand_drawn' },
      { id: 'b', at: { x: 1, y: 1 }, depth_m: 8, datum: 'TWCD2021', source: 'diver' },
    ]
    expect(singleDatum(map)).toBeNull()
  })

  it('returns null for a map with no soundings', () => {
    expect(singleDatum(emptyMap())).toBeNull()
  })
})

describe('countsBySource', () => {
  it('counts soundings and features together, by where they came from', () => {
    const map = emptyMap()
    map.soundings = [
      { id: 'a', at: { x: 0, y: 0 }, depth_m: 6, datum: 'unknown', source: 'hand_drawn' },
      { id: 'b', at: { x: 1, y: 1 }, depth_m: 8, datum: 'TWCD2021', source: 'diver' },
      { id: 'c', at: { x: 2, y: 2 }, depth_m: 9, datum: 'TWCD2021', source: 'diver' },
    ]
    map.features = [{ id: 'f', kind: 'arch', source: 'diver', geometry: { shape: 'point', at: { x: 0, y: 0 } } }]
    expect(countsBySource(map)).toEqual({ hand_drawn: 1, diver: 3, survey: 0 })
  })
})

describe('volumetric features', () => {
  it('names the kinds a depth grid cannot express', () => {
    expect(VOLUMETRIC_FEATURES).toEqual(['arch', 'swim_through', 'overhang', 'cave'])
  })

  it('separates them from the kinds a grid handles fine', () => {
    expect(isVolumetric('arch')).toBe(true)
    expect(isVolumetric('overhang')).toBe(true)
    expect(isVolumetric('slope')).toBe(false)
    expect(isVolumetric('sand')).toBe(false)
  })
})
