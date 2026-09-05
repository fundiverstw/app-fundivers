import { describe, it, expect } from 'vitest'
import {
  ROUTE_TEMPLATES, ROUTE_TEMPLATE_IDS, routeTemplate, suggestedEntry,
} from './site-map-routes'
import { entryId, snapToLattice } from './dive-site-map'

const shape = (id: string) => routeTemplate(id)!

describe('base routes', () => {
  it('offers one template per name in the vocabulary, and nothing else', () => {
    expect(ROUTE_TEMPLATES.map(r => r.id)).toEqual([...ROUTE_TEMPLATE_IDS])
    expect(routeTemplate('atlantis')).toBeNull()
    expect(routeTemplate('')).toBeNull()
    expect(routeTemplate(null)).toBeNull()
  })

  it('keeps every shape inside the ground it claims, entry included', () => {
    for (const template of ROUTE_TEMPLATES) {
      const { footprint, entry } = template
      expect(footprint.maxX).toBeGreaterThan(footprint.minX)
      expect(footprint.maxY).toBeGreaterThan(footprint.minY)
      expect(entry.x).toBeGreaterThanOrEqual(footprint.minX)
      expect(entry.x).toBeLessThanOrEqual(footprint.maxX)
      expect(entry.y).toBeGreaterThanOrEqual(footprint.minY)
      expect(entry.y).toBeLessThanOrEqual(footprint.maxY)
    }
  })

  // A scaffold quoting centimeters would claim a precision that even a real
  // reading here does not have.
  it('states depths to the tenth a dive computer reads', () => {
    for (const template of ROUTE_TEMPLATES) {
      for (let y = template.footprint.minY; y <= template.footprint.maxY; y += 3) {
        const depth = template.depthAt({ x: 0, y })
        expect(depth).toBe(Number(depth.toFixed(1)))
      }
    }
  })

  it('never suggests a depth past what a recreational dive reaches', () => {
    for (const template of ROUTE_TEMPLATES) {
      for (let x = template.footprint.minX; x <= template.footprint.maxX; x += 5) {
        for (let y = template.footprint.minY; y <= template.footprint.maxY; y += 5) {
          const depth = template.depthAt({ x, y })
          expect(depth).toBeGreaterThanOrEqual(0)
          expect(depth).toBeLessThanOrEqual(40)
        }
      }
    }
  })

  it('runs the shore slope from the waterline down, and only down', () => {
    const slope = shape('shore_slope')
    expect(slope.depthAt({ x: 0, y: -30 })).toBe(0)
    expect(slope.depthAt({ x: 0, y: 30 })).toBe(18)
    let previous = -1
    for (let y = -30; y <= 30; y += 5) {
      const depth = slope.depthAt({ x: 0, y })
      expect(depth).toBeGreaterThan(previous)
      previous = depth
    }
  })

  // The abruptness is the whole character of a wall: a diver who finds the
  // edge five metres further out moves a handful of points, not the site.
  it('gives the wall a shelf, an edge and a floor', () => {
    const wall = shape('wall')
    expect(wall.depthAt({ x: 0, y: -30 })).toBe(5)
    expect(wall.depthAt({ x: 0, y: -5 })).toBe(5)
    expect(wall.depthAt({ x: 0, y: 5 })).toBe(30)
    expect(wall.depthAt({ x: 0, y: 30 })).toBe(30)
    expect(wall.depthAt({ x: 0, y: 0 })).toBeGreaterThan(5)
    expect(wall.depthAt({ x: 0, y: 0 })).toBeLessThan(30)
  })

  it('keeps the sand flat at one depth wherever it is asked', () => {
    const sand = shape('sandy_flat')
    expect(sand.depthAt({ x: -20, y: -30 })).toBe(8)
    expect(sand.depthAt({ x: 0, y: 0 })).toBe(8)
    expect(sand.depthAt({ x: 20, y: 30 })).toBe(8)
  })

  // The gully does not get deeper as you swim: it gets deeper as you cross it.
  it('cuts the gully across the swim, not along it', () => {
    const gully = shape('gully')
    expect(gully.depthAt({ x: 0, y: -30 })).toBe(12)
    expect(gully.depthAt({ x: 0, y: 30 })).toBe(12)
    expect(gully.depthAt({ x: 5, y: 0 })).toBe(12)
    expect(gully.depthAt({ x: 8, y: 0 })).toBe(6)
    expect(gully.depthAt({ x: 20, y: 0 })).toBe(6)
  })
})

describe('the entry a route suggests', () => {
  // Scaffold, and stamped as such: a template cannot claim anybody got into
  // the water anywhere.
  it('is a placeholder, never an observation', () => {
    for (const template of ROUTE_TEMPLATES) {
      expect(suggestedEntry(template).source).toBe('placeholder')
    }
  })

  it('sits on the lattice, so a diver who agrees replaces it rather than doubling it', () => {
    const template = shape('shore_slope')
    const entry = suggestedEntry(template)
    expect(entry.at).toEqual(snapToLattice(template.entry))
    expect(entry.id).toBe(entryId(template.entry))
  })
})
