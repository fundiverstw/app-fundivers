import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  buildSurface, coverageFraction, SURFACE_DEFAULTS, type SurfaceOptions,
} from '../../lib/dive-site-surface'
import {
  isVolumetric, observedOnly, singleDatum,
  LATTICE_SPACING_M, type DiveSiteMap, type Vec2,
} from '../../lib/dive-site-map'
import { BASE_DEPTH_M, SITE_EXTENT_M } from '../../lib/site-seeds'
import type { GridHandle } from '../../lib/site-map-grid'
import {
  beginGrab, dragTo, movedGrab, nearestWithin, type Grab, type ScreenPoint,
} from '../../lib/site-map-grab'
import {
  travelDirection, travelForKey, travelSpeed, TRAVEL_RAMP_S, type Travel,
} from '../../lib/site-map-travel'
import { t } from '../../i18n'
import {
  BADGE_READOUT, BTN_XS_GHOST, CARD, OVERLAY_PANEL, PAD_KEY, PAD_KEY_WIDE,
  TEXT_HEADING, TEXT_MUTED, TEXT_SUBTLE,
} from '../../styles/tokens'

// The WebGL view. All arithmetic lives in lib/dive-site-surface.ts and
// lib/site-map-grab.ts, which are unit-tested; this file is the part that
// cannot be tested in a DOM without a GPU, so it is kept as thin as possible
// and fails to a readable message rather than a blank canvas when WebGL is
// unavailable.
//
// Three rendering decisions are load-bearing rather than cosmetic:
//
//  • The surface carries PER-VERTEX ALPHA from triangle confidence, so water
//    nobody has sounded is visibly missing instead of quietly interpolated.
//  • Volumetric features (arches, swim-throughs) are drawn as WIREFRAME
//    markers, never as solid surfaces. Their position is real; their shape is
//    schematic, and a solid mesh would imply a survey that has not happened.
//  • The renderer, camera and controls OUTLIVE the data. Rebuilding them when
//    a reading lands would throw the diver's viewpoint away after every pull:
//    they would drag a point, watch the view snap back to its default framing,
//    and have to fly back to where they were before pulling the next one. That
//    is what made a continuous gesture feel like a series of separate clicks.
//  • The camera may go UNDER the seabed and look up. A bathymetric viewer that
//    clamps at the horizon is showing a chart; a diver reads a site from
//    inside it, looking up at the surface to see where the light is and where
//    they got in. It is also the only angle from which a point pulled down a
//    long way is separable from the flat sheet it was pulled out of.

/** Green, which nothing else in the scene is: soundings are white, volumetric
 *  features amber, a held handle teal. An entry has to be findable at a glance
 *  from anywhere in the site. */
const ENTRY_COLOR = 0x86e08a

/**
 * How much of its own square metre a marker sphere may take up.
 *
 * The lattice is the thing being read. A ball sized to fill the space between
 * two handles hides the neighbours a diver is choosing between — which is the
 * one thing they need to see to aim at the right metre — and reads as a blob
 * of seabed rather than as a mark on it. Under a third of the spacing, a
 * marker sits inside its own cell with the grid still legible around it.
 */
const MARKER_OF_SPACING = 0.3

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
  /** The grabbable field. Absent means read-only: the scene draws no handles
   *  and every drag orbits the camera. */
  handles?: readonly GridHandle[]
  /** A handle being pulled. Fires continuously while the pointer moves and
   *  once more with `done`, so a caller can show the figure live and only
   *  record something when the diver lets go.
   *
   *  The scene moves the dot itself as the pointer moves rather than waiting
   *  to be told: a React render per frame would rebuild the handle field
   *  mid-gesture. */
  onHandleDrag?: (e: { id: string; at: Vec2; depth_m: number; done: boolean }) => void
  /** What taking hold of a handle means. `pull` drags it to a depth; `mark`
   *  designates the position and leaves the depth alone. A mode, and named
   *  one, because designating where you get into the water and measuring how
   *  deep it is there are different acts on the same point of seabed. */
  gesture?: HandleGesture
  /** A handle marked while `gesture` is `mark`. Toggling is the caller's job:
   *  the scene reports the tap, the draft decides what it means. */
  onHandleMark?: (handle: GridHandle) => void
  /** Vertical exaggeration. A dive site is tens of meters deep across hundreds
   *  of meters wide, so at true scale the relief that matters to a diver — the
   *  drop-off, the ridge, the gully — flattens into nothing. Exaggerating is
   *  standard practice for bathymetry; the figure is stated in the caption so
   *  nobody reads the slope as a real gradient. */
  verticalExaggeration?: number
}

