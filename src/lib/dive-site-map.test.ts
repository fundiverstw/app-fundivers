import { describe, it, expect } from 'vitest'
import {
  boundsOf, viewBoxFor, toSvg, pathData, bearingEnd, scaleBarMetres,
  depthLabel, singleDatum, countsBySource, isVolumetric, VOLUMETRIC_FEATURES,
  canReduceToDatum, unreducibleSoundings, isObserved, observedOnly,
  entryId, latticeId,
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
    map.entries = [{ id: 'e', at: { x: -10, y: 0 }, source: 'hand_drawn' }]
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
    expect(countsBySource(map)).toEqual({ hand_drawn: 1, diver: 3, survey: 0, placeholder: 0 })
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

describe('reducing depths to a datum', () => {
  it('can reduce an instantaneous reading only when its time is known', () => {
    const base = { id: 'a', at: { x: 0, y: 0 }, depth_m: 24, source: 'diver' as const }
    expect(canReduceToDatum({ ...base, datum: 'instantaneous', observed_at: '2026-08-11T02:15:00Z' })).toBe(true)
    expect(canReduceToDatum({ ...base, datum: 'instantaneous' })).toBe(false)
  })

  it('cannot reduce a reading whose datum was never stated, dated or not', () => {
    const base = { id: 'a', at: { x: 0, y: 0 }, depth_m: 24, source: 'hand_drawn' as const }
    expect(canReduceToDatum({ ...base, datum: 'unknown' })).toBe(false)
    expect(canReduceToDatum({ ...base, datum: 'unknown', observed_at: '2015-06-01T00:00:00Z' })).toBe(false)
  })

  it('treats an already-reduced reading as needing nothing further', () => {
    const s = { id: 'a', at: { x: 0, y: 0 }, depth_m: 24, datum: 'TWCD2021' as const, source: 'survey' as const }
    expect(canReduceToDatum(s)).toBe(false)
    expect(unreducibleSoundings({ ...emptyMap(), soundings: [s] })).toEqual([])
  })

  it('lists the soundings that can never be brought onto a common datum', () => {
    const map = emptyMap()
    map.soundings = [
      { id: 'drawn', at: { x: 0, y: 0 }, depth_m: 24, datum: 'unknown', source: 'hand_drawn' },
      { id: 'timed', at: { x: 1, y: 1 }, depth_m: 18, datum: 'instantaneous', observed_at: '2026-08-11T02:15:00Z', source: 'diver' },
      { id: 'untimed', at: { x: 2, y: 2 }, depth_m: 12, datum: 'instantaneous', source: 'diver' },
    ]
    expect(unreducibleSoundings(map).map(s => s.id)).toEqual(['drawn', 'untimed'])
  })
})

describe('placeholder scaffold', () => {
  it('is not an observation', () => {
    expect(isObserved('placeholder')).toBe(false)
    expect(isObserved('diver')).toBe(true)
    expect(isObserved('hand_drawn')).toBe(true)
    expect(isObserved('survey')).toBe(true)
  })

  it('is stripped before anything is measured or counted', () => {
    const map = emptyMap()
    map.features = [
      { id: 'scaffold', kind: 'boundary', source: 'placeholder',
        geometry: { shape: 'path', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } },
      { id: 'real', kind: 'wall', source: 'diver',
        geometry: { shape: 'path', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] } },
    ]
    map.soundings = [
      { id: 'd', at: { x: 1, y: 1 }, depth_m: 9, datum: 'instantaneous', source: 'diver' },
    ]
    const observed = observedOnly(map)
    expect(observed.features.map(f => f.id)).toEqual(['real'])
    expect(observed.soundings).toHaveLength(1)
  })

  it('does not inflate the contribution counts', () => {
    const map = emptyMap()
    map.features = [
      { id: 'scaffold', kind: 'boundary', source: 'placeholder',
        geometry: { shape: 'path', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } },
    ]
    expect(countsBySource(map)).toEqual({ hand_drawn: 0, diver: 0, survey: 0, placeholder: 1 })
    expect(countsBySource(observedOnly(map)).placeholder).toBe(0)
  })
})


describe('entry points', () => {
  // Same rule the lattice enforces on depths, for the same reason: a site has
  // one slipway, not one per diver who noticed it.
  it('keys an entry off the coordinate, so two divers marking one slipway agree', () => {
    expect(entryId({ x: 4, y: -6 })).toBe(entryId({ x: 4.2, y: -5.9 }))
    expect(entryId({ x: 4, y: -6 })).not.toBe(entryId({ x: 5, y: -6 }))
  })

  it('does not collide with the id of the sounding on the same square metre', () => {
    expect(entryId({ x: 4, y: 6 })).not.toBe(latticeId({ x: 4, y: 6 }))
  })

  it('counts toward what a diver contributed', () => {
    const map = emptyMap()
    map.entries = [
      { id: 'e1', at: { x: 0, y: 0 }, source: 'diver' },
      { id: 'e2', at: { x: 8, y: 0 }, source: 'hand_drawn' },
    ]
    expect(countsBySource(map)).toMatchObject({ diver: 1, hand_drawn: 1 })
  })

  it('is dropped from the observed map when it is only scaffold', () => {
    const map = emptyMap()
    map.entries = [
      { id: 'e1', at: { x: 0, y: 0 }, source: 'diver' },
      { id: 'e2', at: { x: 8, y: 0 }, source: 'placeholder' },
    ]
    expect(observedOnly(map).entries.map(e => e.id)).toEqual(['e1'])
  })
})
