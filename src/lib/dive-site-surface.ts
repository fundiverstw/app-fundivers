import Delaunator from 'delaunator'
import type { DiveSiteMap, Sounding, Vec2 } from './dive-site-map'

// Turning scattered soundings into a seafloor surface.
//
// The honesty problem this module exists to solve: a triangulated surface will
// happily span a 60 m hole between two soundings and render it as confident
// seafloor. In three dimensions that reads as "surveyed" far more strongly than
// a sketch ever does, so the prettier the render, the bigger the lie.
//
// The rule here is that a triangle's credibility falls with its size. A
// triangle whose longest edge is short sits between soundings that are close
// together and is worth drawing solid; one spanning a large gap is an
// interpolation across water nobody measured, and fades toward transparent.
// The empty space is then visible as empty — which is both the truthful
// rendering and the argument for contributing another sounding.

export interface Triangle {
  /** Indices into the sounding array. */
  a: number
  b: number
  c: number
  /** Longest edge in meters — the span the triangle interpolates across. */
  maxEdge_m: number
  /** 0 (pure guesswork) to 1 (well supported). */
  confidence: number
}

export interface SurfaceOptions {
  /** Longest edge, in meters, still drawn at full confidence. */
  solidEdge_m?: number
  /** Longest edge, in meters, beyond which a triangle is not drawn at all. */
  cutoffEdge_m?: number
}

/** Exported because the view has to be able to say WHY a set of readings will
 *  not join into a surface, and "more than 60 m apart" is the actionable half
 *  of that answer. */
export const SURFACE_DEFAULTS: Required<SurfaceOptions> = {
  solidEdge_m: 15,
  cutoffEdge_m: 60,
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Confidence for a triangle spanning `maxEdge_m`.
 *
 * Full up to `solidEdge_m`, then falls linearly to zero at `cutoffEdge_m`.
 * Linear rather than something smoother on purpose: a diver reading the render
 * should be able to tell "solid" from "half guessed" without a legend lesson.
 */
export function confidenceForEdge(maxEdge_m: number, opts: SurfaceOptions = {}): number {
  const { solidEdge_m, cutoffEdge_m } = { ...SURFACE_DEFAULTS, ...opts }
  if (maxEdge_m <= solidEdge_m) return 1
  if (maxEdge_m >= cutoffEdge_m) return 0
  return 1 - (maxEdge_m - solidEdge_m) / (cutoffEdge_m - solidEdge_m)
}

/**
 * Delaunay triangulation of the soundings, annotated with how far each triangle
 * is interpolating. Triangles past the cutoff are dropped rather than drawn at
 * zero opacity, so they cost nothing to render and cannot be revealed by a
 * viewer fiddling with material settings.
 */
export function triangulate(soundings: Sounding[], opts: SurfaceOptions = {}): Triangle[] {
  if (soundings.length < 3) return []

  const points = soundings.map(s => [s.at.x, s.at.y] as [number, number])
  const delaunay = Delaunator.from(points)
  const out: Triangle[] = []

  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const a = delaunay.triangles[i]
    const b = delaunay.triangles[i + 1]
    const c = delaunay.triangles[i + 2]
    const maxEdge_m = Math.max(
      dist(soundings[a].at, soundings[b].at),
      dist(soundings[b].at, soundings[c].at),
      dist(soundings[c].at, soundings[a].at),
    )
    const confidence = confidenceForEdge(maxEdge_m, opts)
    if (confidence <= 0) continue
    out.push({ a, b, c, maxEdge_m, confidence })
  }
  return out
}

export interface DepthRange {
  min_m: number
  max_m: number
}

export function depthRange(soundings: Sounding[]): DepthRange | null {
  if (!soundings.length) return null
  const depths = soundings.map(s => s.depth_m)
  return { min_m: Math.min(...depths), max_m: Math.max(...depths) }
}

export type Rgb = [number, number, number]

/**
 * Shallow-to-deep ramp, pale cyan through to deep blue.
 *
 * Monotonic in lightness as well as hue, so it survives being read in
 * greyscale or by a color-blind diver — the depth ordering is carried by
 * brightness, and hue only reinforces it.
 */
export function depthColor(depth_m: number, range: DepthRange): Rgb {
  const span = range.max_m - range.min_m
  const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (depth_m - range.min_m) / span))
  const shallow: Rgb = [0.78, 0.94, 0.95]
  const deep: Rgb = [0.03, 0.16, 0.42]
  return [
    shallow[0] + (deep[0] - shallow[0]) * t,
    shallow[1] + (deep[1] - shallow[1]) * t,
    shallow[2] + (deep[2] - shallow[2]) * t,
  ]
}

export interface SurfaceGeometry {
  /** xyz triples. y is up and negative — depth below the surface plane. */
  positions: Float32Array
  /** rgb triples, one per vertex. */
  colors: Float32Array
  /** Per-vertex alpha, carrying the confidence of the least-supported triangle
   *  the vertex belongs to. */
  alphas: Float32Array
  /** Triangle vertex indices. */
  indices: Uint32Array
  triangles: Triangle[]
}

/**
 * Build renderable geometry from a map's soundings.
 *
 * Vertices are NOT shared between triangles: confidence belongs to a triangle,
 * and sharing a vertex would average a well-supported triangle's opacity with
 * its guesswork neighbor's, quietly making the gaps look better covered than
 * they are.
 */
export function buildSurface(map: DiveSiteMap, opts: SurfaceOptions = {}): SurfaceGeometry | null {
  const range = depthRange(map.soundings)
  const triangles = triangulate(map.soundings, opts)
  if (!range || !triangles.length) return null

  const vertexCount = triangles.length * 3
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const alphas = new Float32Array(vertexCount)
  const indices = new Uint32Array(vertexCount)

  triangles.forEach((tri, t) => {
    const corners = [tri.a, tri.b, tri.c]
    corners.forEach((s, k) => {
      const v = t * 3 + k
      const sounding = map.soundings[s]
      positions[v * 3] = sounding.at.x
      positions[v * 3 + 1] = -sounding.depth_m
      positions[v * 3 + 2] = -sounding.at.y
      const [r, g, b] = depthColor(sounding.depth_m, range)
      colors[v * 3] = r
      colors[v * 3 + 1] = g
      colors[v * 3 + 2] = b
      alphas[v] = tri.confidence
      indices[v] = v
    })
  })

  return { positions, colors, alphas, indices, triangles }
}

/** How much of the drawn surface is well supported, as a 0–1 fraction of
 *  triangle area. Reported to the diver so the render never has to be taken on
 *  trust, and to the study as a per-site coverage figure. */
export function coverageFraction(triangles: Triangle[]): number {
  if (!triangles.length) return 0
  const total = triangles.reduce((sum, t) => sum + t.maxEdge_m, 0)
  const solid = triangles.reduce((sum, t) => sum + t.maxEdge_m * t.confidence, 0)
  return solid / total
}