/** What taking hold of a handle does. */
export type HandleGesture = 'pull' | 'mark'

/**
 * How far down the depth rings go on a site with nothing measured on it.
 *
 * The camera can now descend past the seabed, and water with no marks in it
 * gives no sense of how far it has gone. Forty metres is where recreational
 * diving stops, so it is the column worth drawing whether or not anybody has
 * recorded a depth in it yet.
 */
const WATER_COLUMN_M = 40

/** What survives a data change: the view a diver has arranged for themselves. */
interface Rig {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  /** Everything derived from the map — cleared and rebuilt when it changes. */
  content: THREE.Group
  /** The grabbable field, rebuilt on its own so a pull does not touch the
   *  surface underneath it. */
  handleLayer: THREE.Group
  /** Meters per second of keyboard travel, scaled to the site by the content. */
  travelSpeed: number
  /** Half-width of the drawn site, for sizing markers against it. */
  radius: number
  /** Middle of the drawn ground, and the y the deepest reading sits at — what
   *  a viewpoint button needs to put the camera somewhere worth being. */
  center: THREE.Vector3
  floorY: number
  /** Directions currently being asked for. Held on the rig rather than in the
   *  effect's closure because the on-screen pad presses the same set the
   *  keyboard does, and one loop moves the camera for both. */
  held: Set<Travel>
}

/** Metres between the drawn handles, read off the field itself rather than
 *  recomputed from bounds — what is on screen is what gets labelled. */
function handleSpacingOf(handles?: readonly GridHandle[]): number {
  if (!handles || handles.length < 2) return LATTICE_SPACING_M
  const xs = [...new Set(handles.map(h => h.at.x))].sort((a, b) => a - b)
  let min = Infinity
  for (let i = 1; i < xs.length; i++) min = Math.min(min, xs[i] - xs[i - 1])
  return Number.isFinite(min) ? min : LATTICE_SPACING_M
}

/**
 * Metres between the lattice dots a read-only site draws.
 *
 * The lattice is 1 m and implicit, so a 500 m site holds a quarter of a
 * million positions — undrawable. Only a subset is shown, thinned by whatever
 * step keeps the count near LATTICE_DOTS_MAX, and the caption states the true
 * spacing so the drawing is never mistaken for the resolution.
 */
const LATTICE_DOTS_MAX = 4000
function latticeStep(extent_m: number): number {
  const stepsAcross = Math.max(1, Math.floor((extent_m * 2) / LATTICE_SPACING_M))
  return Math.max(
    LATTICE_SPACING_M,
    Math.ceil(stepsAcross / Math.sqrt(LATTICE_DOTS_MAX)) * LATTICE_SPACING_M,
  )
}

/** Free a subtree's GPU memory. Points and lines hold buffers exactly as
 *  meshes do, and content is rebuilt often enough that leaking them shows. */
