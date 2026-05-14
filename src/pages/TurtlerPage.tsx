import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Frogger, where the frog is a turtle. Route /minigame/turtler, rendered
// fullscreen (outside the regular shells) so the canvas isn't squeezed by
// the bottom nav.
//
// Layout (top → bottom):
//   row 0     home slots — land on a slot scores, grass between is deadly
//   rows 1–4  river — must be riding a log or turtle pad; water = death
//   row 5     shore — safe
//   rows 6–9  road — avoid cars
//   row 10    start — safe grass; player spawns here
//
// Controls: arrow / WASD on desktop (single-tap moves one cell), D-pad on
// mobile. Diagonals don't exist — every move snaps to a grid neighbour.

const COLS = 11
const ROWS = 11
const HOME_ROW = 0
const HOME_SLOT_X = [1, 3, 5, 7, 9]   // x cells where landing scores
const RIVER_ROWS = [1, 2, 3, 4]
const SHORE_ROW = 5
const ROAD_ROWS = [6, 7, 8, 9]
const START_ROW = 10
const START_X = 5
const LIVES_START = 3
const SPEEDUP_PER_WAVE = 0.5

type Phase = 'idle' | 'playing' | 'gameover'
type Dir = 'up' | 'down' | 'left' | 'right'

interface Obstacle { x: number; len: number }
interface Lane {
  y: number
  speed: number      // cells / sec (always positive)
  dir: 1 | -1        // +1 = rightward
  kind: 'log' | 'turtle' | 'car'
  obstacles: Obstacle[]
  trackLen: number   // wrap distance
}

function makeLane(y: number, speed: number, dir: 1 | -1, kind: Lane['kind'], sizes: number[]): Lane {
  const total = sizes.reduce((a, b) => a + b, 0)
  // Leave roughly half-a-board worth of empty road between obstacles so the
  // player has gaps to slip through. Track length is the world before wrap.
  const gap = Math.max(2, Math.floor((COLS + 2 - total) / sizes.length))
  const trackLen = total + gap * sizes.length
  let cursor = 0
  const obstacles: Obstacle[] = sizes.map(len => {
    const o = { x: cursor, len }
    cursor += len + gap
    return o
  })
  return { y, speed, dir, kind, obstacles, trackLen }
}

function makeLanes(speedMult: number): Lane[] {
  return [
    makeLane(1, 1.6 * speedMult, -1, 'log',    [3, 4]),
    makeLane(2, 2.2 * speedMult,  1, 'turtle', [3, 3, 3]),
    makeLane(3, 1.4 * speedMult, -1, 'log',    [4, 3]),
    makeLane(4, 2.6 * speedMult,  1, 'log',    [2, 3, 2]),
    makeLane(6, 2.0 * speedMult, -1, 'car',    [1, 1, 1]),
    makeLane(7, 3.0 * speedMult,  1, 'car',    [1, 2]),
    makeLane(8, 1.5 * speedMult, -1, 'car',    [2, 1]),
    makeLane(9, 3.6 * speedMult,  1, 'car',    [1, 1, 1]),
  ]
}

// Wrap an obstacle x back into [-margin, trackLen-margin] so it loops
// continuously off-screen instead of vanishing. The visual rendering
// further wraps to keep it visible at the canvas edge as it crosses.
function advance(o: Obstacle, lane: Lane, dt: number) {
  o.x += lane.dir * lane.speed * dt
  if (lane.dir > 0 && o.x >= lane.trackLen) o.x -= lane.trackLen
  if (lane.dir < 0 && o.x + o.len < 0)     o.x += lane.trackLen
}

// True if the player cell (x, y) is currently sitting on `o` (left edge x,
// length len). Lanes can wrap, so test against both o.x and o.x ± trackLen.
function overlapsObstacle(playerX: number, o: Obstacle, trackLen: number): boolean {
  for (const off of [0, -trackLen, trackLen]) {
    const left = o.x + off
    if (playerX + 1 > left && playerX < left + o.len) return true
  }
  return false
}

