import { useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { FeaturedEvents } from '../components/dashboard/FeaturedEvents'
import { WelcomeBanner } from '../components/welcome/WelcomeBanner'

// Ocean-themed rising bubbles, shared by admin and diver landings. Replaces
// the old stats cards (which nobody looked at — actionable data lives on the
// tabs). Pure canvas, no per-frame React updates; cleans up on unmount.
//
// Each bubble is an independent particle (random x, varied radius and rise
// speed, slight horizontal sine wobble) so they don't form visible columns
// the way a fixed-grid would. Drawn as a translucent fill plus a brighter
// stroke so they read as bubbles rather than solid balls.

const BUBBLES_PER_KILOPIX = 0.12  // bubble count = ceil(area_px * this / 1000)
const RISE_PX_PER_SEC_BASE = 50
const MIN_RADIUS = 3
const MAX_RADIUS = 14

interface Bubble {
  x: number              // horizontal anchor
  y: number              // current vertical (px from top)
  r: number              // radius (px)
  speed: number          // multiplier on RISE_PX_PER_SEC_BASE
  wobbleAmp: number      // peak horizontal drift (px)
  wobblePhase: number    // 0..2π — desyncs each bubble's wobble
  wobbleHz: number       // wobble cycles per second (slow)
}

export function DashboardPage() {
  const { user } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    let bubbles: Bubble[] = []
    let raf = 0
    let lastTs = 0
    let running = true

    function newBubble(spawnAtRandomY: boolean): Bubble {
      const r = MIN_RADIUS + Math.random() * (MAX_RADIUS - MIN_RADIUS)
      return {
        x: Math.random() * width,
        // Initial population spreads through the visible area so the first
        // frame isn't empty; respawns enter from below the bottom edge.
        y: spawnAtRandomY ? Math.random() * height : height + r + Math.random() * 40,
        r,
        // Smaller bubbles drift up slower (matches real fluid behaviour
        // and reads as depth — bigger = closer to the surface).
        speed: 0.6 + Math.random() * 0.9 + (r / MAX_RADIUS) * 0.4,
        wobbleAmp: 8 + Math.random() * 24,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleHz: 0.15 + Math.random() * 0.35,
      }
    }

    function setupGrid() {
      if (!canvas || !container || !ctx) return
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      width = rect.width
      height = rect.height
      const target = Math.ceil((width * height / 1000) * BUBBLES_PER_KILOPIX)
      bubbles = Array.from({ length: target }, () => newBubble(true))
    }

    function draw(ts: number) {
      if (!ctx) return
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0
      lastTs = ts
      const tSec = ts / 1000

      // Hard navy fill each frame — no trail wash, otherwise the random
      // x positions blur into a uniform haze instead of distinct bubbles.
      ctx.fillStyle = '#1e3a8a' // brand-900
      ctx.fillRect(0, 0, width, height)

      for (const b of bubbles) {
        const x = b.x + Math.sin(tSec * b.wobbleHz * Math.PI * 2 + b.wobblePhase) * b.wobbleAmp

        ctx.beginPath()
        ctx.arc(x, b.y, b.r, 0, Math.PI * 2)
        ctx.fillStyle   = 'rgba(255, 255, 255, 0.18)' // semi-transparent fill
        ctx.fill()
        ctx.lineWidth   = Math.max(1, b.r * 0.12)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)' // brighter rim
        ctx.stroke()

        b.y -= RISE_PX_PER_SEC_BASE * b.speed * dt

        // Once a bubble clears the top, respawn at a fresh random x below
        // the bottom edge with new attributes — keeps the pattern non-
        // periodic.
        if (b.y < -b.r) Object.assign(b, newBubble(false))
      }

      if (running) raf = requestAnimationFrame(draw)
    }

    function onVisibility() {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        lastTs = 0
        raf = requestAnimationFrame(draw)
      }
    }

    setupGrid()
    const ro = new ResizeObserver(setupGrid)
    ro.observe(container)
    document.addEventListener('visibilitychange', onVisibility)
    raf = requestAnimationFrame(draw)

    return () => {
      running = false
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative -m-4 -mb-24 h-[calc(100vh-3rem)] bg-brand-900 overflow-hidden"
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
      {user && (
        <div className="absolute top-4 right-4 left-auto max-w-sm">
          <WelcomeBanner user={user} />
        </div>
      )}
      <FeaturedEvents />
    </div>
  )
}
