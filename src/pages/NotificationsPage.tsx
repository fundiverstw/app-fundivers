import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchNotifications, markRead, markAllRead } from '../lib/notifications'
import type { Notification } from '../types/database'
import { ON_DEEP_MUTED } from '../styles/tokens'

export function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Tap a row to expand; tap again to collapse. Only one row open at a
  // time so the list stays scannable.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    fetchNotifications()
      .then(rows => { if (!cancelled) { setItems(rows); setError(null) } })
      .catch(err => { if (!cancelled) setError((err as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const unreadCount = items.filter(n => n.read_at === null).length

  async function handleToggle(n: Notification) {
    const willExpand = expandedId !== n.id
    setExpandedId(willExpand ? n.id : null)
    // Mark-as-read fires on first expand of an unread row. Optimistic
    // local update so the dot disappears instantly.
    if (willExpand && n.read_at === null) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      try { await markRead(n.id) } catch { /* tolerate — next reload will resync */ }
    }
  }

  async function handleMarkAll() {
    const stamped = new Date().toISOString()
    setItems(prev => prev.map(x => x.read_at === null ? { ...x, read_at: stamped } : x))
    try { await markAllRead() } catch { /* server resync on next reload */ }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold text-white">Notifications</h1>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAll}
            className="text-xs px-2 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-red-500 rounded-md p-2">{error}</p>
      )}

      {loading && items.length === 0 && (
        <p className={`text-sm ${ON_DEEP_MUTED}`}>Loading…</p>
      )}

      {!loading && items.length === 0 && (
        <p className={`text-sm ${ON_DEEP_MUTED}`}>No notifications yet.</p>
      )}

      <ul className="space-y-2">
        {items.map(n => {
          const unread = n.read_at === null
          const expanded = expandedId === n.id
          return (
            <li key={n.id}>
              <div
                className={`rounded-xl border transition-colors overflow-hidden ${
                  unread
                    ? 'bg-white/85 border-sky-300'
                    : 'bg-white/55 border-sky-200/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleToggle(n)}
                  aria-expanded={expanded}
                  className={`w-full text-left p-3 ${unread ? 'hover:bg-white' : 'hover:bg-white/70'} transition-colors`}
                >
                  <div className="flex items-baseline gap-2">
                    {unread && <span aria-hidden className="w-2 h-2 rounded-full bg-red-500 shrink-0 translate-y-1" />}
                    <p className={`flex-1 text-sm ${unread ? 'font-semibold' : 'font-medium'} text-blue-900`}>{n.title}</p>
                    <span className="text-[11px] text-blue-900/60 shrink-0">{relativeTime(n.created_at)}</span>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-sky-200/60 bg-sky-50 px-3 pb-3 pt-2 space-y-2">
                    {n.body
                      ? n.is_ascii_art
                        ? <AsciiArtBody body={n.body} />
                        // Default branch: normal-size body that horizontally
                        // scrolls if a line happens to be wider than the card.
                        : <pre className="text-sm text-blue-950 font-mono whitespace-pre overflow-x-auto m-0">{n.body}</pre>
                      : <p className="text-xs italic text-blue-900/70">No additional details.</p>}
                    {n.url && (
                      <button
                        type="button"
                        onClick={() => navigate(n.url!)}
                        className="text-xs px-3 py-1.5 rounded-md bg-blue-900 hover:bg-blue-950 text-white font-semibold transition-colors"
                      >
                        {actionLabelForKind(n.kind)}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ASCII-art rendering: scale the font so an 80-char line fits the visible
// container width exactly, regardless of the user's monospace font and OS.
//
// Approach: measure a hidden 80-char ruler rendered at a known font-size
// (100px), divide the container's width by the ruler's width, multiply
// the known font-size by that ratio. No assumed monospace char-ratio —
// the browser's actual rendered width is what we scale against, which is
// why this works the same on Chrome/Safari (~0.6em chars) and Firefox or
// older Android (~0.65–0.7em chars). A ResizeObserver re-runs the math
// when the card width changes (window resize, expand/collapse).
//
// The 80 in RULER_LENGTH matches the admin form's documented 80×30 cap.
const RULER_LENGTH = 80
const RULER_FONT_PX = 100
const FONT_PX_FLOOR = 4
const FONT_PX_CEILING = 24

function AsciiArtBody({ body }: { body: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef   = useRef<HTMLSpanElement>(null)
  // Initial 8px is a safe mobile-ish default that makes the brief
  // pre-measurement render legible without overflowing typical screens.
  // useLayoutEffect overwrites it before paint on real browsers.
  const [fontPx, setFontPx] = useState<number>(8)

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure   = measureRef.current
    if (!container || !measure) return

    function recompute() {
      const containerW = container!.clientWidth
      const measureW   = measure!.getBoundingClientRect().width
      if (containerW <= 0 || measureW <= 0) return
      // measure span renders RULER_LENGTH chars at RULER_FONT_PX. Solve
      // linearly for the font-size at which RULER_LENGTH chars equal
      // containerW: target = RULER_FONT_PX × (containerW / measureW).
      const target = (containerW * RULER_FONT_PX) / measureW
      setFontPx(Math.max(FONT_PX_FLOOR, Math.min(target, FONT_PX_CEILING)))
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="overflow-hidden">
      {/* Hidden measurement ruler — rendered at a fixed large font for
          high-precision width measurement, then positioned off-screen
          so it doesn't affect layout or get read by assistive tech. */}
      <span
        ref={measureRef}
        aria-hidden="true"
        className="font-mono"
        style={{
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          fontSize: `${RULER_FONT_PX}px`,
          whiteSpace: 'pre',
        }}
      >
        {'0'.repeat(RULER_LENGTH)}
      </span>
      <pre
        data-ascii-art="true"
        className="text-blue-950 font-mono whitespace-pre m-0 p-0"
        style={{ fontSize: `${fontPx}px`, lineHeight: 1 }}
      >{body}</pre>
    </div>
  )
}

// Action button label inside the expanded view. Tied to the `kind` so the
// CTA reads naturally — a reminder takes you to the event, a duty assignment
// to the duty page, etc.
function actionLabelForKind(kind: string): string {
  switch (kind) {
    case 'reminder':  return 'Open event'
    case 'duty':      return 'Go to duty'
    case 'broadcast': return 'Open link'
    default:          return 'Open'
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.round((now - then) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}