function disposeSubtree(root: THREE.Object3D) {
  root.traverse(obj => {
    const holder = obj as unknown as {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    holder.geometry?.dispose()
    const m = holder.material
    if (Array.isArray(m)) m.forEach(x => x.dispose())
    else m?.dispose()
  })
}

function clearGroup(group: THREE.Group) {
  disposeSubtree(group)
  group.clear()
}

export function DiveSiteScene({
  map, options, height = 420, verticalExaggeration = 3, handles, onHandleDrag,
  gesture = 'pull', onHandleMark,
}: DiveSiteSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const roseRef = useRef<SVGGElement | null>(null)
  const badgeRef = useRef<HTMLDivElement | null>(null)
  const rigRef = useRef<Rig | null>(null)
  // What the camera was last framed on. Reframing on any data change would
  // yank the view every time a point was pulled; reframing on nothing would
  // leave newly extended ground off screen with no way to find it.
  const framedRef = useRef('')
  const supported = hasWebGL()

  // Scaffold is not data: a placeholder contour must never lend the surface
  // coverage it has not earned.
  const observed = useMemo(() => observedOnly(map), [map])
  const surface = useMemo(() => buildSurface(observed, options), [observed, options])
  // Frame on what is actually there. A site is one small patch extended in the
  // direction the diver swam, so a stored 500 m extent would put a 20 m patch
  // in the middle of an empty sea — while editing AND while reading.
  const reach = (handles?.length
    ? handles.map(h => Math.max(Math.abs(h.at.x), Math.abs(h.at.y)))
    : observed.soundings.map(sd => Math.max(Math.abs(sd.at.x), Math.abs(sd.at.y))))
  const extent = reach.length
    ? Math.max(...reach, LATTICE_SPACING_M)
    : map.extent_m ?? SITE_EXTENT_M
  // Three readings that produced no triangles is a different problem from not
  // having three, and saying "three are needed" to someone who has four is
  // both wrong and a dead end.
  const wontJoin = !surface && observed.soundings.length >= 3
  // Stated, never assumed. A field thinned because the site outgrew what can be
  // drawn still has to say what its dots are worth, or a diver reads a reading
  // as landing somewhere it does not.
  const handleStep = handleSpacingOf(handles)
  const coverage = surface ? coverageFraction(surface.triangles) : 0
  const datum = singleDatum(observed)
  const editable = !!handles

  /**
   * Put the camera somewhere worth being, in one press.
   *
   * Orbiting to a useful angle by hand is a chore on a site that is mostly
   * flat water, and getting under the seabed to look up — now that the clamp
   * is gone — means dragging past the horizon and hoping. These are the two
   * angles the view is actually read from: the plan, and the diver's.
   */
  const viewFrom = useCallback((where: 'above' | 'seabed') => {
    const rig = rigRef.current
    if (!rig) return
    const { camera, controls, center, radius, floorY } = rig
    if (where === 'above') {
      const distance = Math.max(radius * 2.2, 30)
      camera.position.set(center.x, distance, center.z + distance * 0.35)
      controls.target.set(center.x, floorY, center.z)
    } else {
      // Just off the bottom, and always under the water however flat the site
      // is: an eye level at sea level on an unedited site would look along the
      // surface rather than up at it.
      const eye = Math.min(floorY + Math.max(radius * 0.08, 1), -Math.max(radius * 0.1, 2))
      camera.position.set(center.x, eye, center.z + Math.max(radius * 0.5, 6))
      controls.target.set(center.x, 0, center.z)
    }
    controls.update()
  }, [])

  // The pad presses the same directions the keyboard does. Held on the rig, so
  // a press survives every re-render the editor does underneath it.
  const press = useCallback((dir: Travel) => { rigRef.current?.held.add(dir) }, [])
  const release = useCallback((dir: Travel) => { rigRef.current?.held.delete(dir) }, [])

  /** One key of the pad. Held rather than clicked — travel is a thing you do
   *  for a while — with the keyboard equivalent wired to the same hold, so it
   *  is not a control only a mouse can work. */
  function padKey(dir: Travel, content: string, shape: string, label?: string) {
    return (
      <button
        type="button"
        aria-label={label}
        className={shape}
        onPointerDown={e => {
          // Captured, or a finger that slides off the key never reports its
          // release and the camera keeps going.
          e.currentTarget.setPointerCapture(e.pointerId)
          press(dir)
        }}
        onPointerUp={() => release(dir)}
        onPointerCancel={() => release(dir)}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') press(dir) }}
        onKeyUp={() => release(dir)}
        onBlur={() => release(dir)}
      >
        {content}
      </button>
    )
  }

  // The rig: built once, and outliving every reading placed in it.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !supported) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    const width = mount.clientWidth || 640
    renderer.setSize(width, mount.clientHeight || 420)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const content = new THREE.Group()
    const handleLayer = new THREE.Group()
    scene.add(content, handleLayer)

    scene.add(new THREE.AmbientLight(0xffffff, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(60, 120, 60)
    scene.add(key)

    const FOV = 50
    const camera = new THREE.PerspectiveCamera(FOV, width / (mount.clientHeight || 420), 0.1, 8000)
    camera.position.set(40, 40, 60)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // The whole sphere, less a sliver at each pole. The old ceiling of 0.49pi
    // stopped the camera at the horizon, which meant a diver could never get
    // under the seabed and look up at the surface — the angle this is read
    // from in the water, and the one that separates a point pulled down from
    // the flat sheet above it. The slivers are kept back because at exactly
    // straight up or straight down the up-vector flips and the view rolls.
    controls.minPolarAngle = Math.PI * 0.02
    controls.maxPolarAngle = Math.PI * 0.98
    controls.update()

    const rig: Rig = {
      renderer, scene, camera, controls, content, handleLayer,
      travelSpeed: 20, radius: 30,
      center: new THREE.Vector3(), floorY: 0,
      held: new Set(),
    }
    rigRef.current = rig

    // Keyboard traversal. Listening on the window rather than the canvas means
    // no click-to-focus dance, but it also means the depth field would eat a
    // "w" as a movement — hence the editable-target guard.
    const held = rig.held

    function isTyping(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null
      const tag = el?.tagName?.toLowerCase()
      return tag === 'input' || tag === 'select' || tag === 'textarea' || !!el?.isContentEditable
    }

    function onKeyDown(e: KeyboardEvent) {
      const dir = travelForKey(e.key)
      if (!dir || isTyping(e.target)) return
      held.add(dir)
      // Arrow keys scroll the page otherwise, which fights the traversal.
      e.preventDefault()
    }
    function onKeyUp(e: KeyboardEvent) {
      const dir = travelForKey(e.key)
      if (dir) held.delete(dir)
    }
    // A key held while the window loses focus never reports its release, and
    // the camera flies off on its own until something else is pressed.
    function onBlur() {
      held.clear()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    const forward = new THREE.Vector3()
    const strafe = new THREE.Vector3()
    const travel = new THREE.Vector3()
    let last = performance.now()
    let frame = 0
    // Seconds of unbroken travel, which is what the speed ramp is measured on.
    let travelling = 0

    function animate() {
      frame = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      if (held.size) {
        // Forward follows the whole look direction, pitch included. Flattening
        // it made W a pan across the site and left no way to swim down but the
        // dedicated keys; pointing the camera at the bottom and holding one is
        // how a diver descends, and now how the camera does.
        camera.getWorldDirection(forward)
        // Strafe comes off the camera's own right vector rather than off
        // `forward`, which vanishes when you look straight down — and is
        // flattened, so left and right never roll the horizon.
        strafe.setFromMatrixColumn(camera.matrix, 0)
        strafe.y = 0
        if (strafe.lengthSq() < 1e-6) strafe.set(1, 0, 0)
        strafe.normalize()

        const heading = travelDirection(held, forward, strafe)
        travel.set(heading.x, heading.y, heading.z)
        if (travel.lengthSq() > 0) {
          travelling = Math.min(travelling + dt, TRAVEL_RAMP_S)
          travel.multiplyScalar(travelSpeed(rig.travelSpeed, travelling) * dt)
          camera.position.add(travel)
          controls.target.add(travel)
        } else {
          travelling = 0
        }
      } else {
        travelling = 0
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
      const h = mount.clientHeight || 420
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      controls.dispose()
      disposeSubtree(scene)
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      rigRef.current = null
      framedRef.current = ''
    }
  }, [supported])

  // The canvas follows the height it was given without rebuilding the rig.
  useEffect(() => {
    const rig = rigRef.current
    const mount = mountRef.current
    if (!rig || !mount) return
    const w = mount.clientWidth || 640
    rig.camera.aspect = w / height
    rig.camera.updateProjectionMatrix()
    rig.renderer.setSize(w, height)
  }, [height, supported])

  // Everything the map says. Rebuilt when a reading lands; the viewpoint is not.
  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    const { content, camera, controls } = rig
    clearGroup(content)

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
        -e, baseY, -e, e, baseY, -e, e, baseY, e, -e, baseY, e,
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

    content.add(new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.85,
        metalness: 0.05,
        flatShading: true,
        // The unedited site is one flat sheet at the surface with every handle
        // sitting in it, so a sheet that writes depth hides the first point
        // anybody pulls down behind the thing they pulled it out of. Once
        // readings exist the surface is drawn from them and there is nothing
        // above the seabed to hide anything.
        depthWrite: !!surface,
      }),
    ))
    content.add(new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.08 }),
    ))

    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new THREE.Box3()
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.z) / 2 || 30
    rig.radius = radius
    rig.center.copy(center)
    rig.floorY = box.min.y
    // Meters per second, scaled to the site: a fixed speed crawls across a
    // large site and overshoots a small one.
    rig.travelSpeed = Math.max(radius * 0.8, 20)

    // Sea level, drawn.
    //
    // Every depth on this map is measured down from it and every handle starts
    // on it, so it is the one plane in the scene that is not an inference —
    // and until it was drawn, looking up from the seabed showed nothing at
    // all. Lifted a hair above zero because the unedited seabed sits exactly
    // at zero too, and two coplanar surfaces flicker against each other.
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 4, radius * 4),
      new THREE.MeshBasicMaterial({
        color: 0x8fd8f0,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    water.rotation.x = -Math.PI / 2
    water.position.set(center.x, 0.02, center.z)
    content.add(water)

    // Depth posts every 10 m, dropped from the surface, so "how deep is this"
    // is answerable by eye instead of by legend.
    //
    // They go on past the deepest reading, down a full recreational water
    // column. The camera can descend below the seabed now, and black water
    // with no marks in it says nothing about how far it has gone — on a site
    // nobody has measured, these rings are the only depth cue there is.
    const deepest = -(box.min.y)
    const ringFloor = Math.max(deepest, WATER_COLUMN_M * verticalExaggeration)
    for (let d = 10 * verticalExaggeration; d <= ringFloor; d += 10 * verticalExaggeration) {
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 33 }, (_, i) => {
            const a = (i / 32) * Math.PI * 2
            return new THREE.Vector3(Math.cos(a) * radius * 1.15, -d, Math.sin(a) * radius * 1.15)
          }),
        ),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }),
      )
      ring.position.set(center.x, 0, center.z)
      content.add(ring)
    }

    // Metres between the dots that are actually on screen: the editing field's
    // own spacing, or the thinned lattice a read-only site draws. Everything
    // marked on the seabed is sized against this rather than against the site,
    // so a marker means the same thing on a 20 m patch and a 500 m coastline.
    const drawnSpacing = editable ? handleStep : latticeStep(extent)

    // Contributed readings are individual markers — there are few of them.
    const markerRadius = drawnSpacing * MARKER_OF_SPACING
    for (const s of observed.soundings) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(markerRadius, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
      )
      marker.position.set(s.at.x, -s.depth_m * verticalExaggeration, -s.at.y)
      content.add(marker)
    }

    // The lattice is drawn, not stored — see `latticeStep`, which is what
    // thins it. Suppressed while editing: the grabbable field sits at the
    // depth each point actually holds, and a second lattice flat on the base
    // plane underneath it reads as a second seabed.
    if (!editable) {
      const latticeSpan = extent * 2
      const dots: THREE.Vector3[] = []
      for (let x = -extent; x <= extent; x += drawnSpacing) {
        for (let y = -extent; y <= extent; y += drawnSpacing) {
          dots.push(new THREE.Vector3(x, baseY, -y))
        }
      }
      if (dots.length) {
        content.add(new THREE.Points(
          new THREE.BufferGeometry().setFromPoints(dots),
          new THREE.PointsMaterial({
            color: 0xbcd4e2,
            size: Math.max(latticeSpan * 0.004, 0.5),
            transparent: true,
            opacity: 0.55,
            sizeAttenuation: true,
          }),
        ))
      }
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
      content.add(marker)
    }

    // Ways into the water, drawn at the surface with a line dropped to the
    // seabed under them.
    //
    // At the surface because that is where an entry is: it is the step, the
    // slipway or the gap in the rocks you climb down, not a place on the
    // bottom. The drop line is what makes it legible from underneath — from
    // the seabed looking up, an entry is the one mark that says which patch of
    // bright water overhead is the one you came in through.
    const entryRadius = Math.max(radius * 0.05, 1.2)
    for (const entry of observed.entries) {
      const below = observed.soundings.reduce<{ d: number; depth: number }>((best, sd) => {
        const d = Math.hypot(sd.at.x - entry.at.x, sd.at.y - entry.at.y)
        return d < best.d ? { d, depth: sd.depth_m } : best
      }, { d: Infinity, depth: 0 })

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(entryRadius, entryRadius * 0.16, 8, 24),
        new THREE.MeshBasicMaterial({ color: ENTRY_COLOR, transparent: true, opacity: 0.95 }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(entry.at.x, 0.05, -entry.at.y)
      content.add(ring)

      const drop = below.depth * verticalExaggeration
      if (drop > 0.1) {
        content.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(entry.at.x, 0, -entry.at.y),
            new THREE.Vector3(entry.at.x, -drop, -entry.at.y),
          ]),
          new THREE.LineBasicMaterial({ color: ENTRY_COLOR, transparent: true, opacity: 0.5 }),
        ))
      }
    }

    // Frame on the ground, not on the readings. Pulling a point changes what
    // the seabed looks like but not how far the site reaches, so the view holds
    // still through a whole session of pulling; asking for more ground is an
    // explicit act, and it moves the camera to show what was asked for.
    const frameKey = `${map.id}:${extent}`
    if (framedRef.current !== frameKey) {
      framedRef.current = frameKey
      const span = Math.max(size.x, size.z, size.y, 1)
      const fit = (span / 2) / Math.tan((camera.fov * Math.PI) / 360)
      const distance = fit * 1.45
      camera.position.set(
        center.x + distance * 0.45,
        Math.max(distance * 0.45, deepest * 0.6),
        center.z + distance * 0.8,
      )
      camera.far = Math.max(radius * 40, 1000)
      camera.updateProjectionMatrix()
      controls.target.copy(center)
      controls.update()
    }
  }, [supported, map.id, observed, surface, extent, editable, handleStep, verticalExaggeration])

  // The grabbable field, and the gesture that pulls it.
  //
  // A drag that starts ON a handle moves that handle; a drag that starts
  // anywhere else orbits the camera. No mode switch, because the handles are
  // drawn: you can see what is grabbable, and empty water is for looking
  // around. It is how Blender behaves for the same reason — you take hold of a
  // vertex, or you move the view.
  useEffect(() => {
    const rig = rigRef.current
    const mount = mountRef.current
    if (!rig || !mount) return
    const { handleLayer, camera, controls, renderer } = rig
    clearGroup(handleLayer)

    const field = handles ?? []
    if (!field.length || !(onHandleDrag || onHandleMark)) return

    const positions = new Float32Array(field.length * 3)
    const colors = new Float32Array(field.length * 3)
    field.forEach((h, i) => {
      positions[i * 3] = h.at.x
      positions[i * 3 + 1] = -h.depth_m * verticalExaggeration
      positions[i * 3 + 2] = -h.at.y
      // Scaffold is drawn faintly and measured points brightly, so what
      // somebody actually recorded is never confused with the flat field it is
      // sitting in.
      const tone = h.measured ? 1 : 0.42
      colors[i * 3] = tone
      colors[i * 3 + 1] = tone
      colors[i * 3 + 2] = h.measured ? tone : 0.55
    })

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const cloud = new THREE.Points(geom, new THREE.PointsMaterial({
      size: Math.max(rig.radius * 0.02, 0.45),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
    }))
    handleLayer.add(cloud)

    // The point under the finger, ringed so a grab is visibly a grab. Without
    // it a drag is indistinguishable from a failed one until the depth
    // changes, which is most of what made this feel like clicking.
    const spacing = handleSpacingOf(field)
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(spacing * MARKER_OF_SPACING, 0.15), 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x7fe3d0, transparent: true, opacity: 0.85 }),
    )
    marker.visible = false
    handleLayer.add(marker)

    const dom = renderer.domElement
    const screen: ScreenPoint[] = field.map(() => ({ x: 0, y: 0, behind: false }))
    const projected = new THREE.Vector3()
    const grabbedPoint = new THREE.Vector3()

    const PICK_RADIUS_PX = 26
    /** Hover picking runs on pointer movement; once every few frames is enough
     *  for a cursor and costs nothing on a field of thousands. */
    const HOVER_INTERVAL_MS = 40

    let grab: Grab | null = null
    let grabbedIndex = -1
    let hoveredIndex = -1
    let lastHover = 0

    function projectField() {
      const rect = dom.getBoundingClientRect()
      for (let i = 0; i < field.length; i++) {
        projected.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).project(camera)
        screen[i].behind = projected.z > 1
        screen[i].x = ((projected.x + 1) / 2) * rect.width
        screen[i].y = ((1 - projected.y) / 2) * rect.height
      }
    }

    function pointerAt(e: PointerEvent): { px: number; py: number } {
      const rect = dom.getBoundingClientRect()
      return { px: e.clientX - rect.left, py: e.clientY - rect.top }
    }

    function showMarker(index: number, held: boolean) {
      if (index < 0) {
        marker.visible = false
        return
      }
      marker.position.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2])
      marker.visible = true
      const material = marker.material as THREE.MeshBasicMaterial
      material.color.setHex(held ? 0xffd27f : 0x7fe3d0)
      material.opacity = held ? 0.95 : 0.6
    }

    function showBadge(depth_m: number, px: number, py: number) {
      const badge = badgeRef.current
      if (!badge) return
      badge.textContent = t.siteMap.depthReadout(depth_m)
      badge.style.transform = `translate(${Math.round(px) + 14}px, ${Math.round(py) - 30}px)`
      badge.hidden = false
    }

    function hideBadge() {
      if (badgeRef.current) badgeRef.current.hidden = true
    }

    /** How many meters of depth one pixel of drag is worth, at the distance
     *  the grabbed point sits from the camera. Fixed pixels-to-meters would
     *  make a zoomed-out pull unusably coarse and a zoomed-in one unusably
     *  fine. */
    function metersPerPixel(point: THREE.Vector3, heightPx: number): number {
      const distance = camera.position.distanceTo(point)
      const worldHeight = 2 * distance * Math.tan((camera.fov * Math.PI) / 360)
      return worldHeight / heightPx / verticalExaggeration
    }

    function moveHandle(index: number, depth_m: number) {
      positions[index * 3 + 1] = -depth_m * verticalExaggeration
      geom.attributes.position.needsUpdate = true
      marker.position.y = positions[index * 3 + 1]
    }

    function onPointerDown(e: PointerEvent) {
      const { px, py } = pointerAt(e)
      projectField()
      const index = nearestWithin(screen, px, py, PICK_RADIUS_PX)
      if (index < 0) return

      if (gesture === 'mark') {
        // A tap, not a drag: an entry is a place, and there is nothing to pull
        // it to. Swallowed all the same, or the same gesture also orbits.
        e.stopPropagation()
        e.preventDefault()
        onHandleMark?.(field[index])
        return
      }

      grabbedIndex = index
      grab = beginGrab(field[index], e.clientY)
      showMarker(index, true)
      showBadge(grab.depth_m, px, py)
      dom.style.cursor = 'grabbing'
      // Swallowed rather than merely disabling the controls: OrbitControls is
      // attached to the same canvas and was constructed first, so by the time
      // a listener on the canvas could disable it, it has already taken the
      // gesture. Capturing on the wrapper gets there first.
      e.stopPropagation()
      e.preventDefault()
      controls.enabled = false
      dom.setPointerCapture(e.pointerId)
    }

    function onPointerMove(e: PointerEvent) {
      const { px, py } = pointerAt(e)

      if (grab && grabbedIndex >= 0) {
        const rect = dom.getBoundingClientRect()
        grabbedPoint.set(
          positions[grabbedIndex * 3],
          positions[grabbedIndex * 3 + 1],
          positions[grabbedIndex * 3 + 2],
        )
        grab = dragTo(grab, e.clientY, metersPerPixel(grabbedPoint, rect.height))
        moveHandle(grabbedIndex, grab.depth_m)
        showBadge(grab.depth_m, px, py)
        onHandleDrag?.({ id: grab.id, at: grab.at, depth_m: grab.depth_m, done: false })
        e.stopPropagation()
        return
      }

      const now = performance.now()
      if (now - lastHover < HOVER_INTERVAL_MS) return
      lastHover = now
      projectField()
      const index = nearestWithin(screen, px, py, PICK_RADIUS_PX)
      if (index === hoveredIndex) return
      hoveredIndex = index
      showMarker(index, false)
      dom.style.cursor = index < 0 ? '' : gesture === 'mark' ? 'crosshair' : 'grab'
    }

    function endGrab(e: PointerEvent) {
      if (!grab || grabbedIndex < 0) return
      const finished = grab
      const index = grabbedIndex
      grab = null
      grabbedIndex = -1
      hoveredIndex = -1
      controls.enabled = true
      marker.visible = false
      hideBadge()
      dom.style.cursor = ''
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId)
      // A grab that said nothing leaves no trace: every mis-tap while orbiting
      // would otherwise become a reading with somebody's name on it.
      if (!movedGrab(finished)) {
        moveHandle(index, finished.from_m)
        return
      }
      onHandleDrag?.({ id: finished.id, at: finished.at, depth_m: finished.depth_m, done: true })
    }

    function onPointerLeave() {
      if (grab) return
      hoveredIndex = -1
      marker.visible = false
      dom.style.cursor = ''
    }

    mount.addEventListener('pointerdown', onPointerDown, true)
    mount.addEventListener('pointermove', onPointerMove, true)
    mount.addEventListener('pointerup', endGrab, true)
    // A pointer that leaves the window mid-drag must not strand the camera
    // disabled with a point stuck under a finger that is no longer there.
    mount.addEventListener('pointercancel', endGrab, true)
    mount.addEventListener('pointerleave', onPointerLeave)

    return () => {
      mount.removeEventListener('pointerdown', onPointerDown, true)
      mount.removeEventListener('pointermove', onPointerMove, true)
      mount.removeEventListener('pointerup', endGrab, true)
      mount.removeEventListener('pointercancel', endGrab, true)
      mount.removeEventListener('pointerleave', onPointerLeave)
      controls.enabled = true
      dom.style.cursor = ''
      hideBadge()
      clearGroup(handleLayer)
    }
  }, [supported, handles, onHandleDrag, onHandleMark, gesture, verticalExaggeration])

  return (
    <figure className={`${CARD} overflow-hidden`}>
      {supported ? (
        <div className="relative">
          <div ref={mountRef} style={{ height }} className="w-full" />
          <div
            ref={badgeRef}
            hidden
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 top-0 ${BADGE_READOUT}`}
          />
          {/* Named in one word each, with the sentence in the label. Spelled
              out — "From the seabed" — the pair ran under the compass rose at
              320 px, which is the width this is most likely to be read at. */}
          <div
            className={`absolute left-3 top-3 flex gap-1 ${OVERLAY_PANEL}`}
            role="group"
            aria-label={t.siteMap.viewpointAria}
          >
            <button
              type="button"
              className={BTN_XS_GHOST}
              aria-label={t.siteMap.viewFromAboveAria}
              onClick={() => viewFrom('above')}
            >
              {t.siteMap.viewFromAbove}
            </button>
            <button
              type="button"
              className={BTN_XS_GHOST}
              aria-label={t.siteMap.viewFromSeabedAria}
              onClick={() => viewFrom('seabed')}
            >
              {t.siteMap.viewFromSeabed}
            </button>
          </div>
          <div
            className={`absolute bottom-3 left-3 flex items-end gap-2 ${OVERLAY_PANEL}`}
            role="group"
            aria-label={t.siteMap.padAria}
          >
            <div className="grid grid-cols-3 gap-1">
              <span />
              {padKey('forward', '\u25B2', PAD_KEY, t.siteMap.padForward)}
              <span />
              {padKey('left', '\u25C0', PAD_KEY, t.siteMap.padLeft)}
              <span />
              {padKey('right', '\u25B6', PAD_KEY, t.siteMap.padRight)}
              <span />
              {padKey('back', '\u25BC', PAD_KEY, t.siteMap.padBack)}
              <span />
            </div>
            {/* Worded rather than arrowed: a triangle beside four other
                triangles reads as another way to swim along the bottom, and
                this pair is the one that changes how deep you are. */}
            <div className="grid gap-1">
              {padKey('up', t.siteMap.padUp, PAD_KEY_WIDE)}
              {padKey('down', t.siteMap.padDown, PAD_KEY_WIDE)}
            </div>
          </div>
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
        {!!observed.entries.length && (
          <p className={`text-xs ${TEXT_MUTED}`}>{t.siteMap.entriesMarked(observed.entries.length)}</p>
        )}
        {!!handles?.length && (
          <p className={`text-xs ${TEXT_MUTED}`}>{t.siteMap.handleSpacing(handleStep)}</p>
        )}
        {!surface && (
          <p className={`text-xs ${TEXT_MUTED}`}>
            {wontJoin
              ? t.siteMap.soundingsWontJoin(SURFACE_DEFAULTS.cutoffEdge_m)
              : t.siteMap.notEnoughSoundings}
          </p>
        )}
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
        <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.seaLevelLegend}</p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.travelLegend}</p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.fadeLegend}</p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.schematicLegend}</p>
      </figcaption>
    </figure>
  )
}
