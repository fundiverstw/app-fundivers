// Moving the camera through the water.
//
// The arithmetic of traversal, kept out of the WebGL file so it can be tested
// without a GPU — the same split the drag arithmetic lives under in
// site-map-grab.ts. The scene owns the camera and the clock; this owns what a
// held key, or a held thumb, means.
//
// Forward is the direction the camera is LOOKING, pitch included. A flattened
// forward makes W a pan across the site and leaves descending to a key nobody
// finds, which is the wrong way round for a view whose whole subject is depth:
// pointing at the bottom and swimming at it is what a diver already does.

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** A direction the camera is being asked to move, whatever asked for it — a
 *  key, or a thumb on the on-screen pad. */
export type Travel = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down'

/**
 * How long a continuous press takes to reach full speed, and how much faster
 * that is than the first moment of it.
 *
 * One speed cannot do both jobs. Nudging the camera a metre to see behind a
 * boulder wants a slow one; dropping through forty metres of water at 3x
 * exaggeration — a hundred and twenty scene units — wants a fast one. Ramping
 * gives a tap the first and a held key the second.
 */
export const TRAVEL_RAMP_S = 1.2
export const TRAVEL_RAMP_MAX = 4

const KEYS: Record<string, Travel> = {
  w: 'forward', arrowup: 'forward',
  s: 'back', arrowdown: 'back',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
  e: 'up', pageup: 'up',
  q: 'down', pagedown: 'down',
}

/** What a key press means, or null for a key that means nothing here. */
export function travelForKey(key: string): Travel | null {
  return KEYS[key.toLowerCase()] ?? null
}

/**
 * Which way to move, as a unit vector, given what is held down.
 *
 * `forward` is the camera's look direction and `right` its own right vector,
 * both supplied by the scene. Up and down are world up and down rather than
 * the camera's, so "down" is always toward the seabed however the view is
 * tilted — the one direction on this map that has a fixed meaning.
 *
 * Opposing directions cancel to nothing rather than to a stagger, which is
 * what a diver holding both arrow keys expects.
 */
export function travelDirection(
  held: Iterable<Travel>, forward: Vec3, right: Vec3,
): Vec3 {
  let x = 0, y = 0, z = 0
  for (const dir of held) {
    if (dir === 'forward') { x += forward.x; y += forward.y; z += forward.z }
    else if (dir === 'back') { x -= forward.x; y -= forward.y; z -= forward.z }
    else if (dir === 'right') { x += right.x; y += right.y; z += right.z }
    else if (dir === 'left') { x -= right.x; y -= right.y; z -= right.z }
    else if (dir === 'up') y += 1
    else y -= 1
  }
  const length = Math.hypot(x, y, z)
  if (length < 1e-6) return { x: 0, y: 0, z: 0 }
  return { x: x / length, y: y / length, z: z / length }
}

/** Meters per second right now, for a press that has been held this long. */
export function travelSpeed(base_mps: number, travelling_s: number): number {
  const held = Math.min(Math.max(travelling_s, 0), TRAVEL_RAMP_S)
  return base_mps * (1 + (TRAVEL_RAMP_MAX - 1) * (held / TRAVEL_RAMP_S))
}
