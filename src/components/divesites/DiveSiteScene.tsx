import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildSurface, coverageFraction, type SurfaceOptions } from '../../lib/dive-site-surface'
import {
  isVolumetric, observedOnly, singleDatum, snapToLattice, latticeId,
  LATTICE_SPACING_M, type DiveSiteMap, type Vec2,
} from '../../lib/dive-site-map'
import { BASE_DEPTH_M, SITE_EXTENT_M } from '../../lib/site-seeds'
import { t } from '../../i18n'
import { CARD, TEXT_HEADING, TEXT_MUTED, TEXT_SUBTLE } from '../../styles/tokens'

// The WebGL view. All arithmetic lives in lib/dive-site-surface.ts, which is
// unit-tested; this file is the part that cannot be tested in a DOM without a
// GPU, so it is kept as thin as possible and fails to a readable message rather
// than a blank canvas when WebGL is unavailable.
//
// Two rendering decisions are load-bearing rather than cosmetic:
//
//  • The surface carries PER-VERTEX ALPHA from triangle confidence, so water
//    nobody has sounded is visibly missing instead of quietly interpolated.
//  • Volumetric features (arches, swim-throughs) are drawn as WIREFRAME
//    markers, never as solid surfaces. Their position is real; their shape is
//    schematic, and a solid mesh would imply a survey that has not happened.

// Probed once per session rather than per mount: creating a throwaway canvas
// context is not free, and the answer cannot change while the tab is open.
let webglSupport: boolean | null = null
function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const probe = document.createElement('canvas')
    webglSupport = !!(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    webglSupport = false
  }
  return webglSupport
}

interface DiveSiteSceneProps {
  map: DiveSiteMap
  options?: SurfaceOptions
  height?: number
  /** Called when the diver taps one of the point markers. Only markers are
   *  reported: open seabed is not editable, so raycasting it would produce
   *  hits no caller acts on. */
  onPick?: (hit: { soundingId: string; at: Vec2 }) => void
  /** Vertical exaggeration. A dive site is tens of metres deep across hundreds
   *  of metres wide, so at true scale the relief that matters to a diver — the
   *  drop-off, the ridge, the gully — flattens into nothing. Exaggerating is
   *  standard practice for bathymetry; the figure is stated in the caption so
   *  nobody reads the slope as a real gradient. */
  verticalExaggeration?: number
}

