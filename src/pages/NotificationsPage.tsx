import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchNotifications, markRead, markAllRead } from '../lib/notifications'
import type { Notification } from '../types/database'
import { ON_DEEP_BODY, ON_DEEP_MUTED } from '../styles/tokens'

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
                  <div className="border-t border-sky-200/60 px-3 pb-3 pt-2 space-y-2">
                    {n.body
                      ? <p className={`text-sm ${ON_DEEP_BODY} text-blue-900/90 whitespace-pre-wrap`}>{n.body}</p>
                      : <p className={`text-xs italic text-blue-900/60`}>No additional details.</p>}
                    {n.url && (
                      <button
                        type="button"
                        onClick={() => navigate(n.url!)}
                        className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
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
