import { describe, it, expect } from 'vitest'
import { LONGDONG_4, newSiteMap, SITE_EXTENT_M } from './site-seeds'
import { snapToLattice, latticeId, LATTICE_SPACING_M } from './dive-site-map'

describe('site seeds', () => {
  it('opens a new site with a canvas and nothing recorded on it', () => {
    const site = newSiteMap('x', 'X')
    expect(site.soundings).toEqual([])
    expect(site.features).toEqual([])
    expect(site.extent_m).toBe(SITE_EXTENT_M)
  })

  it('sizes the canvas to how far a dive ranges, not how far it swims', () => {
    // Wide enough for an out-and-back shore dive to stay on the map, and no
    // wider: every extra metre of field costs precision at a fixed screen size.
    expect(SITE_EXTENT_M * 2).toBe(500)
  })

  it('leaves a new site ungeoreferenced until somebody surveys the origin', () => {
    expect(newSiteMap('x', 'X').frame.origin).toBeUndefined()
  })

  it('seeds Longdong 4 with the same starting state', () => {
    expect(LONGDONG_4.id).toBe('longdong-4')
    expect(LONGDONG_4.name_en).toMatch(/Longdong Site 4/)
    expect(LONGDONG_4.soundings).toEqual([])
  })
})

describe('the implicit lattice', () => {
  it('is spaced one metre', () => {
    expect(LATTICE_SPACING_M).toBe(1)
  })

  it('snaps a tap to the nearest metre', () => {
    expect(snapToLattice({ x: 12.4, y: -7.6 })).toEqual({ x: 12, y: -8 })
    expect(snapToLattice({ x: -0.4, y: 0.5 })).toEqual({ x: -0, y: 1 })
  })

  it('gives the same position the same id, whoever taps it', () => {
    expect(latticeId({ x: 12.4, y: -7.6 })).toBe(latticeId({ x: 11.8, y: -8.2 }))
    expect(latticeId({ x: 12, y: -8 })).toBe('lat:12:-8')
  })

  it('gives neighbouring metres different ids', () => {
    expect(latticeId({ x: 12, y: -8 })).not.toBe(latticeId({ x: 13, y: -8 }))
  })

  it('costs nothing at rest — a kilometre of lattice stores no records', () => {
    // The point of an implicit lattice: a 1 km site at 1 m spacing is over a
    // million positions and zero rows until somebody records something.
    expect(newSiteMap('x', 'X').soundings).toHaveLength(0)
  })
})
