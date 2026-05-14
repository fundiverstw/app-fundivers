import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Breakout, where the paddle is a nudibranch. Route /minigame/nudibranchout,
// rendered fullscreen so the canvas isn't squeezed by the bottom nav.
//
// All game math runs in a fixed 100×150 "game-unit" coordinate space so the
// same constants behave identically at any device pixel size. A single
// render scale (canvasWidthPx / GAME_W) translates units → px.
//
// Controls: arrow keys (desktop, hold to slide) plus drag-anywhere on the
// canvas (mobile — paddle centers on the touch x).

const GAME_W = 100
const GAME_H = 150
const BRICK_ROWS = 5
const BRICK_COLS = 10
const BRICK_W = 9
const BRICK_H = 4
const BRICK_GAP = 1
const BRICK_OFFSET_X = (GAME_W - (BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP)) / 2
const BRICK_OFFSET_Y = 12
const PADDLE_W = 18
const PADDLE_H = 3
const PADDLE_Y = GAME_H - 8
const PADDLE_SPEED = 90
const BALL_R = 1.4
const BALL_SPEED_START = 55
const BALL_SPEED_STEP = 1.5
const BALL_SPEED_MAX = 120
const LIVES_START = 3
// Saturated nudibranch palette — pink → orange → yellow → lime → cyan.
const ROW_COLORS = ['#ec4899', '#f97316', '#facc15', '#a3e635', '#06b6d4']

type Phase = 'idle' | 'playing' | 'gameover'

interface Brick { x: number; y: number; alive: boolean; color: string }
interface Ball { x: number; y: number; vx: number; vy: number }

function buildBricks(): Brick[] {
  const out: Brick[] = []
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      out.push({
        x: BRICK_OFFSET_X + c * (BRICK_W + BRICK_GAP),
        y: BRICK_OFFSET_Y + r * (BRICK_H + BRICK_GAP),
        alive: true,
        color: ROW_COLORS[r],
      })
    }
  }
  return out
}

function spawnBall(paddleX: number, speed: number): Ball {
  const angle = (Math.random() * 0.4 + 0.3) * (Math.random() > 0.5 ? 1 : -1)
  return {
    x: paddleX + PADDLE_W / 2,
    y: PADDLE_Y - BALL_R - 0.5,
    vx: Math.sin(angle) * speed,
    vy: -Math.cos(angle) * speed,
  }
}