export function TurtlerPage() {
  const { profile } = useAuth()
  const backTo = profile?.role === 'admin' ? '/admin'
    : profile?.role === 'staff' ? '/admin/events'
    : '/dashboard'

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(LIVES_START)
  const [homes, setHomes] = useState<boolean[]>(() => HOME_SLOT_X.map(() => false))
  const [high, setHigh] = useState<number>(() => Number(localStorage.getItem('turtler-high') ?? 0))

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellPxRef = useRef(28)
  const gameRef = useRef<{
    px: number       // player x, float (can ride logs)
    py: number       // player y, integer row
    lanes: Lane[]
    homes: boolean[]
    deepestRow: number  // smallest y reached this life — for advance bonuses
    score: number
    lives: number
    speedMult: number
    lastTs: number
    deathFlash: number  // seconds remaining of post-death freeze
  }>({
    px: START_X,
    py: START_ROW,
    lanes: makeLanes(1),
    homes: HOME_SLOT_X.map(() => false),
    deepestRow: START_ROW,
    score: 0,
    lives: LIVES_START,
    speedMult: 1,
    lastTs: 0,
    deathFlash: 0,
  })
  const rafRef = useRef(0)

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const maxPx = Math.min(window.innerWidth - 24, window.innerHeight - 340, 440)
    const cell = Math.max(20, Math.floor(maxPx / COLS))
    cellPxRef.current = cell
    const dpr = window.devicePixelRatio || 1
    const wPx = cell * COLS
    const hPx = cell * ROWS
    canvas.width = wPx * dpr
    canvas.height = hPx * dpr
    canvas.style.width = `${wPx}px`
    canvas.style.height = `${hPx}px`
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const c = cellPxRef.current
    const g = gameRef.current

    // Row-by-row background.
    for (let y = 0; y < ROWS; y++) {
      let fill = '#1f2937' // default
      if (y === HOME_ROW)              fill = '#14532d' // bank
      else if (RIVER_ROWS.includes(y)) fill = '#0c4a6e' // river
      else if (y === SHORE_ROW)        fill = '#7c4a1d' // shore
      else if (ROAD_ROWS.includes(y))  fill = '#1f2937' // road
      else if (y === START_ROW)        fill = '#15803d' // grass
      ctx.fillStyle = fill
      ctx.fillRect(0, y * c, COLS * c, c)
    }

    // Road lane dividers.
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)'
    ctx.lineWidth = 1
    ctx.setLineDash([c * 0.35, c * 0.35])
    for (const y of ROAD_ROWS) {
      if (y === ROAD_ROWS[0]) continue
      ctx.beginPath()
      ctx.moveTo(0, y * c); ctx.lineTo(COLS * c, y * c)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // Home row: grass + water slots cut into the bank.
    for (let i = 0; i < HOME_SLOT_X.length; i++) {
      const sx = HOME_SLOT_X[i] * c
      if (g.homes[i]) {
        // Filled slot — small turtle icon.
        ctx.fillStyle = '#14532d'
        ctx.fillRect(sx, 0, c, c)
        ctx.fillStyle = '#84cc16'
        ctx.beginPath()
        ctx.arc(sx + c / 2, c / 2, c * 0.32, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#365314'
        for (const dx of [-0.18, 0.18]) for (const dy of [-0.18, 0.18]) {
          ctx.beginPath(); ctx.arc(sx + c / 2 + c * dx, c / 2 + c * dy, c * 0.08, 0, Math.PI * 2); ctx.fill()
        }
      } else {
        ctx.fillStyle = '#0c4a6e'
        ctx.fillRect(sx, 0, c, c)
      }
    }

    // Obstacles in each lane.
    for (const lane of g.lanes) {
      for (const o of lane.obstacles) {
        // Draw at o.x and at ±trackLen to handle wrap-around on visible edge.
        for (const off of [0, -lane.trackLen, lane.trackLen]) {
          const x = (o.x + off) * c
          const w = o.len * c
          if (x + w < 0 || x > COLS * c) continue
          if (lane.kind === 'car') {
            ctx.fillStyle = lane.dir > 0 ? '#f87171' : '#fbbf24'
            ctx.fillRect(x + 2, lane.y * c + 4, w - 4, c - 8)
            ctx.fillStyle = 'rgba(15, 23, 42, 0.55)'
            // Windshield faces direction of travel.
            const wsW = (w - 4) * 0.35
            const wsX = lane.dir > 0 ? x + w - 4 - wsW : x + 4
            ctx.fillRect(wsX, lane.y * c + 6, wsW, c - 12)
          } else if (lane.kind === 'log') {
            ctx.fillStyle = '#92400e'
            ctx.fillRect(x, lane.y * c + 3, w, c - 6)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
            for (let g_ = 0; g_ < o.len; g_++) {
              ctx.fillRect(x + g_ * c + c - 2, lane.y * c + 3, 1, c - 6)
            }
          } else {
            // Turtle pad chain — series of green circles spanning the obstacle.
            for (let g_ = 0; g_ < o.len; g_++) {
              const cx = x + g_ * c + c / 2
              const cy = lane.y * c + c / 2
              ctx.fillStyle = '#22c55e'
              ctx.beginPath(); ctx.arc(cx, cy, c * 0.38, 0, Math.PI * 2); ctx.fill()
              ctx.fillStyle = '#166534'
              ctx.beginPath(); ctx.arc(cx, cy, c * 0.16, 0, Math.PI * 2); ctx.fill()
            }
          }
        }
      }
    }

    // Player turtle.
    const px = g.px * c + c / 2
    const py = g.py * c + c / 2
    ctx.fillStyle = '#16a34a'
    ctx.beginPath(); ctx.arc(px, py, c * 0.42, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#14532d'
    ctx.beginPath(); ctx.arc(px, py, c * 0.42, 0, Math.PI * 2); ctx.stroke()
    // Shell pattern: hex plates.
    ctx.fillStyle = '#15803d'
    for (const [dx, dy] of [[0, 0], [-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
      ctx.beginPath(); ctx.arc(px + dx * c, py + dy * c, c * 0.1, 0, Math.PI * 2); ctx.fill()
    }
    // Head poke out of the shell, oriented toward the home row.
    ctx.fillStyle = '#16a34a'
    ctx.beginPath(); ctx.arc(px, py - c * 0.42, c * 0.13, 0, Math.PI * 2); ctx.fill()

    // Brief death flash overlay.
    if (g.deathFlash > 0) {
      ctx.fillStyle = `rgba(244, 63, 94, ${Math.min(0.6, g.deathFlash * 1.5)})`
      ctx.fillRect(0, 0, COLS * c, ROWS * c)
    }
  }, [])

  const die = useCallback(() => {
    const g = gameRef.current
    g.lives--
    g.deathFlash = 0.5
    setLives(g.lives)
    if (g.lives <= 0) {
      setPhase('gameover')
      setHigh(prevHigh => {
        const best = Math.max(prevHigh, g.score)
        localStorage.setItem('turtler-high', String(best))
        return best
      })
      return
    }
    g.px = START_X
    g.py = START_ROW
    g.deepestRow = START_ROW
  }, [])

  const tryMove = useCallback((d: Dir) => {
    if (phase !== 'playing') return
    const g = gameRef.current
    if (g.deathFlash > 0) return
    let nx = Math.round(g.px)
    let ny = g.py
    if (d === 'up')    ny--
    if (d === 'down')  ny++
    if (d === 'left')  nx--
    if (d === 'right') nx++
    if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) return
    g.px = nx
    g.py = ny

    // Score: +10 the first time we touch each new row this life.
    if (ny < g.deepestRow) {
      g.score += 10 * (g.deepestRow - ny)
      g.deepestRow = ny
      setScore(g.score)
    }

    // Home row immediately resolves — slot or grass.
    if (ny === HOME_ROW) {
      const slotIdx = HOME_SLOT_X.indexOf(nx)
      if (slotIdx >= 0 && !g.homes[slotIdx]) {
        g.homes[slotIdx] = true
        g.score += 100
        setHomes([...g.homes])
        setScore(g.score)
        // Reset for next attempt; clear board + speed up if all slots filled.
        if (g.homes.every(Boolean)) {
          g.speedMult += SPEEDUP_PER_WAVE
          g.homes = HOME_SLOT_X.map(() => false)
          g.lanes = makeLanes(g.speedMult)
          setHomes([...g.homes])
        }
        g.px = START_X
        g.py = START_ROW
        g.deepestRow = START_ROW
      } else {
        die()
      }
    }
  }, [phase, die])

  const start = useCallback(() => {
    gameRef.current = {
      px: START_X,
      py: START_ROW,
      lanes: makeLanes(1),
      homes: HOME_SLOT_X.map(() => false),
      deepestRow: START_ROW,
      score: 0,
      lives: LIVES_START,
      speedMult: 1,
      lastTs: performance.now(),
      deathFlash: 0,
    }
    setScore(0)
    setLives(LIVES_START)
    setHomes(HOME_SLOT_X.map(() => false))
    setPhase('playing')
  }, [])

  // rAF loop: advance lanes, ride logs, check collisions, render.
  useEffect(() => {
    if (phase !== 'playing') return
    let stopped = false

    function frame(ts: number) {
      if (stopped) return
      const g = gameRef.current
      const dt = g.lastTs ? Math.min((ts - g.lastTs) / 1000, 0.05) : 0
      g.lastTs = ts

      // Advance every obstacle.
      for (const lane of g.lanes) {
        for (const o of lane.obstacles) advance(o, lane, dt)
      }

      if (g.deathFlash > 0) {
        g.deathFlash = Math.max(0, g.deathFlash - dt)
      } else {
        // River rows: must be riding something. If yes, drift with it.
        if (RIVER_ROWS.includes(g.py)) {
          const lane = g.lanes.find(l => l.y === g.py)!
          const riding = lane.obstacles.find(o => overlapsObstacle(g.px, o, lane.trackLen))
          if (riding) {
            g.px += lane.dir * lane.speed * dt
            if (g.px < 0 || g.px + 1 > COLS) die()
          } else {
            die()
          }
        }
        // Road rows: any car overlap is death.
        if (ROAD_ROWS.includes(g.py)) {
          const lane = g.lanes.find(l => l.y === g.py)!
          if (lane.obstacles.some(o => overlapsObstacle(g.px, o, lane.trackLen))) die()
        }
      }

      draw()
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [phase, draw, die])

  useEffect(() => {
    sizeCanvas()
    const onResize = () => { sizeCanvas(); draw() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sizeCanvas, draw])

  useEffect(() => { draw() }, [phase, draw])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const map: Record<string, Dir> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        w: 'up', s: 'down', a: 'left', d: 'right',
      }
      const dir = map[e.key]
      if (dir) { e.preventDefault(); tryMove(dir) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tryMove])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4">
      <header className="w-full max-w-md flex items-center justify-between mb-3">
        <Link to={backTo} className="text-sm text-slate-400 hover:text-slate-100">‹ back</Link>
        <p className="text-base font-mono font-semibold text-emerald-300">
          {score}
        </p>
        <p className="text-xs text-slate-500 font-mono">best {high}</p>
      </header>

      <h1 className="text-sm uppercase tracking-[0.3em] text-emerald-200/70 mb-2 font-semibold">
        🐢 turtler
      </h1>
      <p className="text-xs text-slate-500 font-mono mb-3">
        lives <span className="text-emerald-300">{'♥'.repeat(Math.max(0, lives))}</span>
        <span className="text-slate-700">{'♡'.repeat(Math.max(0, LIVES_START - lives))}</span>
        <span className="ml-3 text-slate-600">homes</span>
        <span className="text-emerald-300 ml-1">{homes.filter(Boolean).length}/{HOME_SLOT_X.length}</span>
      </p>

      <div className="relative">
        <canvas ref={canvasRef} className="rounded-lg border border-emerald-900/60" />
        {phase !== 'playing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 rounded-lg gap-3">
            {phase === 'gameover' && (
              <>
                <p className="text-rose-300 font-semibold text-lg">Squashed.</p>
                <p className="text-slate-300 text-sm">You scored {score}.</p>
              </>
            )}
            <button
              onClick={start}
              className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2 rounded-lg"
            >
              {phase === 'idle' ? 'Start' : 'Play again'}
            </button>
            <p className="text-xs text-slate-500 mt-2 text-center px-6">
              Arrow keys or D-pad. Dodge cars, ride logs, fill every slot up top.
            </p>
          </div>
        )}
      </div>

      <DPad onDir={tryMove} />
    </div>
  )
}

function DPad({ onDir }: { onDir: (d: Dir) => void }) {
  const btn = 'w-16 h-16 bg-slate-800 active:bg-emerald-700 text-emerald-200 text-2xl rounded-xl border border-slate-700 flex items-center justify-center select-none'
  return (
    <div
      className="mt-6 grid grid-cols-3 grid-rows-3 gap-2 touch-manipulation"
      style={{ WebkitUserSelect: 'none' }}
    >
      <div />
      <button aria-label="Up"    className={btn} onPointerDown={() => onDir('up')}>▲</button>
      <div />
      <button aria-label="Left"  className={btn} onPointerDown={() => onDir('left')}>◀</button>
      <div />
      <button aria-label="Right" className={btn} onPointerDown={() => onDir('right')}>▶</button>
      <div />
      <button aria-label="Down"  className={btn} onPointerDown={() => onDir('down')}>▼</button>
      <div />
    </div>
  )
}