export function DiveSiteScene({
  map, options, height = 420, verticalExaggeration = 3, onPick,
}: DiveSiteSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const roseRef = useRef<SVGGElement | null>(null)
  const supported = hasWebGL()

  // Scaffold is not data: a placeholder contour must never lend the surface
  // coverage it has not earned.
  const observed = useMemo(() => observedOnly(map), [map])
  const surface = useMemo(() => buildSurface(observed, options), [observed, options])
  // The scaffold gets its own surface so a new site has something to look at.
  // Built separately and drawn as a ghost: folding it into `surface` would let
  // guesswork count toward coverage, which is the one number here that has to
  // stay honest.
  const extent = map.extent_m ?? SITE_EXTENT_M
  // Below three readings there is nothing to triangulate, so the view falls
  // back to a flat base plane. Two triangles, whatever the site's size — the
  // lattice it represents is implicit and is never built as geometry.
  const showBase = observed.soundings.length < 3
  const coverage = surface ? coverageFraction(surface.triangles) : 0
  const datum = singleDatum(observed)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !supported) return
    if (!surface && !showBase) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })

    const width = mount.clientWidth || 640
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()

    const baseY = -BASE_DEPTH_M * verticalExaggeration
    const geometry = new THREE.BufferGeometry()

    if (surface) {
      const scaled = Float32Array.from(surface.positions)
      for (let i = 1; i < scaled.length; i += 3) scaled[i] *= verticalExaggeration
      geometry.setAttribute('position', new THREE.BufferAttribute(scaled, 3))
      const rgba = new Float32Array(surface.alphas.length * 4)
      for (let v = 0; v < surface.alphas.length; v++) {
        rgba[v * 4] = surface.colors[v * 3]
        rgba[v * 4 + 1] = surface.colors[v * 3 + 1]
        rgba[v * 4 + 2] = surface.colors[v * 3 + 2]
        rgba[v * 4 + 3] = surface.alphas[v]
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 4))
      geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1))
    } else {
      const e = extent
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        -e, baseY, -e,   e, baseY, -e,   e, baseY, e,   -e, baseY, e,
      ]), 3))
      const flat = new Float32Array(16)
      for (let v = 0; v < 4; v++) {
        flat[v * 4] = 0.55; flat[v * 4 + 1] = 0.68; flat[v * 4 + 2] = 0.78
        flat[v * 4 + 3] = 0.35
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(flat, 4))
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1))
    }
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.85,
        metalness: 0.05,
        flatShading: true,
      }),
    )
    scene.add(mesh)

    const wire = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.08 }),
    )
    scene.add(wire)

    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new THREE.Box3()
    const centre = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.z) / 2 || 30

    // Depth posts every 10 m, dropped from the surface to the deepest point, so
    // "how deep is this" is answerable by eye instead of by legend.
    const deepest = -(box.min.y)
    for (let d = 10 * verticalExaggeration; d <= deepest; d += 10 * verticalExaggeration) {
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 33 }, (_, i) => {
            const a = (i / 32) * Math.PI * 2
            return new THREE.Vector3(Math.cos(a) * radius * 1.15, -d, Math.sin(a) * radius * 1.15)
          }),
        ),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }),
      )
      ring.position.set(centre.x, 0, centre.z)
      scene.add(ring)
    }

    // Contributed readings are individual markers — there are few of them.
    const markerRadius = Math.max(radius * 0.012, 0.6)
    const pickable: THREE.Mesh[] = []
    for (const s of observed.soundings) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(markerRadius, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
      )
      marker.position.set(s.at.x, -s.depth_m * verticalExaggeration, -s.at.y)
      marker.userData.soundingId = s.id
      scene.add(marker)
      pickable.push(marker)
    }

    // The lattice is drawn, not stored. Every position is 1 m from the next,
    // so a 1 km field holds a million of them — far too many to draw. Only a
    // readable subset is shown, thinned by whatever step keeps the count near
    // LATTICE_DOTS_MAX, and the label states the true spacing so the drawing
    // is never mistaken for the resolution.
    const LATTICE_DOTS_MAX = 4000
    const latticeSpan = extent * 2
    const stepsAcross = Math.max(1, Math.floor(latticeSpan / LATTICE_SPACING_M))
    const step = Math.max(
      LATTICE_SPACING_M,
      Math.ceil(stepsAcross / Math.sqrt(LATTICE_DOTS_MAX)) * LATTICE_SPACING_M,
    )
    const dots: THREE.Vector3[] = []
    for (let x = -extent; x <= extent; x += step) {
      for (let y = -extent; y <= extent; y += step) {
        dots.push(new THREE.Vector3(x, baseY, -y))
      }
    }
    if (dots.length) {
      const lattice = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(dots),
        new THREE.PointsMaterial({
          color: 0xbcd4e2,
          size: Math.max(latticeSpan * 0.004, 0.5),
          transparent: true,
          opacity: 0.55,
          sizeAttenuation: true,
        }),
      )
      scene.add(lattice)
    }

    for (const f of observed.features) {
      if (!isVolumetric(f.kind) || f.geometry.shape !== 'point') continue
      const at = f.geometry.at
      const nearest = observed.soundings.reduce<{ d: number; depth: number }>((best, s) => {
        const d = Math.hypot(s.at.x - at.x, s.at.y - at.y)
        return d < best.d ? { d, depth: s.depth_m } : best
      }, { d: Infinity, depth: 0 })
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.09, radius * 0.012, 8, 32, Math.PI),
        new THREE.MeshBasicMaterial({ color: 0xffd27f, wireframe: true, transparent: true, opacity: 0.9 }),
      )
      marker.position.set(at.x, -nearest.depth * verticalExaggeration + radius * 0.06, -at.y)
      scene.add(marker)
    }

    scene.add(new THREE.AmbientLight(0xffffff, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(radius, radius * 2, radius)
    scene.add(key)

    // Fit the whole site in frame from its actual extent. Deriving the camera
    // distance from depth instead breaks on a flat site, where the relief is
    // nearly zero and the camera ends up inside the seabed.
    const FOV = 50
    const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, radius * 40)
    const span = Math.max(size.x, size.z, size.y, 1)
    const fit = (span / 2) / Math.tan((FOV * Math.PI) / 360)
    const distance = fit * 1.45
    camera.position.set(
      centre.x + distance * 0.45,
      Math.max(distance * 0.45, deepest * 0.6),
      centre.z + distance * 0.8,
    )

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(centre)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.49
    controls.update()

    // A drag that ends where it started is a tap; anything further is the
    // diver rotating the camera and must not drop a reading.
    const raycaster = new THREE.Raycaster()
    let downAt: { x: number; y: number } | null = null
    const TAP_SLOP_PX = 6
    const PICK_RADIUS_PX = 24

    function onPointerDown(e: PointerEvent) {
      downAt = { x: e.clientX, y: e.clientY }
    }

    function onPointerUp(e: PointerEvent) {
      const from = downAt
      downAt = null
      if (!onPick || !from) return
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > TAP_SLOP_PX) return

      const rect = renderer.domElement.getBoundingClientRect()
      const tapX = e.clientX - rect.left
      const tapY = e.clientY - rect.top

      // An existing reading wins if the tap is near one: correcting a value
      // somebody recorded is a different act from adding a new one.
      let nearest: THREE.Mesh | null = null
      let nearestPx = PICK_RADIUS_PX
      const projected = new THREE.Vector3()
      for (const marker of pickable) {
        projected.copy(marker.position).project(camera)
        if (projected.z > 1) continue
        const px = ((projected.x + 1) / 2) * rect.width
        const py = ((1 - projected.y) / 2) * rect.height
        const d = Math.hypot(px - tapX, py - tapY)
        if (d < nearestPx) {
          nearest = marker
          nearestPx = d
        }
      }
      if (nearest) {
        onPick({
          soundingId: nearest.userData.soundingId as string,
          at: { x: nearest.position.x, y: -nearest.position.z },
        })
        return
      }

      // Otherwise the tap lands on the seabed and snaps to the nearest metre.
      const ndc = new THREE.Vector2(
        (tapX / rect.width) * 2 - 1,
        -(tapY / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(mesh, false)[0]
      if (!hit) return
      const at = snapToLattice({ x: hit.point.x, y: -hit.point.z })
      onPick({ soundingId: latticeId(at), at })
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    // Keyboard traversal. Listening on the window rather than the canvas means
    // no click-to-focus dance, but it also means the depth field would eat a
    // "w" as a movement — hence the editable-target guard.
    const held = new Set<string>()
    const MOVE_KEYS: Record<string, [number, number]> = {
      w: [0, 1], arrowup: [0, 1],
      s: [0, -1], arrowdown: [0, -1],
      a: [-1, 0], arrowleft: [-1, 0],
      d: [1, 0], arrowright: [1, 0],
    }

    function isTyping(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null
      const tag = el?.tagName?.toLowerCase()
      return tag === 'input' || tag === 'select' || tag === 'textarea' || !!el?.isContentEditable
    }

    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase()
      if (!(key in MOVE_KEYS) || isTyping(e.target)) return
      held.add(key)
      // Arrow keys scroll the page otherwise, which fights the traversal.
      e.preventDefault()
    }
    function onKeyUp(e: KeyboardEvent) {
      held.delete(e.key.toLowerCase())
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    // Metres per second, scaled to the site: a fixed speed crawls across a
    // large site and overshoots a small one.
    const travelSpeed = Math.max(radius * 0.8, 20)
    const forward = new THREE.Vector3()
    const strafe = new THREE.Vector3()
    const travel = new THREE.Vector3()
    const UP = new THREE.Vector3(0, 1, 0)
    let last = performance.now()

    let frame = 0
    function animate() {
      frame = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      if (held.size) {
        camera.getWorldDirection(forward)
        forward.y = 0
        forward.normalize()
        strafe.copy(forward).cross(UP).normalize()
        travel.set(0, 0, 0)
        for (const key of held) {
          const [sx, sf] = MOVE_KEYS[key]
          travel.addScaledVector(forward, sf)
          travel.addScaledVector(strafe, sx)
        }
        if (travel.lengthSq() > 0) {
          travel.normalize().multiplyScalar(travelSpeed * dt)
          camera.position.add(travel)
          controls.target.add(travel)
        }
      }

      controls.update()

      // The compass rose turns with the camera. North in this scene is -z, so
      // the heading the camera looks along is atan2(dx, -dz); rotating the rose
      // by its negation puts north where it actually is on screen.
      if (roseRef.current) {
        const dx = controls.target.x - camera.position.x
        const dz = controls.target.z - camera.position.z
        const heading = Math.atan2(dx, -dz) * (180 / Math.PI)
        roseRef.current.setAttribute('transform', `rotate(${-heading})`)
      }

      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = mount.clientWidth || width
      camera.aspect = w / height
      camera.updateProjectionMatrix()
      renderer.setSize(w, height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      controls.dispose()
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const m = obj.material
          if (Array.isArray(m)) m.forEach(x => x.dispose())
          else m.dispose()
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [map, observed, surface, showBase, extent, height, supported, verticalExaggeration, onPick])

  if (!surface && !showBase) {
    return (
      <div className={`${CARD} p-6 text-center`}>
        <p className={TEXT_MUTED}>{t.siteMap.notEnoughSoundings}</p>
      </div>
    )
  }

  return (
    <figure className={`${CARD} overflow-hidden`}>
      {supported ? (
        <div className="relative">
          <div ref={mountRef} style={{ height }} className="w-full" />
          <svg
            viewBox="-64 -64 128 128"
            className="pointer-events-none absolute right-3 top-3 h-16 w-16 opacity-90"
            aria-hidden="true"
          >
            <circle r={52} fill="none" stroke="currentColor" strokeWidth={2} opacity={0.35} />
            {/* Rotated via the SVG transform attribute, not CSS: `transform-origin`
                on a <g> resolves against that group's own bounding box, which
                swings the rose off-axis instead of spinning it about the dial. */}
            <g ref={roseRef}>
              <path d="M 0 -34 L 9 2 L 0 10 L -9 2 Z" fill="#ff8a8a" />
              <path d="M 0 34 L 9 -2 L 0 -10 L -9 -2 Z" fill="currentColor" opacity={0.45} />
              <text x={0} y={-40} textAnchor="middle" fontSize={20} fontWeight="700" fill="currentColor">
                {t.siteMap.compassNorth}
              </text>
            </g>
          </svg>
        </div>
      ) : (
        <p className={`px-4 py-3 text-sm ${TEXT_MUTED}`}>{t.siteMap.webglUnavailable}</p>
      )}
      <figcaption className="space-y-1 px-4 py-3">
        <p className={`text-sm ${TEXT_HEADING}`}>{map.name}</p>
        <p className={`text-xs ${TEXT_MUTED}`}>
          {t.siteMap.drawnBy(map.provenance.author, map.provenance.year)}
        </p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>
          {datum === null || datum === 'unknown'
            ? t.siteMap.datumUnknown
            : datum === 'instantaneous'
              ? t.siteMap.datumInstantaneous
              : t.siteMap.datumNamed(datum)}
        </p>
        {map.provenance.note && (
          <p className={`text-xs ${TEXT_SUBTLE}`}>{map.provenance.note}</p>
        )}
        <p className={`text-xs ${TEXT_MUTED}`}>
          {surface ? t.siteMap.coverage(Math.round(coverage * 100)) : t.siteMap.scaffoldOnly}
        </p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.exaggeration(verticalExaggeration)}</p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.fadeLegend}</p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.schematicLegend}</p>
      </figcaption>
    </figure>
  )
}