export function NudibranchoutPage() {
  const { profile } = useAuth()
  const backTo = profile?.role === 'admin' ? '/admin'
    : profile?.role === 'staff' ? '/admin/events'
    : '/dashboard'

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(LIVES_START)
  const [high, setHigh] = useState<number>(() => Number(localStorage.getItem('nudibranchout-high') ?? 0))

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scaleRef = useRef(4)
  const gameRef = useRef<{
    paddleX: number
    ball: Ball
    bricks: Brick[]
    speed: number
    score: number
    lives: number
    keys: { left: boolean; right: boolean }
    pointerX: number | null
    lastTs: number
  }>({
    paddleX: (GAME_W - PADDLE_W) / 2,
    ball: { x: GAME_W / 2, y: PADDLE_Y - BALL_R - 0.5, vx: 0, vy: 0 },
    bricks: buildBricks(),
    speed: BALL_SPEED_START,
    score: 0,
    lives: LIVES_START,
    keys: { left: false, right: false },
    pointerX: null,
    lastTs: 0,
  })
  const rafRef = useRef(0)

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const maxW = Math.min(window.innerWidth - 24, window.innerHeight - 220, 420)
    const widthPx = Math.max(180, Math.floor(maxW))
    const heightPx = Math.floor(widthPx * (GAME_H / GAME_W))
    scaleRef.current = widthPx / GAME_W
    const dpr = window.devicePixelRatio || 1
    canvas.width = widthPx * dpr
    canvas.height = heightPx * dpr
    canvas.style.width = `${widthPx}px`
    canvas.style.height = `${heightPx}px`
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const s = scaleRef.current
    const g = gameRef.current
    const widthPx = GAME_W * s
    const heightPx = GAME_H * s

    ctx.fillStyle = '#1e1b4b'  // deep indigo, contrasts the bright bricks
    ctx.fillRect(0, 0, widthPx, heightPx)
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.06)'
    ctx.lineWidth = 1
    for (let x = 0; x < GAME_W; x += 5) {
      ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, heightPx); ctx.stroke()
    }

    for (const b of g.bricks) {
      if (!b.alive) continue
      ctx.fillStyle = b.color
      ctx.fillRect(b.x * s, b.y * s, BRICK_W * s, BRICK_H * s)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
      ctx.fillRect(b.x * s, b.y * s, BRICK_W * s, BRICK_H * s * 0.35)
    }

    // Paddle drawn as a nudibranch — long body with cerata (frills) on top.
    const px = g.paddleX * s
    const py = PADDLE_Y * s
    const pw = PADDLE_W * s
    const ph = PADDLE_H * s
    const r = ph * 0.6
    ctx.fillStyle = '#d946ef'   // body, magenta
    ctx.beginPath()
    ctx.moveTo(px + r, py)
    ctx.lineTo(px + pw - r, py)
    ctx.quadraticCurveTo(px + pw, py, px + pw, py + r)
    ctx.lineTo(px + pw, py + ph - r)
    ctx.quadraticCurveTo(px + pw, py + ph, px + pw - r, py + ph)
    ctx.lineTo(px + r, py + ph)
    ctx.quadraticCurveTo(px, py + ph, px, py + ph - r)
    ctx.lineTo(px, py + r)
    ctx.quadraticCurveTo(px, py, px + r, py)
    ctx.fill()
    // Cerata along the top — alternating cyan / yellow tips.
    for (let i = 0; i < 7; i++) {
      const cx = px + (pw / 7) * (i + 0.5)
      ctx.fillStyle = i % 2 === 0 ? '#22d3ee' : '#fde047'
      ctx.beginPath()
      ctx.ellipse(cx, py - ph * 0.2, ph * 0.22, ph * 0.55, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // Ball with halo.
    const bx = g.ball.x * s
    const by = g.ball.y * s
    ctx.fillStyle = 'rgba(253, 224, 71, 0.35)'
    ctx.beginPath(); ctx.arc(bx, by, BALL_R * s * 1.6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fef3c7'
    ctx.beginPath(); ctx.arc(bx, by, BALL_R * s, 0, Math.PI * 2); ctx.fill()
  }, [])

  const start = useCallback(() => {
    const paddleX = (GAME_W - PADDLE_W) / 2
    gameRef.current = {
      paddleX,
      ball: spawnBall(paddleX, BALL_SPEED_START),
      bricks: buildBricks(),
      speed: BALL_SPEED_START,
      score: 0,
      lives: LIVES_START,
      keys: { left: false, right: false },
      pointerX: null,
      lastTs: performance.now(),
    }
    setScore(0)
    setLives(LIVES_START)
    setPhase('playing')
  }, [])

  useEffect(() => {
    if (phase !== 'playing') return
    let stopped = false

    function frame(ts: number) {
      if (stopped) return
      const g = gameRef.current
      const dt = g.lastTs ? Math.min((ts - g.lastTs) / 1000, 0.033) : 0
      g.lastTs = ts

      if (g.pointerX !== null) {
        const target = g.pointerX - PADDLE_W / 2
        g.paddleX = Math.max(0, Math.min(GAME_W - PADDLE_W, target))
      } else {
        if (g.keys.left)  g.paddleX = Math.max(0, g.paddleX - PADDLE_SPEED * dt)
        if (g.keys.right) g.paddleX = Math.min(GAME_W - PADDLE_W, g.paddleX + PADDLE_SPEED * dt)
      }

      const b = g.ball
      b.x += b.vx * dt
      b.y += b.vy * dt

      if (b.x - BALL_R < 0)      { b.x = BALL_R;          b.vx = -b.vx }
      if (b.x + BALL_R > GAME_W) { b.x = GAME_W - BALL_R; b.vx = -b.vx }
      if (b.y - BALL_R < 0)      { b.y = BALL_R;          b.vy = -b.vy }

      // Paddle: reflect angle around hit position so the player can steer.
      const pLeft  = g.paddleX
      const pRight = g.paddleX + PADDLE_W
      const pTop   = PADDLE_Y
      if (b.vy > 0 && b.y + BALL_R >= pTop && b.y - BALL_R <= pTop + PADDLE_H
          && b.x + BALL_R >= pLeft && b.x - BALL_R <= pRight) {
        b.y = pTop - BALL_R
        const hit = (b.x - (pLeft + PADDLE_W / 2)) / (PADDLE_W / 2)
        const angle = Math.max(-1, Math.min(1, hit)) * (Math.PI / 3)
        const speed = Math.hypot(b.vx, b.vy)
        b.vx = Math.sin(angle) * speed
        b.vy = -Math.abs(Math.cos(angle) * speed)
      }

      // Brick collisions — one per frame on the shallower-penetration axis.
      for (const brick of g.bricks) {
        if (!brick.alive) continue
        const bl = brick.x, br = brick.x + BRICK_W
        const bt = brick.y, bb = brick.y + BRICK_H
        if (b.x + BALL_R < bl || b.x - BALL_R > br) continue
        if (b.y + BALL_R < bt || b.y - BALL_R > bb) continue
        brick.alive = false
        g.score++
        setScore(g.score)
        g.speed = Math.min(BALL_SPEED_MAX, g.speed + BALL_SPEED_STEP)
        const len = Math.hypot(b.vx, b.vy) || 1
        const overlapL = b.x + BALL_R - bl
        const overlapR = br - (b.x - BALL_R)
        const overlapT = b.y + BALL_R - bt
        const overlapB = bb - (b.y - BALL_R)
        const minH = Math.min(overlapL, overlapR)
        const minV = Math.min(overlapT, overlapB)
        if (minH < minV) b.vx = -b.vx
        else             b.vy = -b.vy
        b.vx = (b.vx / len) * g.speed
        b.vy = (b.vy / len) * g.speed
        break
      }

      // Board cleared → fresh wall, small speed bump.
      if (g.bricks.every(brick => !brick.alive)) {
        g.bricks = buildBricks()
        g.speed = Math.min(BALL_SPEED_MAX, g.speed + 6)
        g.ball = spawnBall(g.paddleX, g.speed)
      }

      if (b.y - BALL_R > GAME_H) {
        g.lives--
        setLives(g.lives)
        if (g.lives <= 0) {
          stopped = true
          setPhase('gameover')
          setHigh(prevHigh => {
            const best = Math.max(prevHigh, g.score)
            localStorage.setItem('nudibranchout-high', String(best))
            return best
          })
          return
        }
        g.ball = spawnBall(g.paddleX, g.speed)
      }

      draw()
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [phase, draw])

  useEffect(() => {
    sizeCanvas()
    const onResize = () => { sizeCanvas(); draw() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sizeCanvas, draw])

  useEffect(() => { draw() }, [phase, draw])

  useEffect(() => {
    const g = gameRef.current
    function onDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft'  || e.key === 'a') { e.preventDefault(); g.keys.left  = true  }
      if (e.key === 'ArrowRight' || e.key === 'd') { e.preventDefault(); g.keys.right = true  }
    }
    function onUp(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft'  || e.key === 'a') g.keys.left  = false
      if (e.key === 'ArrowRight' || e.key === 'd') g.keys.right = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    updatePointer(e)
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (gameRef.current.pointerX !== null) updatePointer(e)
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId)
    gameRef.current.pointerX = null
  }
  function updatePointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const xPx = e.clientX - rect.left
    gameRef.current.pointerX = Math.max(0, Math.min(GAME_W, (xPx / rect.width) * GAME_W))
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4">
      <header className="w-full max-w-md flex items-center justify-between mb-3">
        <Link to={backTo} className="text-sm text-slate-400 hover:text-slate-100">‹ back</Link>
        <p className="text-base font-mono font-semibold text-fuchsia-300">
          {score} <span className="text-slate-500 text-xs">bricks</span>
        </p>
        <p className="text-xs text-slate-500 font-mono">best {high}</p>
      </header>

      <h1 className="text-sm uppercase tracking-[0.3em] text-fuchsia-200/70 mb-3 font-semibold">
        🐌 nudibranchout
      </h1>

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="rounded-lg border border-fuchsia-900/60 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {phase !== 'playing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 rounded-lg gap-3">
            {phase === 'gameover' && (
              <>
                <p className="text-rose-300 font-semibold text-lg">Lost the slug!</p>
                <p className="text-slate-300 text-sm">You broke {score} bricks.</p>
              </>
            )}
            <button
              onClick={start}
              className="mt-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold px-5 py-2 rounded-lg"
            >
              {phase === 'idle' ? 'Start' : 'Play again'}
            </button>
            <p className="text-xs text-slate-500 mt-2 text-center px-6">
              Arrow keys, or drag your finger across the board.<br />Clear every brick.
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-slate-400 font-mono">
        lives <span className="text-fuchsia-300">{'♥'.repeat(Math.max(0, lives))}</span>
        <span className="text-slate-700">{'♡'.repeat(Math.max(0, LIVES_START - lives))}</span>
      </p>
    </div>
  )
}
