import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiveSiteScene } from './DiveSiteScene'
import type { DiveSiteMap, Sounding } from '../../lib/dive-site-map'
import { SURFACE_DEFAULTS } from '../../lib/dive-site-surface'
import { t } from '../../i18n'

// happy-dom has no WebGL context, so these cover the paths that do not need a
// GPU: the too-few-soundings guard, the unsupported-device fallback, and the
// legend text that must accompany any rendered surface. The geometry itself is
// covered in lib/dive-site-surface.test.ts.

function sounding(id: string, x: number, y: number, depth_m: number): Sounding {
  return { id, at: { x, y }, depth_m, datum: 'unknown', source: 'hand_drawn' }
}

function mapWith(soundings: Sounding[]): DiveSiteMap {
  return {
    id: 's', name: 'Test site', frame: {}, provenance: { author: 'test' },
    soundings, features: [], bearings: [], entries: [],
  }
}

describe('DiveSiteScene', () => {
  it('shows the flat base rather than an error when too little has been recorded', () => {
    // Under three readings there is nothing to triangulate, but a diver still
    // needs a seabed to pull at: the view falls back to the flat base plane and
    // the shortfall is said in the caption, not instead of the view.
    render(<DiveSiteScene map={mapWith([sounding('a', 0, 0, 5), sounding('b', 5, 5, 6)])} />)
    expect(screen.getByText(/no measured depths yet/i)).toBeInTheDocument()
    expect(screen.getByText(t.siteMap.notEnoughSoundings)).toBeInTheDocument()
  })

  it('falls back to a readable message where WebGL is unavailable', () => {
    render(<DiveSiteScene map={mapWith([
      sounding('a', 0, 0, 5), sounding('b', 10, 0, 8), sounding('c', 0, 10, 9),
    ])} />)
    expect(screen.getByText(/3D view unavailable/i)).toBeInTheDocument()
  })

  it('states the coverage figure so the render is never taken on trust', () => {
    render(<DiveSiteScene map={mapWith([
      sounding('a', 0, 0, 5), sounding('b', 10, 0, 8), sounding('c', 0, 10, 9),
    ])} />)
    expect(screen.getByText(/100% of the drawn surface/i)).toBeInTheDocument()
  })

  it('reports lower coverage once triangles stretch across unmeasured water', () => {
    render(<DiveSiteScene map={mapWith([
      sounding('a', 0, 0, 5), sounding('b', 35, 0, 8), sounding('c', 0, 35, 9),
    ])} />)
    expect(screen.queryByText(/100% of the drawn surface/i)).not.toBeInTheDocument()
    expect(screen.getByText(/% of the drawn surface/i)).toBeInTheDocument()
  })

  it('always says that gaps are gaps and that feature shapes are schematic', () => {
    render(<DiveSiteScene map={mapWith([
      sounding('a', 0, 0, 5), sounding('b', 10, 0, 8), sounding('c', 0, 10, 9),
    ])} />)
    expect(screen.getByText(/gaps are gaps, not flat seabed/i)).toBeInTheDocument()
    expect(screen.getByText(/shape has not been surveyed/i)).toBeInTheDocument()
  })
})

// Three readings that will not triangulate — collinear, or every edge past the
// cutoff — used to replace the whole view with a line of text. That took the
// handles away with it, so the diver could not add the fourth reading that
// would have fixed it: a dead end reached by pulling three points too far
// apart, which on a 500 m site is the ordinary way to start.
describe('DiveSiteScene when the readings will not join', () => {
  const far = [
    sounding('a', 0, 0, 10),
    sounding('b', 200, 0, 12),
    sounding('c', 0, 200, 14),
  ]

  it('keeps the view rather than replacing it with an explanation', () => {
    render(<DiveSiteScene map={mapWith(far)} />)
    expect(screen.queryByText(t.siteMap.notEnoughSoundings)).not.toBeInTheDocument()
    expect(screen.getByText(t.siteMap.soundingsWontJoin(SURFACE_DEFAULTS.cutoffEdge_m)))
      .toBeInTheDocument()
  })

  it('says three are needed only to someone who does not have three', () => {
    render(<DiveSiteScene map={mapWith([sounding('a', 0, 0, 10)])} />)
    expect(screen.getByText(t.siteMap.notEnoughSoundings)).toBeInTheDocument()
    expect(screen.queryByText(t.siteMap.soundingsWontJoin(SURFACE_DEFAULTS.cutoffEdge_m)))
      .not.toBeInTheDocument()
  })

  it('says nothing at all once they do join', () => {
    render(<DiveSiteScene map={mapWith([
      sounding('a', 0, 0, 10), sounding('b', 8, 0, 12), sounding('c', 0, 8, 14),
    ])} />)
    expect(screen.queryByText(t.siteMap.notEnoughSoundings)).not.toBeInTheDocument()
    expect(screen.queryByText(t.siteMap.soundingsWontJoin(SURFACE_DEFAULTS.cutoffEdge_m)))
      .not.toBeInTheDocument()
  })
})
