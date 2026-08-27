import { describe, it, expect } from 'vitest'
import {
  beginGrab, dragTo, setGrabDepth, cancelGrab, movedGrab, DEPTH_STEP_M,
} from './site-map-grab'
import { MAX_PLAUSIBLE_DEPTH_M } from './site-map-draft'
import type { GridHandle } from './site-map-grid'

const handle: GridHandle = { id: 'lat:4:6', at: { x: 4, y: 6 }, depth_m: 10, measured: false }

// A tenth of a meter per pixel is roughly what the scene supplies when the
// whole site is in frame: a 40 px pull is 4 m.
const M_PER_PX = 0.1
const grabAt = (y = 100) => beginGrab(handle, y)

describe('dragging a point of seabed', () => {
  // The only mapping that survives contact with a diver: the seabed is toward
  // the bottom of the screen, so pulling that way is pulling it deeper.
  it('goes deeper as the pointer goes down, and shallower as it goes up', () => {
    expect(dragTo(grabAt(), 140, M_PER_PX).depth_m).toBe(14)
    expect(dragTo(grabAt(), 60, M_PER_PX).depth_m).toBe(6)
  })

  it('measures from where the grab started, not from the last frame', () => {
    // A long pull sampled at every pixel must land in the same place as one
    // jump, or a slow hand accumulates a different depth from a fast one.
    let grab = grabAt()
    for (let y = 101; y <= 140; y++) grab = dragTo(grab, y, M_PER_PX)
    expect(grab.depth_m).toBe(14)
  })

  it('scales with how far a pixel reaches, so a zoomed-in pull is finer', () => {
    expect(dragTo(grabAt(), 150, 0.2).depth_m).toBe(20)
    expect(dragTo(grabAt(), 150, 2).depth_m).toBe(100)
  })

  it('resolves to a tenth of a meter, which is all a dive computer reads', () => {
    expect(dragTo(grabAt(), 100.44, 1).depth_m).toBe(10.4)
    // And leaves no binary-floating-point tail to render or store.
    expect(String(dragTo(grabAt(), 104.3, 1).depth_m)).toBe('14.3')
  })

  it('will not be pulled above the surface or past a depth nobody dives', () => {
    expect(dragTo(grabAt(), -500, 1).depth_m).toBe(0)
    expect(dragTo(grabAt(), 5000, 1).depth_m).toBe(MAX_PLAUSIBLE_DEPTH_M)
  })

  it('starts from the depth the handle already had', () => {
    const measured = { ...handle, depth_m: 24.3, measured: true }
    const grab = beginGrab(measured, 100)
    expect(grab.from_m).toBe(24.3)
    expect(grab.depth_m).toBe(24.3)
    expect(dragTo(grab, 200, M_PER_PX).depth_m).toBe(34.3)
  })
})

describe('saying the figure instead of finding it', () => {
  it('takes a typed depth, so a diver who read 24.3 need not hunt for it', () => {
    expect(setGrabDepth(grabAt(), 24.3).depth_m).toBe(24.3)
  })

  it('holds a typed figure to the same limits as a pulled one', () => {
    expect(setGrabDepth(grabAt(), -4).depth_m).toBe(0)
    expect(setGrabDepth(grabAt(), 9999).depth_m).toBe(MAX_PLAUSIBLE_DEPTH_M)
    expect(setGrabDepth(grabAt(), Number.NaN).depth_m).toBe(10)
  })
})

describe('a grab that said nothing', () => {
  // Every mis-tap while orbiting would otherwise become a reading with
  // somebody's name on it, waiting for staff to review.
  it('is not a contribution', () => {
    expect(movedGrab(grabAt())).toBe(false)
    expect(movedGrab(dragTo(grabAt(), 100.02, 1))).toBe(false)
  })

  it('is a contribution once it moves a storable amount', () => {
    expect(movedGrab(dragTo(grabAt(), 100 + DEPTH_STEP_M / 1, 1))).toBe(true)
  })

  it('puts the point back where it was when cancelled', () => {
    const pulled = dragTo(grabAt(), 180, M_PER_PX)
    expect(pulled.depth_m).toBe(18)
    expect(cancelGrab(pulled).depth_m).toBe(10)
    expect(movedGrab(cancelGrab(pulled))).toBe(false)
  })
})
