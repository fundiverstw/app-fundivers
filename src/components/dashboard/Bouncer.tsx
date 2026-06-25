import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ComponentType } from 'react'

// Periodic visual cameo: every 25–45s a cute creature icon enters from a
// random edge, bounces around the viewport a few times, and vanishes. Tapping
// it while visible launches that creature's minigame.
//
// State lives in a ref and drives `style.transform` directly — avoiding
// per-frame React re-renders keeps the animation smooth on low-end phones.
//
// One shared body for all three dashboard bouncers; per-creature tuning
// (speed, glow tint, icon, target route) comes in via config props.

const SIZE = 56              // visible icon (px square)
const HIT_PADDING = 28           // invisible tap expansion around the icon
const BOUNCES_BEFORE_DISAPPEAR = 6
const MIN_DELAY_MS = 25_000
const MAX_DELAY_MS = 45_000

type IconComponent = ComponentType<{ className?: string }>

export type BouncerConfig = {
  icon: IconComponent
  to: string
  label: string
  baseSpeed: number
  speedJitter: number
  glow: string
}

type Kinetic = {
  x: number; y: number; vx: number; vy: number
  bouncesLeft: number; active: boolean
}

function spawnKinetics(baseSpeed: number, speedJitter: number): Kinetic {
  const W = window.innerWidth
  const H = window.innerHeight
  const speed = baseSpeed + Math.random() * speedJitter
  const sign = () => Math.random() > 0.5 ? 1 : -1
  const edge = Math.floor(Math.random() * 4) // 0=top, 1=right, 2=bottom, 3=left
  let x = 0, y = 0, vx = 0, vy = 0
  switch (edge) {
    case 0: x = Math.random() * (W - SIZE); y = 0;                          vx = sign() * speed * 0.6; vy = speed;           break
    case 1: x = W - SIZE;                   y = Math.random() * (H - SIZE); vx = -speed; vy = sign() * speed * 0.6; break
    case 2: x = Math.random() * (W - SIZE); y = H - SIZE;                   vx = sign() * speed * 0.6; vy = -speed;          break
    case 3: x = 0;                          y = Math.random() * (H - SIZE); vx = speed;  vy = sign() * speed * 0.6; break
  }
  return { x, y, vx, vy, bouncesLeft: BOUNCES_BEFORE_DISAPPEAR, active: true }
}

export function Bouncer({ icon: Icon, to, label, baseSpeed, speedJitter, glow }: BouncerConfig) {
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

      // Wall bounces. Count each axis hit separately so a corner still
      // subtracts two bounces — feels more satisfying to watch.
      if (s.x < 0)               { s.x = 0;              s.vx = -s.vx; s.bouncesLeft-- }
      else if (s.x > W - SIZE)   { s.x = W - SIZE;       s.vx = -s.vx; s.bouncesLeft-- }
      if (s.y < 0)               { s.y = 0;              s.vy = -s.vy; s.bouncesLeft-- }
      else if (s.y > H - SIZE)   { s.y = H - SIZE;       s.vy = -s.vy; s.bouncesLeft-- }

      // Face direction of travel.
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
      state.current = spawnKinetics(baseSpeed, speedJitter)
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
  }, [baseSpeed, speedJitter])

  // The button is visibly SIZE but receives taps within a larger box
  // (SIZE + 2*HIT_PADDING). The transparent padding is pointer-events
  // active; the icon sits centered. Easier to hit on a phone without
  // making the sprite itself huge.
  return (
    <button
      ref={btnRef}
      type="button"
      aria-label={label}
      onClick={() => navigate(to)}
      className="fixed top-0 left-0 z-40 transition-opacity duration-300 cursor-pointer flex items-center justify-center"
      style={{
        width: SIZE + HIT_PADDING * 2,
        height: SIZE + HIT_PADDING * 2,
        padding: HIT_PADDING,
        opacity: 0,
        pointerEvents: 'none',
        willChange: 'transform',
        // Position is applied via translate() on the button itself, so
        // offset the anchor by -HIT_PADDING in both axes so the visible icon
        // lines up with state.current.x/y.
        marginLeft: -HIT_PADDING,
        marginTop: -HIT_PADDING,
      }}
    >
      <Icon className={glow} />
    </button>
  )
}
