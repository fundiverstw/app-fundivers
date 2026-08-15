import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './useAuth'
import { todayIso } from '../lib/dates'
import { fetchDayBoard, fetchDayTransport } from '../lib/day-board'
import { fetchUpcomingEventDays } from '../lib/events'
import { fetchVehicles } from '../lib/vehicles'
import { fetchGearModelsWithSizes } from '../lib/gear-models'
import { readStoredSnapshot, writeStoredSnapshot } from '../lib/offline-db'
import { buildSnapshot, isUsableSnapshot, type OfflineSnapshot } from '../lib/offline-snapshot'
import { OfflineContext, type OfflineSyncStatus } from './offline-context'

/** How often a capture is retried while the app stays open and online. Long
 *  enough that it costs nothing on a phone, short enough that a roster edited
 *  at the shop is on the van before it leaves. */
const RESYNC_INTERVAL_MS = 15 * 60 * 1000

/** How far the "Other day" picker looks ahead — beyond the ten captured days,
 *  so the picker still lists the days that exist even though their boards are
 *  not stored. Matches the online lookahead the page uses. */
const LOOKAHEAD_DAYS = 30

/**
 * Keeps the next ten days on this device for whoever runs the shop.
 *
 * Mounted around the staff/admin chrome rather than around a single page: a
 * snapshot that only refreshes while somebody happens to have the logistics
 * board open is a snapshot that is missing the moment it matters. Divers never
 * mount this — their surfaces are online-only and their device has no business
 * holding other divers' rosters.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const userId = user?.id ?? null
  const isStaff = profile?.role === 'admin' || profile?.role === 'staff'

  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null)
  const [status, setStatus] = useState<OfflineSyncStatus>('idle')
  const [online, setOnline] = useState(
    () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  )
  // Guards against a second capture starting while one is in flight — the
  // interval, the online event and the manual button can all fire at once.
  const running = useRef(false)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  // Load what this device already holds before attempting anything over the
  // network: an app opened with no signal has to render the stored board, not
  // wait on a capture that cannot happen.
  useEffect(() => {
    if (!userId || !isStaff) return
    let cancelled = false
    ;(async () => {
      const stored = await readStoredSnapshot<unknown>()
      if (cancelled) return
      setSnapshot(isUsableSnapshot(stored, userId) ? stored : null)
    })()
    return () => { cancelled = true }
  }, [userId, isStaff])

  const refresh = useCallback(async () => {
    if (!userId || !isStaff || running.current) return
    running.current = true
    setStatus('syncing')
    try {
      const next = await buildSnapshot(
        userId,
        todayIso(),
        new Date().toISOString(),
        {
          fetchDayBoard,
          fetchDayTransport,
          fetchUpcomingDays: fetchUpcomingEventDays,
          fetchVehicles,
          fetchGearModels: fetchGearModelsWithSizes,
        },
        LOOKAHEAD_DAYS,
      )
      await writeStoredSnapshot(next)
      setSnapshot(next)
      setStatus('synced')
    } catch {
      // Keep whatever was already stored. A failed capture leaves the board on
      // the previous snapshot with its own older timestamp, which is honest;
      // discarding it would trade stale data for none.
      setStatus('failed')
    } finally {
      running.current = false
    }
  }, [userId, isStaff])

  // Capture on sign-in, whenever the connection comes back, and on a timer.
  useEffect(() => {
    if (!userId || !isStaff || !online) return
    // Kicking off a network capture is what this effect is for; the status
    // setState inside it is the subscription reporting back, not a render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const id = setInterval(() => { void refresh() }, RESYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [userId, isStaff, online, refresh])

  // Gate on the id rather than clearing state when the user changes: React
  // state from the previous session would otherwise stay readable for the tick
  // between sign-out and the effect running. The snapshot names who captured
  // it, so the check is exact.
  const visible = snapshot && isStaff && snapshot.userId === userId ? snapshot : null

  return (
    <OfflineContext.Provider value={{ snapshot: visible, status, online, refresh }}>
      {children}
    </OfflineContext.Provider>
  )
}
