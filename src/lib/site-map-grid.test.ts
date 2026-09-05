import { describe, it, expect } from 'vitest'
import {
  editableGrid, gridBounds, gridStep, expand, handleAt,
  PATCH_M, HANDLES_MAX, NO_EXPANSION, type Expansion, type Scaffold,
} from './site-map-grid'
import { latticeId, snapToLattice, LATTICE_SPACING_M, type DiveSiteMap, type Sounding } from './dive-site-map'
import { BASE_DEPTH_M, newSiteMap } from './site-seeds'

const site = (over: Partial<DiveSiteMap> = {}): DiveSiteMap => ({
  ...newSiteMap('s1', 'Test Site'),
  ...over,
})

const sounding = (x: number, y: number, depth_m: number, over: Partial<Sounding> = {}): Sounding => ({
  id: `s-${x}-${y}`, at: { x, y }, depth_m, datum: 'instantaneous',
  source: 'diver', observed_at: '2026-08-27T00:00:00Z', ...over,
})

describe('gridBounds', () => {
  it('starts as one patch on the origin', () => {
    expect(gridBounds(site())).toEqual({
      minX: -PATCH_M / 2, maxX: PATCH_M / 2, minY: -PATCH_M / 2, maxY: PATCH_M / 2,
    })
  })

  // A diver has to be able to grab their own readings, wherever they left them.
  it('always covers what has already been measured', () => {
    const b = gridBounds(site({ soundings: [sounding(140, -60, 12)] }))
    expect(b.maxX).toBeGreaterThanOrEqual(140)
    expect(b.minY).toBeLessThanOrEqual(-60)
  })

  it('ignores placeholder scaffold when deciding how far the site reaches', () => {
    const b = gridBounds(site({ soundings: [sounding(500, 0, 9, { source: 'placeholder' })] }))
    expect(b.maxX).toBe(PATCH_M / 2)
  })

  it('grows the edge that was extended, and only that edge', () => {
    const b = gridBounds(site(), { ...NO_EXPANSION, north: 2 })
    expect(b.maxY).toBe(PATCH_M / 2 + 2 * PATCH_M)
    expect(b.minY).toBe(-PATCH_M / 2)
    expect(b.minX).toBe(-PATCH_M / 2)
    expect(b.maxX).toBe(PATCH_M / 2)
  })

  it('puts north at +y, the way the compass rose is drawn', () => {
    const north = gridBounds(site(), { ...NO_EXPANSION, north: 1 })
    const south = gridBounds(site(), { ...NO_EXPANSION, south: 1 })
    expect(north.maxY).toBeGreaterThan(PATCH_M / 2)
    expect(south.minY).toBeLessThan(-PATCH_M / 2)
  })

  it('extends east and west along x', () => {
    expect(gridBounds(site(), { ...NO_EXPANSION, east: 1 }).maxX).toBe(PATCH_M / 2 + PATCH_M)
    expect(gridBounds(site(), { ...NO_EXPANSION, west: 1 }).minX).toBe(-PATCH_M / 2 - PATCH_M)
  })
})

describe('expand', () => {
  it('adds a patch to one compass point at a time', () => {
    const once: Expansion = expand(NO_EXPANSION, 'north')
    expect(once).toEqual({ north: 1, south: 0, east: 0, west: 0 })
    expect(expand(once, 'north')).toMatchObject({ north: 2 })
  })

  it('will not shrink a site past nothing', () => {
    expect(expand(NO_EXPANSION, 'south', -3)).toMatchObject({ south: 0 })
  })
})

describe('gridStep', () => {
  // The figure the whole model is built on. A field drawn at any other spacing
  // would quietly redefine what a reading means.
  it('is one meter for a site anyone is actually going to map', () => {
    expect(gridStep(gridBounds(site()))).toBe(LATTICE_SPACING_M)
    expect(gridStep(gridBounds(site(), { north: 2, south: 2, east: 2, west: 2 })))
      .toBe(LATTICE_SPACING_M)
  })

  it('thins only when the field has grown past what can be drawn', () => {
    const huge = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 }
    const step = gridStep(huge)
    expect(step).toBeGreaterThan(LATTICE_SPACING_M)
    const across = (huge.maxX - huge.minX) / step + 1
    expect(across * across).toBeLessThanOrEqual(HANDLES_MAX * 1.05)
  })
})

