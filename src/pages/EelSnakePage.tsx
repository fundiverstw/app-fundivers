import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Snake, but the snake is an eel. Week-one minigame. Playable by admin or
// diver — route is /minigame/eel-snake, rendered fullscreen (outside the
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

export function EelSnakePage() {
  const { profile } = useAuth()
  const backTo = profile?.role === 'admin' ? '/admin' : '/dashboard'

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [high, setHigh] = useState<number>(() => Number(localStorage.getItem('eel-snake-high') ?? 0))

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellPxRef = useRef(20)
  const gameRef = useRef<{
    segments: Cell[]
    dir: Dir
    pending: Dir
    food: Cell
    tickMs: number
    score: number
  }>({
    segments: [{ x: 10, y: 10 }],
    dir: 'right',
    pending: 'right',
    food: { x: 5, y: 5 },
    tickMs: TICK_MS_START,
    score: 0,
  })

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Fit within viewport minus chrome; snap to whole cells so rendering is crisp.
    const maxPx = Math.min(window.innerWidth - 24, window.innerHeight - 200, 480)
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
    ctx.fillStyle = '#082f49' // sky-950-ish
    ctx.fillRect(0, 0, cell * GRID_SIZE, cell * GRID_SIZE)

    // Subtle grid.
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.07)'
    ctx.lineWidth = 1
    for (let i = 1; i < GRID_SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, cell * GRID_SIZE); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(cell * GRID_SIZE, i * cell); ctx.stroke()
    }

    // Food (fish). Emoji ≫ sprite effort for a single-week minigame.
    ctx.font = `${Math.floor(cell * 0.85)}px serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('🐠', g.food.x * cell + cell / 2, g.food.y * cell + cell / 2)

    // Eel — gradient of greens along the body, darker head with a cyan eye dot.
    g.segments.forEach((seg, i) => {
      const t = g.segments.length === 1 ? 1 : 1 - i / (g.segments.length)
      const shade = Math.round(120 + t * 80) // 120..200 green
      ctx.fillStyle = `rgb(16, ${shade}, 90)`
      ctx.beginPath()
      ctx.arc(seg.x * cell + cell / 2, seg.y * cell + cell / 2, cell * 0.45, 0, Math.PI * 2)
      ctx.fill()
    })
    const head = g.segments[0]
    ctx.fillStyle = '#06b6d4'
    ctx.beginPath()
    ctx.arc(head.x * cell + cell * 0.6, head.y * cell + cell * 0.4, Math.max(2, cell * 0.08), 0, Math.PI * 2)
    ctx.fill()
  }, [])

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
      dir: 'right',
      pending: 'right',
      food: placeFood(initial),
      tickMs: TICK_MS_START,
      score: 0,
    }
    setScore(0)
    setPhase('playing')
  }, [])

  // Game loop (interval rather than rAF — discrete grid ticks).
  useEffect(() => {
    if (phase !== 'playing') return
    let stopped = false

    function step() {
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
        setHigh(prev => {
          const best = Math.max(prev, g.score)
          localStorage.setItem('eel-snake-high', String(best))
          return best
        })
        return
      }

      g.segments.unshift(next)
      if (next.x === g.food.x && next.y === g.food.y) {
        g.score++
        setScore(g.score)
        g.food = placeFood(g.segments)
        if (g.score % SPEEDUP_EVERY_FISH === 0) {
          g.tickMs = Math.max(TICK_MS_MIN, g.tickMs - SPEEDUP_STEP_MS)
        }
      } else {
        g.segments.pop()
      }

      draw()
      setTimeout(step, g.tickMs)
    }

    step()
    return () => { stopped = true }
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

  // Swipe — single-axis dominant, with a small threshold so taps don't count.
  useEffect(() => {
    let startX = 0, startY = 0
    function onStart(e: TouchEvent) {
      const t = e.changedTouches[0]
      startX = t.clientX; startY = t.clientY
    }
    function onEnd(e: TouchEvent) {
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (Math.abs(dx) + Math.abs(dy) < 30) return
      if (Math.abs(dx) > Math.abs(dy)) changeDir(dx > 0 ? 'right' : 'left')
      else                              changeDir(dy > 0 ? 'down'  : 'up')
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend',   onEnd)
    }
  }, [changeDir])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4">
      <header className="w-full max-w-md flex items-center justify-between mb-3">
        <Link to={backTo} className="text-sm text-slate-400 hover:text-slate-100">‹ back</Link>
        <p className="text-base font-mono font-semibold text-sky-300">
          {score} <span className="text-slate-500 text-xs">fish</span>
        </p>
        <p className="text-xs text-slate-500 font-mono">best {high}</p>
      </header>

      <h1 className="text-sm uppercase tracking-[0.3em] text-cyan-200/70 mb-3 font-semibold">
        🪱 eel snake
      </h1>

      <div className="relative">
        <canvas ref={canvasRef} className="rounded-lg border border-sky-900/60" />
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
              className="mt-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold px-5 py-2 rounded-lg"
            >
              {phase === 'idle' ? 'Start' : 'Play again'}
            </button>
            <p className="text-xs text-slate-500 mt-2 text-center px-6">
              Arrow keys or swipe to steer.<br />Don't hit walls or yourself.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
