import { describe, it, expect } from 'vitest'
import { editableGrid, handleSpacing, handleAt, HANDLES_MAX } from './site-map-grid'
import { latticeId, snapToLattice, LATTICE_SPACING_M, type DiveSiteMap, type Sounding } from './dive-site-map'
import { BASE_DEPTH_M, newSiteMap } from './site-seeds'

const site = (over: Partial<DiveSiteMap> = {}): DiveSiteMap => ({
  ...newSiteMap('s1', 'Test Site'),
  extent_m: 20,
  ...over,
})

const sounding = (x: number, y: number, depth_m: number, over: Partial<Sounding> = {}): Sounding => ({
  id: `s-${x}-${y}`, at: { x, y }, depth_m, datum: 'instantaneous',
  source: 'diver', observed_at: '2026-08-27T00:00:00Z', ...over,
})

describe('handleSpacing', () => {
  it('lands on whole lattice steps, so a handle never sits between two', () => {
    for (const extent of [10, 37, 250, 1000]) {
      const step = handleSpacing(extent)
      expect(step % LATTICE_SPACING_M).toBe(0)
      expect(step).toBeGreaterThanOrEqual(LATTICE_SPACING_M)
    }
  })

  it('keeps a big site inside a drawable number of handles', () => {
    const step = handleSpacing(1000)
    const perSide = Math.floor(2000 / step) + 1
    expect(perSide * perSide).toBeLessThanOrEqual(HANDLES_MAX)
  })

  it('does not thin a small site below the lattice it is measured on', () => {
    expect(handleSpacing(5)).toBe(LATTICE_SPACING_M)
  })
})

describe('editableGrid', () => {
  it('covers an unmeasured site with a flat field to pull at', () => {
    const handles = editableGrid(site())
    expect(handles.length).toBeGreaterThan(0)
    expect(handles.every(h => h.depth_m === BASE_DEPTH_M)).toBe(true)
    expect(handles.every(h => !h.measured)).toBe(true)
  })

  it('gives every handle the lattice id of its own position', () => {
    for (const h of editableGrid(site())) {
      expect(h.id).toBe(latticeId(h.at))
      expect(snapToLattice(h.at)).toEqual(h.at)
    }
  })

  it('shows a measured depth at its position, and says it was measured', () => {
    const handles = editableGrid(site({ soundings: [sounding(4, 6, 24.3)] }))
    const at46 = handleAt(handles, latticeId({ x: 4, y: 6 }))!
    expect(at46.depth_m).toBe(24.3)
    expect(at46.measured).toBe(true)
  })

  // A diver who recorded a depth at 1 m resolution has to be able to grab that
  // reading again. Dropping it for being off the drawn field would make their
  // own contribution uneditable by them.
  it('keeps a measured point that falls between the drawn handles', () => {
    const big = site({ extent_m: 1000, soundings: [sounding(3, 7, 18)] })
    expect(handleSpacing(1000)).toBeGreaterThan(LATTICE_SPACING_M)
    expect(handleAt(editableGrid(big), latticeId({ x: 3, y: 7 }))).toMatchObject({
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

  it('finds nothing for a position nobody drew', () => {
    expect(handleAt(editableGrid(site()), 'lat:9999:9999')).toBeNull()
  })
})
