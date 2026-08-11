import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiveSiteScene } from './DiveSiteScene'
import type { DiveSiteMap, Sounding } from '../../lib/dive-site-map'

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
    // needs a seabed to tap: the view falls back to the flat base plane.
    render(<DiveSiteScene map={mapWith([sounding('a', 0, 0, 5), sounding('b', 5, 5, 6)])} />)
    expect(screen.queryByText(/not enough soundings/i)).not.toBeInTheDocument()
    expect(screen.getByText(/no measured depths yet/i)).toBeInTheDocument()
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
