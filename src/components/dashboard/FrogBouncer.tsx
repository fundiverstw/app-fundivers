import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FrogIcon } from './creature-icons'

// Sibling of EelBouncer — a cute frog icon drifting around the dashboard at
// its own random cadence, leads to the frogger minigame.
//
// Kept as a separate component (not a generalized <Bouncer />) because the
// per-creature tuning (speed, glow tint, target route) reads clearer inline
// than behind a shared abstraction for three of them.

const FROG_SIZE = 56
const HIT_PADDING = 28
const BOUNCES_BEFORE_DISAPPEAR = 6
const MIN_DELAY_MS = 25_000
const MAX_DELAY_MS = 45_000
const BASE_SPEED = 200
const SPEED_JITTER = 110

type Kinetic = {
  x: number; y: number; vx: number; vy: number
  bouncesLeft: number; active: boolean
}

function spawnKinetics(): Kinetic {
  const W = window.innerWidth
  const H = window.innerHeight
  const speed = BASE_SPEED + Math.random() * SPEED_JITTER
  const sign = () => Math.random() > 0.5 ? 1 : -1
  const edge = Math.floor(Math.random() * 4)
  let x = 0, y = 0, vx = 0, vy = 0
  switch (edge) {
    case 0: x = Math.random() * (W - FROG_SIZE); y = 0;                               vx = sign() * speed * 0.6; vy = speed;  break
    case 1: x = W - FROG_SIZE;                   y = Math.random() * (H - FROG_SIZE); vx = -speed;               vy = sign() * speed * 0.6; break
    case 2: x = Math.random() * (W - FROG_SIZE); y = H - FROG_SIZE;                   vx = sign() * speed * 0.6; vy = -speed; break
    case 3: x = 0;                               y = Math.random() * (H - FROG_SIZE); vx = speed;                vy = sign() * speed * 0.6; break
  }
  return { x, y, vx, vy, bouncesLeft: BOUNCES_BEFORE_DISAPPEAR, active: true }
}

export function FrogBouncer() {
  const navigate = useNavigate()
  const btnRef = useRef<HTMLButtonElement>(null)
  const state = useRef<Kinetic>({ x: 0, y: 0, vx: 0, vy: 0, bouncesLeft: 0, active: false })
  const rafRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    let lastTs = 0

    function tick(ts: number) {
      const el = btnRef.current
      const s = state.current
      if (!el || !s.active) return
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0
      lastTs = ts

      s.x += s.vx * dt
      s.y += s.vy * dt

      const W = window.innerWidth
      const H = window.innerHeight

      if (s.x < 0)                   { s.x = 0;                   s.vx = -s.vx; s.bouncesLeft-- }
      else if (s.x > W - FROG_SIZE)  { s.x = W - FROG_SIZE;       s.vx = -s.vx; s.bouncesLeft-- }
      if (s.y < 0)                   { s.y = 0;                   s.vy = -s.vy; s.bouncesLeft-- }
      else if (s.y > H - FROG_SIZE)  { s.y = H - FROG_SIZE;       s.vy = -s.vy; s.bouncesLeft-- }

      const flip = s.vx < 0 ? 'scaleX(-1)' : 'scaleX(1)'
      el.style.transform = `translate(${s.x}px, ${s.y}px) ${flip}`

      if (s.bouncesLeft <= 0) {
        s.active = false
        el.style.opacity = '0'
        el.style.pointerEvents = 'none'
        scheduleAppearance()
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    function appear() {
      const el = btnRef.current
      if (!el) return
      state.current = spawnKinetics()
      lastTs = 0
      el.style.opacity = '1'
      el.style.pointerEvents = 'auto'
      rafRef.current = requestAnimationFrame(tick)
    }

    function scheduleAppearance() {
      const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)
      timerRef.current = window.setTimeout(appear, delay)
    }

    scheduleAppearance()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      cancelAnimationFrame(rafRef.current)
      state.current.active = false
    }
  }, [])

  return (
    <button
      ref={btnRef}
      type="button"
      aria-label="Play frogger"
      onClick={() => navigate('/minigame/turtler')}
      className="fixed top-0 left-0 z-40 transition-opacity duration-300 cursor-pointer flex items-center justify-center"
      style={{
        width: FROG_SIZE + HIT_PADDING * 2,
        height: FROG_SIZE + HIT_PADDING * 2,
        padding: HIT_PADDING,
        opacity: 0,
        pointerEvents: 'none',
        willChange: 'transform',
        marginLeft: -HIT_PADDING,
        marginTop: -HIT_PADDING,
      }}
    >
      <FrogIcon className="drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]" />
    </button>
  )
}
