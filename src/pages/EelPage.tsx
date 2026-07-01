import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Snake, but the snake is an eel. Week-one minigame. Playable by admin or
// diver — route is /minigame/eel, rendered fullscreen (outside the
// regular shells) so the canvas isn't squeezed by the bottom nav.
//
// Controls: arrow keys (desktop), swipe (mobile). Wall or self collision
// ends the run. Grid is 20×20; speed edges up every few fish as a gentle
// difficulty ramp.

const GRID_SIZE = 20
const TICK_MS_START = 160
const TICK_MS_MIN = 75
const SPEEDUP_EVERY_FISH = 3
const SPEEDUP_STEP_MS = 8

type Dir = 'up' | 'down' | 'left' | 'right'
type Cell = { x: number; y: number }
type Phase = 'idle' | 'playing' | 'gameover'

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

function placeFood(occupied: Cell[]): Cell {
  // Retry sampling. For a 400-cell grid with up to ~20 eel segments, this
  // converges in a handful of tries even near endgame.
  while (true) {
    const c = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) }
    if (!occupied.some(o => o.x === c.x && o.y === c.y)) return c
  }
}

interface Point { x: number; y: number }

// Draw the eel as a tapered serpentine stroke through `pts` (head first).
// A wider head pass, a narrower body pass, and a highlight pass give the
// impression of a cylindrical body with light glancing off the top — reads
// as an eel instead of a string of beads.
function drawEel(ctx: CanvasRenderingContext2D, pts: Point[], cell: number) {
  if (pts.length === 0) return
  if (pts.length === 1) {
    ctx.fillStyle = '#16a34a'
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, cell * 0.42, 0, Math.PI * 2); ctx.fill()
    return
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Two passes: dark outline first (width +2), then body on top. Cheap depth.
  for (const pass of ['outline', 'body', 'highlight'] as const) {
    for (let i = 0; i < pts.length - 1; i++) {
      // Taper along the body: head is widest, tail thinnest.
      const frac = i / Math.max(1, pts.length - 1)
      const baseWidth = cell * (0.85 - frac * 0.55) // 0.85 → 0.30
      if (pass === 'outline') {
        ctx.strokeStyle = 'rgba(2, 44, 34, 0.9)'
        ctx.lineWidth = baseWidth + 2
      } else if (pass === 'body') {
        const shade = Math.round(160 - frac * 60) // 160..100 green
        ctx.strokeStyle = `rgb(14, ${shade}, 70)`
        ctx.lineWidth = baseWidth
      } else {
        // Highlight: thin bright line riding the top of the body.
        ctx.strokeStyle = `rgba(134, 239, 172, ${0.45 - frac * 0.4})` // fades toward tail
        ctx.lineWidth = Math.max(1, baseWidth * 0.25)
      }
      ctx.beginPath()
      ctx.moveTo(pts[i].x, pts[i].y)
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y)
      ctx.stroke()
    }
  }

  // Head cap — slightly bulbous, with eye + pupil offset in the direction
  // of travel so the eel looks like it's "looking" forward.
  const head = pts[0]
  const next = pts[1] ?? head
  const dx = head.x - next.x
  const dy = head.y - next.y
  const len = Math.hypot(dx, dy) || 1
  const nx = dx / len
  const ny = dy / len
  // Perpendicular (for eye placement, slightly off-centerline)
  const px = -ny
  const py = nx

  ctx.fillStyle = 'rgb(14, 170, 70)'
  ctx.beginPath(); ctx.arc(head.x, head.y, cell * 0.43, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(2, 44, 34, 0.9)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Eye
  const eyeX = head.x + nx * cell * 0.18 + px * cell * 0.18
  const eyeY = head.y + ny * cell * 0.18 + py * cell * 0.18
  ctx.fillStyle = '#fef3c7'  // amber-100 sclera
  ctx.beginPath(); ctx.arc(eyeX, eyeY, cell * 0.12, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#020617'  // pupil
  ctx.beginPath(); ctx.arc(eyeX + nx * cell * 0.03, eyeY + ny * cell * 0.03, cell * 0.06, 0, Math.PI * 2); ctx.fill()
}

export function EelPage() {
  const { profile } = useAuth()
  const backTo = profile?.role === 'admin' ? '/admin'
    : profile?.role === 'staff' ? '/admin/events'
    : '/dashboard'

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [high, setHigh] = useState<number>(() => Number(localStorage.getItem('eel-high') ?? 0))

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellPxRef = useRef(20)
  // `prev` snapshots each segment's position *before* the current tick; `draw`
  // interpolates between prev → segments based on wall-clock progress through
  // the tick interval, so rendering stays smooth between discrete moves.
  const gameRef = useRef<{
    segments: Cell[]
    prev: Cell[]
    dir: Dir
    pending: Dir
    food: Cell
    tickMs: number
    score: number
    lastTickAt: number
  }>({
    segments: [{ x: 10, y: 10 }],
    prev: [{ x: 10, y: 10 }],
    dir: 'right',
    pending: 'right',
    food: { x: 5, y: 5 },
    tickMs: TICK_MS_START,
    score: 0,
    lastTickAt: 0,
  })
  const rafRef = useRef(0)

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Fit within viewport minus chrome (header + title + D-pad + paddings);
    // snap to whole cells so rendering is crisp.
    const maxPx = Math.min(window.innerWidth - 24, window.innerHeight - 340, 480)
    const cell = Math.max(12, Math.floor(maxPx / GRID_SIZE))
    cellPxRef.current = cell
    const dpr = window.devicePixelRatio || 1
    const px = cell * GRID_SIZE
    canvas.width = px * dpr
    canvas.height = px * dpr
    canvas.style.width = `${px}px`
    canvas.style.height = `${px}px`
    const ctx = canvas.getContext('2d')
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cell = cellPxRef.current
    const g = gameRef.current

    // Deep-water background.
    ctx.fillStyle = '#082f49' // surface-950-ish
    ctx.fillRect(0, 0, cell * GRID_SIZE, cell * GRID_SIZE)

    // Subtle grid.
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.07)'
    ctx.lineWidth = 1
    for (let i = 1; i < GRID_SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, cell * GRID_SIZE); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(cell * GRID_SIZE, i * cell); ctx.stroke()
    }

    // Food (fish).
    ctx.font = `${Math.floor(cell * 0.85)}px serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('🐠', g.food.x * cell + cell / 2, g.food.y * cell + cell / 2)

    // Interpolate each segment between its prev and current grid cell.
    // When not playing (idle / gameover) interp is 0 so the eel rests exactly on the grid.
    const t = phase === 'playing' && g.lastTickAt
      ? Math.min(1, (performance.now() - g.lastTickAt) / g.tickMs)
      : 0
    const pts = g.segments.map((cur, i) => {
      const prev = g.prev[i] ?? cur
      return {
        x: (prev.x + (cur.x - prev.x) * t) * cell + cell / 2,
        y: (prev.y + (cur.y - prev.y) * t) * cell + cell / 2,
      }
    })

    drawEel(ctx, pts, cell)
  }, [phase])

  const changeDir = useCallback((d: Dir) => {
    const g = gameRef.current
    // Prevent 180° turn into self.
    if (OPPOSITE[d] === g.dir) return
    g.pending = d
  }, [])

  const start = useCallback(() => {
    const initial: Cell[] = [
      { x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 },
    ]
    gameRef.current = {
      segments: initial,
      prev: initial.map(c => ({ ...c })),
      dir: 'right',
      pending: 'right',
      food: placeFood(initial),
      tickMs: TICK_MS_START,
      score: 0,
      lastTickAt: performance.now(),
    }
    setScore(0)
    setPhase('playing')
  }, [])

  // Game loop: discrete grid ticks drive logic; a separate rAF loop drives
  // rendering and interpolates between prev ↔ current cell positions so the
  // eel slides smoothly instead of teleporting one cell at a time.
  useEffect(() => {
    if (phase !== 'playing') return
    let stopped = false
    let tickTimeout: number | undefined

    function logicTick() {
      if (stopped) return
      const g = gameRef.current
      g.dir = g.pending
      const head = g.segments[0]
      const next: Cell = {
        up:    { x: head.x,     y: head.y - 1 },
        down:  { x: head.x,     y: head.y + 1 },
        left:  { x: head.x - 1, y: head.y     },
        right: { x: head.x + 1, y: head.y     },
      }[g.dir]

      const hitWall = next.x < 0 || next.y < 0 || next.x >= GRID_SIZE || next.y >= GRID_SIZE
      const hitSelf = g.segments.some(s => s.x === next.x && s.y === next.y)
      if (hitWall || hitSelf) {
        stopped = true
        setPhase('gameover')
        setHigh(prevHigh => {
          const best = Math.max(prevHigh, g.score)
          localStorage.setItem('eel-high', String(best))
          return best
        })
        return
      }

      // Snapshot current → prev, then mutate current forward by one cell.
      g.prev = g.segments.map(c => ({ ...c }))
      g.segments.unshift(next)
      if (next.x === g.food.x && next.y === g.food.y) {
        g.score++
        setScore(g.score)
        g.food = placeFood(g.segments)
        if (g.score % SPEEDUP_EVERY_FISH === 0) {
          g.tickMs = Math.max(TICK_MS_MIN, g.tickMs - SPEEDUP_STEP_MS)
        }
        // Fresh tail grows from where it used to end — give prev an extra
        // entry so the new tail segment doesn't pop out of nowhere.
        g.prev.push(g.prev[g.prev.length - 1])
      } else {
        g.segments.pop()
      }
      g.lastTickAt = performance.now()

      tickTimeout = window.setTimeout(logicTick, g.tickMs)
    }

    function renderLoop() {
      if (stopped) return
      draw()
      rafRef.current = requestAnimationFrame(renderLoop)
    }

    tickTimeout = window.setTimeout(logicTick, gameRef.current.tickMs)
    rafRef.current = requestAnimationFrame(renderLoop)

    return () => {
      stopped = true
      if (tickTimeout) clearTimeout(tickTimeout)
      cancelAnimationFrame(rafRef.current)
    }
  }, [phase, draw])

  // Canvas sizing — run on mount and window resize.
  useEffect(() => {
    sizeCanvas()
    const onResize = () => { sizeCanvas(); draw() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sizeCanvas, draw])

  // One draw per phase change so idle / gameover show the current state.
  useEffect(() => { draw() }, [phase, draw])

  // Keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const map: Record<string, Dir> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        w: 'up', s: 'down', a: 'left', d: 'right',
      }
      const dir = map[e.key]
      if (dir) { e.preventDefault(); changeDir(dir) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [changeDir])

  // Touch input goes through the on-screen D-pad below the canvas (swipe
  // turned out to be finicky — small deltas were misread as direction
  // changes, and the game board competes with scroll gestures).

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4">
      <header className="w-full max-w-md flex items-center justify-between mb-3">
        <Link to={backTo} className="text-sm text-slate-400 hover:text-slate-100">‹ back</Link>
        <p className="text-base font-mono font-semibold text-surface-300">
          {score} <span className="text-slate-500 text-xs">fish</span>
        </p>
        <p className="text-xs text-slate-500 font-mono">best {high}</p>
      </header>

      <h1 className="text-sm uppercase tracking-[0.3em] text-cyan-200/70 mb-3 font-semibold">
        🪱 eel
      </h1>

      <div className="relative">
        <canvas ref={canvasRef} className="rounded-lg border border-surface-900/60" />
        {phase !== 'playing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 rounded-lg gap-3">
            {phase === 'gameover' && (
              <>
                <p className="text-rose-300 font-semibold text-lg">Caught!</p>
                <p className="text-slate-300 text-sm">You ate {score} fish.</p>
              </>
            )}
            <button
              onClick={start}
              className="mt-2 bg-surface-600 hover:bg-surface-500 text-white font-semibold px-5 py-2 rounded-lg"
            >
              {phase === 'idle' ? 'Start' : 'Play again'}
            </button>
            <p className="text-xs text-slate-500 mt-2 text-center px-6">
              Arrow keys or tap the D-pad to steer.<br />Don't hit walls or yourself.
            </p>
          </div>
        )}
      </div>

      <DPad onDir={changeDir} />
    </div>
  )
}

function DPad({ onDir }: { onDir: (d: Dir) => void }) {
  // onPointerDown fires on first contact — feels more responsive than onClick,
  // which waits for pointerup and can be swallowed by 300ms tap-delay heuristics
  // on some mobile browsers. touch-action: manipulation prevents the long-press
  // context menu and double-tap zoom interference.
  const btn = 'w-16 h-16 bg-slate-800 active:bg-surface-700 text-surface-200 text-2xl rounded-xl border border-slate-700 flex items-center justify-center select-none'
  return (
    <div
      className="mt-8 grid grid-cols-3 grid-rows-3 gap-2 touch-manipulation"
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
