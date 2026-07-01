import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BellIcon } from './icons/BellIcon'
import { fetchUnreadCount, onNotificationsChanged } from '../lib/notifications'

export function NotificationBell() {
  const [count, setCount] = useState(0)
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    fetchUnreadCount()
      .then(n => { if (!cancelled) setCount(n) })
      .catch(() => { /* ignore — bell stays at last value */ })
    return () => { cancelled = true }
  }, [location.pathname])

  useEffect(() => {
    return onNotificationsChanged(() => {
      fetchUnreadCount().then(setCount).catch(() => {})
    })
  }, [])

  return (
    <Link
      to="/notifications"
      aria-label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'}
      className="relative inline-flex items-center justify-center text-white/80 hover:text-white transition-colors"
    >
      <BellIcon />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-accent text-[10px] font-bold leading-4 text-white text-center"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
