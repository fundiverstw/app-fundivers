import { useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { SharkBouncer } from '../components/dashboard/SharkBouncer'

// Ocean-themed rising bubbles, shared by admin and diver landings. Replaces
// the old stats cards (which nobody looked at — actionable data lives on the
// tabs). Pure canvas, no per-frame React updates; cleans up on unmount.
//
// Drawing circles (not glyphs) keeps each bubble a fixed size, which avoids
// the per-frame jitter you get when fillText re-rasterizes a different random
// unicode char every tick.

const COLUMN_WIDTH = 18          // horizontal spacing between bubble trails (px)
const RISE_PX_PER_SEC = 130
const TRAIL_FADE_ALPHA = 0.08    // smaller = longer trails, larger = snappier reset
const HEAD_RADIUS = 3

export function DashboardPage() {
  const { profile } = useAuth()
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
    // Each column tracks its rising head-y (in px), a speed factor so bubbles
    // don't rise in lockstep, and a radius for size variation.
    let columns: Array<{ y: number; speed: number; radius: number }> = []
    let raf = 0
    let lastTs = 0
    let running = true

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
      const colCount = Math.ceil(width / COLUMN_WIDTH)
      // Spread columns through the full height so the first frame isn't an
      // empty screen waiting for bubbles to enter from the bottom.
      columns = Array.from({ length: colCount }, () => ({
        y: Math.random() * height * 1.5,
        speed: 0.6 + Math.random() * 0.8,
        radius: HEAD_RADIUS * (0.7 + Math.random() * 0.6),
      }))
      ctx.fillStyle = '#020617' // slate-950 — prime so the first frame isn't black-flashed
      ctx.fillRect(0, 0, width, height)
    }

    function draw(ts: number) {
      if (!ctx) return
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0
      lastTs = ts

      // Translucent wash → fading trails.
      ctx.fillStyle = `rgba(2, 6, 23, ${TRAIL_FADE_ALPHA})`
      ctx.fillRect(0, 0, width, height)

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]
        const x = i * COLUMN_WIDTH + COLUMN_WIDTH / 2

        ctx.beginPath()
        ctx.arc(x, col.y, col.radius, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(224, 242, 254, 0.9)' // sky-100 head
        ctx.fill()

        col.y -= RISE_PX_PER_SEC * col.speed * dt

        // Once the bubble clears the top, respawn below the bottom with small
        // probability so columns stagger rather than all reseeding at once.
        if (col.y < -col.radius && Math.random() > 0.96) {
          col.y = height + Math.random() * height * 0.5
          col.speed = 0.6 + Math.random() * 0.8
          col.radius = HEAD_RADIUS * (0.7 + Math.random() * 0.6)
        }
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
      className="relative -m-4 -mb-24 h-[calc(100vh-3rem)] bg-slate-950 overflow-hidden"
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
      <div className="absolute top-4 left-4 text-cyan-200/60 font-mono text-xs pointer-events-none select-none">
        <p className="font-bold tracking-[0.25em]">FUNDIVERS · TW</p>
        <p className="text-cyan-300/40">
          {profile?.role === 'admin' ? 'admin console' : 'diver console'}
        </p>
      </div>
      <SharkBouncer />
    </div>
  )
}