describe('editableGrid', () => {
  it('covers an unmeasured patch with a flat field to pull at', () => {
    const handles = editableGrid(site())
    expect(handles.length).toBeGreaterThan(0)
    expect(handles.every(h => h.depth_m === BASE_DEPTH_M)).toBe(true)
    expect(handles.every(h => !h.measured)).toBe(true)
  })

  // A field that started ten meters down was a guess wearing the clothes of a
  // reading. At the surface there is nothing to agree with, so shaping the
  // seabed can only be done by pulling each point down to where it really is.
  it('starts every point at the surface, with no depth to be talked out of', () => {
    expect(BASE_DEPTH_M).toBe(0)
    expect(editableGrid(site()).every(h => h.depth_m === 0)).toBe(true)
  })

  it('spaces them one meter apart', () => {
    const xs = [...new Set(editableGrid(site()).map(h => h.at.x))].sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBe(LATTICE_SPACING_M)
  })

  it('gives every handle the lattice id of its own position', () => {
    for (const h of editableGrid(site())) {
      expect(h.id).toBe(latticeId(h.at))
      expect(snapToLattice(h.at)).toEqual(h.at)
    }
  })

  it('draws the extended ground too', () => {
    const before = editableGrid(site()).length
    const after = editableGrid(site(), { ...NO_EXPANSION, north: 1 })
    expect(after.length).toBeGreaterThan(before)
    expect(Math.max(...after.map(h => h.at.y))).toBe(PATCH_M / 2 + PATCH_M)
  })

  it('shows a measured depth at its position, and says it was measured', () => {
    const handles = editableGrid(site({ soundings: [sounding(4, 6, 24.3)] }))
    expect(handleAt(handles, latticeId({ x: 4, y: 6 }))).toMatchObject({
      depth_m: 24.3, measured: true,
    })
  })

  it('keeps a measured point that falls between the drawn handles', () => {
    const far = site({ soundings: [sounding(701, 3, 18)] })
    expect(gridStep(gridBounds(far))).toBeGreaterThan(LATTICE_SPACING_M)
    expect(handleAt(editableGrid(far), latticeId({ x: 701, y: 3 }))).toMatchObject({
      depth_m: 18, measured: true,
    })
  })

  // Scaffold is not an observation — the flat base exists so a site reads as
  // unmeasured, and counting it as data is exactly what it must never be.
  it('ignores placeholder scaffold in the stored map', () => {
    const handles = editableGrid(site({
      soundings: [sounding(4, 6, 99, { source: 'placeholder' })],
    }))
    expect(handleAt(handles, latticeId({ x: 4, y: 6 }))).toMatchObject({
      depth_m: BASE_DEPTH_M, measured: false,
    })
  })

  it('lets the newest reading of a position win, as the lattice does', () => {
    const handles = editableGrid(site({
      soundings: [sounding(4, 6, 12), sounding(4, 6, 24)],
    }))
    expect(handleAt(handles, latticeId({ x: 4, y: 6 }))!.depth_m).toBe(24)
  })

  it('has one handle per position, however many readings landed on it', () => {
    const handles = editableGrid(site({
      soundings: [sounding(4, 6, 12), sounding(4, 6, 24), sounding(4.4, 6.1, 30)],
    }))
    expect(handles.filter(h => h.id === latticeId({ x: 4, y: 6 }))).toHaveLength(1)
  })

  it('stays inside what can be drawn, however far the site is extended', () => {
    const handles = editableGrid(site(), { north: 40, south: 40, east: 40, west: 40 })
    expect(handles.length).toBeLessThanOrEqual(HANDLES_MAX * 1.1)
  })

  it('finds nothing for a position nobody drew', () => {
    expect(handleAt(editableGrid(site()), 'lat:9999:9999')).toBeNull()
  })
})


// A base route is a shape laid under the field, not records in the map: see
// site-map-routes.ts. What the grid owes it is ground to cover and a depth to
// start each handle at.
describe('a field laid over a starting shape', () => {
  const slope: Scaffold = {
    footprint: { minX: -20, maxX: 20, minY: -30, maxY: 30 },
    depthAt: at => (at.y + 30) / 5,
  }

  it("covers the shape's ground, so the diver is not asked to extend onto what they picked", () => {
    const bounds = gridBounds(site(), NO_EXPANSION, slope)
    expect(bounds).toEqual({ minX: -20, maxX: 20, minY: -30, maxY: 30 })
  })

  it('keeps the starting patch when the shape is smaller than it', () => {
    const small: Scaffold = { footprint: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, depthAt: () => 5 }
    expect(gridBounds(site(), NO_EXPANSION, small)).toEqual({
      minX: -PATCH_M / 2, maxX: PATCH_M / 2, minY: -PATCH_M / 2, maxY: PATCH_M / 2,
    })
  })

  it('starts each handle on the shape rather than at the surface', () => {
    const handles = editableGrid(site(), NO_EXPANSION, slope)
    expect(handleAt(handles, latticeId({ x: 0, y: -30 }))!.depth_m).toBe(0)
    expect(handleAt(handles, latticeId({ x: 0, y: 0 }))!.depth_m).toBe(6)
    expect(handleAt(handles, latticeId({ x: 0, y: 30 }))!.depth_m).toBe(12)
  })

  // Nothing about a shape is a reading. A diver who picks one and submits
  // nothing has contributed nothing, and the coverage figure must say so.
  it('marks every point of it unmeasured', () => {
    expect(editableGrid(site(), NO_EXPANSION, slope).every(h => !h.measured)).toBe(true)
  })

  it('leaves ground outside the shape at the surface', () => {
    const narrow: Scaffold = {
      footprint: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      depthAt: () => 9,
    }
    const handles = editableGrid(site(), NO_EXPANSION, narrow)
    expect(handleAt(handles, latticeId({ x: 0, y: 0 }))!.depth_m).toBe(9)
    expect(handleAt(handles, latticeId({ x: 8, y: 8 }))!.depth_m).toBe(BASE_DEPTH_M)
  })

  it('lets a measured reading win over the shape underneath it', () => {
    const handles = editableGrid(site({ soundings: [sounding(0, 0, 24.3)] }), NO_EXPANSION, slope)
    expect(handleAt(handles, latticeId({ x: 0, y: 0 }))).toMatchObject({
      depth_m: 24.3, measured: true,
    })
  })

  it('is the flat sheet of water it always was when no shape is given', () => {
    expect(editableGrid(site()).every(h => h.depth_m === BASE_DEPTH_M)).toBe(true)
  })
})
