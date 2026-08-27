import type { GridHandle } from './site-map-grid'
import { MAX_PLAUSIBLE_DEPTH_M } from './site-map-draft'
import type { Vec2 } from './dive-site-map'

// Pulling a point of seabed to the depth it actually is.
//
// The arithmetic of a drag, kept out of the WebGL file so it can be tested
// without a GPU. The scene owns pointers and the camera; this owns what a
// pointer movement means.
//
// Down is deeper. It is the only mapping that survives contact with a diver:
// the number goes up as you pull toward the bottom of the screen, because that
// is the direction the seabed is in.

/** Dive computers read to a tenth of a meter, so the drag resolves to one too.
 *  Finer would be inventing precision the instrument never had. */
export const DEPTH_STEP_M = 0.1

export interface Grab {
  id: string
  at: Vec2
  /** Depth before the drag started — what a cancel restores, and what the drag
   *  is measured from. Holding it makes the gesture absolute rather than
   *  accumulating rounding error over a long pull. */
  from_m: number
  /** Screen y where the pointer went down. */
  originY: number
  depth_m: number
}

export function beginGrab(handle: GridHandle, pointerY: number): Grab {
  return {
    id: handle.id,
    at: handle.at,
    from_m: handle.depth_m,
    originY: pointerY,
    depth_m: handle.depth_m,
  }
}

function quantize(depth_m: number): number {
  const stepped = Math.round(depth_m / DEPTH_STEP_M) * DEPTH_STEP_M
  const clamped = Math.min(Math.max(stepped, 0), MAX_PLAUSIBLE_DEPTH_M)
  // Binary floating point leaves 24.400000000000002 lying around, which then
  // renders and gets stored.
  return Number(clamped.toFixed(1))
}

/**
 * Where the point sits now, given where the pointer is.
 *
 * `metersPerPixel` comes from the scene, which is the only thing that knows how
 * far a pixel reaches at the grabbed point's distance from the camera. Passing
 * it in rather than guessing a constant is what keeps a drag feeling the same
 * whether the diver is zoomed out over the whole site or in on one boulder.
 */
export function dragTo(grab: Grab, pointerY: number, metersPerPixel: number): Grab {
  const depth_m = quantize(grab.from_m + (pointerY - grab.originY) * metersPerPixel)
  return { ...grab, depth_m }
}

/** Type an exact figure instead of pulling for it — the diver who read 24.3 off
 *  a computer should not have to find it with a finger. */
export function setGrabDepth(grab: Grab, depth_m: number): Grab {
  return { ...grab, depth_m: quantize(Number.isFinite(depth_m) ? depth_m : grab.from_m) }
}

/** Put it back. A grab that moved nothing must leave no trace, or every
 *  mis-tap while orbiting becomes a reading somebody has to review. */
export function cancelGrab(grab: Grab): Grab {
  return { ...grab, depth_m: grab.from_m }
}

/** Did this drag actually say anything? Compared at storage resolution, so a
 *  sub-tenth wobble under a fingertip is not a contribution. */
export function movedGrab(grab: Grab): boolean {
  return Math.abs(grab.depth_m - grab.from_m) >= DEPTH_STEP_M / 2
}
