import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchNotifications, markRead, markAllRead } from '../lib/notifications'
import type { Notification } from '../types/database'
import { ON_DEEP_BODY, ON_DEEP_MUTED } from '../styles/tokens'

export function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchNotifications()
      .then(rows => { if (!cancelled) { setItems(rows); setError(null) } })
      .catch(err => { if (!cancelled) setError((err as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const unreadCount = items.filter(n => n.read_at === null).length

  async function handleClick(n: Notification) {
    if (n.read_at === null) {
      // Optimistic local update; server confirms via markRead.
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      try { await markRead(n.id) } catch { /* tolerate — next reload will resync */ }
    }
    if (n.url) navigate(n.url)
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
          return (
            <li key={n.id}>
              <button
                onClick={() => handleClick(n)}
                className={`w-full text-left rounded-xl p-3 border transition-colors ${
                  unread
                    ? 'bg-white/85 border-sky-300 hover:bg-white'
                    : 'bg-white/55 border-sky-200/60 hover:bg-white/70'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  {unread && <span aria-hidden className="w-2 h-2 rounded-full bg-red-500 shrink-0 translate-y-1" />}
                  <p className={`flex-1 text-sm ${unread ? 'font-semibold' : 'font-medium'} text-blue-900`}>{n.title}</p>
                  <span className="text-[11px] text-blue-900/60 shrink-0">{relativeTime(n.created_at)}</span>
                </div>
                {n.body && <p className={`text-xs ${ON_DEEP_BODY} mt-1 ml-${unread ? '4' : '0'} text-blue-900/85`}>{n.body}</p>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
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
