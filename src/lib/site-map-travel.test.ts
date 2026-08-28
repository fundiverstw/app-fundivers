import { describe, it, expect } from 'vitest'
import {
  travelDirection, travelForKey, travelSpeed,
  TRAVEL_RAMP_S, TRAVEL_RAMP_MAX, type Travel,
} from './site-map-travel'

// A camera looking down at 45 degrees, which is roughly how the view opens.
const LOOKING_DOWN = { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 }
const LEVEL = { x: 0, y: 0, z: -1 }
const RIGHT = { x: 1, y: 0, z: 0 }

const dir = (held: Travel[], forward = LEVEL) => travelDirection(held, forward, RIGHT)

describe('what a key means', () => {
  it('reads the two layouts a keyboard actually offers', () => {
    expect(travelForKey('w')).toBe('forward')
    expect(travelForKey('ArrowUp')).toBe('forward')
    expect(travelForKey('S')).toBe('back')
    expect(travelForKey('ArrowLeft')).toBe('left')
  })

  it('gives depth its own pair, so descending needs no aim', () => {
    expect(travelForKey('q')).toBe('down')
    expect(travelForKey('e')).toBe('up')
    expect(travelForKey('PageDown')).toBe('down')
  })

  it('means nothing by a key that is not one of them', () => {
    expect(travelForKey('k')).toBeNull()
    expect(travelForKey('Enter')).toBeNull()
  })
})

describe('which way the camera goes', () => {
  // The change that made a dive site navigable: forward is where the camera is
  // LOOKING. Flattened, W panned across the site and the only way down was a
  // key nobody finds.
  it('follows the whole look direction, pitch included', () => {
    const heading = dir(['forward'], LOOKING_DOWN)
    expect(heading.y).toBeCloseTo(-Math.SQRT1_2)
    expect(heading.z).toBeCloseTo(-Math.SQRT1_2)
  })

  it('takes the camera up when it is pointed up and asked to go forward', () => {
    const looking_up = { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 }
    expect(dir(['forward'], looking_up).y).toBeGreaterThan(0)
  })

  // Whatever the view is doing, down is toward the seabed. It is the one
  // direction on this map with a fixed meaning, and a diver reaching for it is
  // not asking about the camera's idea of down.
  it('sinks and rises in the world, not in the camera', () => {
    expect(dir(['down'], LOOKING_DOWN)).toEqual({ x: 0, y: -1, z: 0 })
    expect(dir(['up'], LOOKING_DOWN)).toEqual({ x: 0, y: 1, z: 0 })
  })

  it('keeps left and right level, whatever the camera is tilted at', () => {
    expect(dir(['right'], LOOKING_DOWN)).toEqual({ x: 1, y: 0, z: 0 })
    expect(dir(['left'], LOOKING_DOWN)).toEqual({ x: -1, y: 0, z: 0 })
  })

  it('is a unit vector, so a diagonal is not faster than a straight line', () => {
    const diagonal = dir(['forward', 'right'])
    expect(Math.hypot(diagonal.x, diagonal.y, diagonal.z)).toBeCloseTo(1)
  })

  it('goes nowhere when opposing directions are both held', () => {
    expect(dir(['forward', 'back'])).toEqual({ x: 0, y: 0, z: 0 })
    expect(dir(['up', 'down'])).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('goes nowhere when nothing is held', () => {
    expect(dir([])).toEqual({ x: 0, y: 0, z: 0 })
  })

  // Swimming down at an angle is the ordinary way to cross a slope.
  it('combines a descent with a heading', () => {
    const heading = dir(['forward', 'down'])
    expect(heading.y).toBeLessThan(0)
    expect(heading.z).toBeLessThan(0)
  })
})

describe('how fast', () => {
  it('starts gently, so the camera can be placed and not just flown', () => {
    expect(travelSpeed(20, 0)).toBe(20)
  })

  it('builds to full speed over a held press, for the long way down', () => {
    expect(travelSpeed(20, TRAVEL_RAMP_S)).toBe(20 * TRAVEL_RAMP_MAX)
    expect(travelSpeed(20, TRAVEL_RAMP_S / 2)).toBeCloseTo(20 * (1 + (TRAVEL_RAMP_MAX - 1) / 2))
  })

  it('stops building rather than running away with a key left down', () => {
    expect(travelSpeed(20, 60)).toBe(20 * TRAVEL_RAMP_MAX)
  })

  it('is never negative, whatever the clock says', () => {
    expect(travelSpeed(20, -5)).toBe(20)
  })
})
