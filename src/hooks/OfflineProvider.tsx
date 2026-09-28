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

/** How old today's stored copy may get before a background capture replaces
 *  it. The timer, the online event and sign-in all ask; a copy younger than
 *  this answers them without a single request. */
const FRESH_FOR_MS = 30 * 60 * 1000

/** How often the background capture checks while the app stays open. */
const RESYNC_INTERVAL_MS = 15 * 60 * 1000

/** How long after sign-in the first background capture waits. The page the
 *  user landed on loads first; the capture is never on the critical path. */
const FIRST_CAPTURE_DELAY_MS = 10 * 1000

/** How far the "Other day" picker looks ahead — beyond the ten captured days,
 *  so the picker still lists the days that exist even though their boards are
 *  not stored. Matches the online lookahead the page uses. */
const LOOKAHEAD_DAYS = 30

/**
 * Keeps today's board on this device for whoever runs the shop.
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
  // The copy on hand, for the freshness check. A ref rather than a dependency
  // so a finished capture does not re-create `capture` and restart the timer.
  const snapshotRef = useRef<OfflineSnapshot | null>(null)
  useEffect(() => { snapshotRef.current = snapshot }, [snapshot])

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

  const capture = useCallback(async (force: boolean) => {
    if (!userId || !isStaff || running.current) return
    const held = snapshotRef.current
    if (
      !force && held && held.userId === userId && held.days.includes(todayIso())
      && Date.now() - Date.parse(held.capturedAt) < FRESH_FOR_MS
    ) return
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

  // The Save now button: always captures, however fresh the copy on hand.
  const refresh = useCallback(() => capture(true), [capture])

  // In the background: shortly after sign-in, whenever the connection comes
  // back, and on a timer — each skipped while today's copy is still fresh.
  useEffect(() => {
    if (!userId || !isStaff || !online) return
    const first = setTimeout(() => { void capture(false) }, FIRST_CAPTURE_DELAY_MS)
    const id = setInterval(() => { void capture(false) }, RESYNC_INTERVAL_MS)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [userId, isStaff, online, capture])

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
