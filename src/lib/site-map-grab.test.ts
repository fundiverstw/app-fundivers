import { describe, it, expect } from 'vitest'
import {
  beginGrab, dragTo, setGrabDepth, cancelGrab, movedGrab, nearestWithin,
  isTap, withinBox, DEPTH_STEP_M, TAP_SLOP_PX, type ScreenPoint,
} from './site-map-grab'
import { MAX_PLAUSIBLE_DEPTH_M } from './site-map-draft'
import type { GridHandle } from './site-map-grid'
import { BASE_DEPTH_M } from './site-seeds'

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

  // Every point of an unedited site is at the surface, so this is what the
  // first pull on a new site actually does.
  it('turns a pull down from the surface into the depth pulled to', () => {
    const surface: GridHandle = { ...handle, depth_m: BASE_DEPTH_M }
    expect(beginGrab(surface, 100).depth_m).toBe(0)
    expect(dragTo(beginGrab(surface, 100), 340, M_PER_PX).depth_m).toBe(24)
  })

  it('has nowhere to go upward from the surface, so an upward drag says nothing', () => {
    const surface: GridHandle = { ...handle, depth_m: BASE_DEPTH_M }
    expect(dragTo(beginGrab(surface, 100), 20, M_PER_PX).depth_m).toBe(0)
    expect(movedGrab(dragTo(beginGrab(surface, 100), 20, M_PER_PX))).toBe(false)
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


describe('finding the point under a finger', () => {
  const points: ScreenPoint[] = [
    { x: 100, y: 100 },
    { x: 108, y: 100 },
    { x: 400, y: 400 },
  ]

  it('takes the nearest point inside the radius, not the first one found', () => {
    expect(nearestWithin(points, 110, 100, 26)).toBe(1)
    expect(nearestWithin(points, 98, 100, 26)).toBe(0)
  })

  // A miss orbits the camera, which is recoverable. A grab of the wrong point
  // writes a reading in the wrong square metre, which nobody notices.
  it('grabs nothing in open water rather than the closest thing anywhere', () => {
    expect(nearestWithin(points, 250, 250, 26)).toBe(-1)
    expect(nearestWithin([], 100, 100, 26)).toBe(-1)
  })

  it('ignores points the camera is facing away from', () => {
    const behind: ScreenPoint[] = [{ x: 100, y: 100, behind: true }]
    expect(nearestWithin(behind, 100, 100, 26)).toBe(-1)
  })
})


describe('dragging a box around a stretch of seabed', () => {
  const field: ScreenPoint[] = [
    { x: 10, y: 10 },
    { x: 50, y: 50 },
    { x: 90, y: 90 },
    { x: 50, y: 50, behind: true },
  ]

  it('takes everything the rectangle covers, whichever corner it was drawn from', () => {
    const box = { x0: 0, y0: 0, x1: 60, y1: 60 }
    expect(withinBox(field, box)).toEqual([0, 1])
    expect(withinBox(field, { x0: 60, y0: 60, x1: 0, y1: 0 })).toEqual([0, 1])
  })

  it('counts a point on the edge as inside — a box drawn to a dot means that dot', () => {
    expect(withinBox(field, { x0: 10, y0: 10, x1: 50, y1: 50 })).toEqual([0, 1])
  })

  // The same reason picking skips them: a point the camera faces away from
  // projects to a plausible coordinate nowhere near where it appears, so a box
  // over the near seabed would quietly also take in the ground behind the
  // diver's head.
  it('leaves out points behind the camera', () => {
    expect(withinBox(field, { x0: 0, y0: 0, x1: 200, y1: 200 })).toEqual([0, 1, 2])
  })

  it('finds nothing in a rectangle over empty water', () => {
    expect(withinBox(field, { x0: 200, y0: 200, x1: 300, y1: 300 })).toEqual([])
  })

  // A finger never lands perfectly still, and a two-pixel wobble that selected
  // a rectangle of nothing would read as the tap having been swallowed.
  it('reads a box no bigger than a fingertip wobble as a tap', () => {
    expect(isTap({ x0: 100, y0: 100, x1: 100, y1: 100 })).toBe(true)
    expect(isTap({ x0: 100, y0: 100, x1: 100 + TAP_SLOP_PX, y1: 100 + TAP_SLOP_PX })).toBe(true)
    expect(isTap({ x0: 100, y0: 100, x1: 100 + TAP_SLOP_PX + 1, y1: 100 })).toBe(false)
    expect(isTap({ x0: 100, y0: 100, x1: 100, y1: 140 })).toBe(false)
  })
})
