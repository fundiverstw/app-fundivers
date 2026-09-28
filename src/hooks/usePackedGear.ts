import { useCallback, useEffect, useState } from 'react'
import {
  applyPending, loadPackedGear, loadPendingPacks, savePackedGear, savePendingPacks, setPiecesPacked,
} from '../lib/gear-packed'
import { fetchPackedKeys, subscribePacked, writePacked } from '../lib/packed-sync'

/**
 * The day's pack list as the whole crew sees it.
 *
 * A tick shows at once (optimistic), is queued on the device, and is sent to
 * the shared list; a colleague's tick arrives live. With no connection, ticks
 * keep working against the device's copy and the queue is sent when the
 * connection comes back — `pending` says how many are still waiting, because a
 * tick nobody else can see yet is exactly how a piece gets packed twice.
 *
 * On reconnect and whenever the page comes back into view the list is read
 * again in full: a phone asleep in a pocket misses live updates, and the read
 * is one small query.
 */
export function usePackedGear(day: string, online: boolean) {
  const [packed, setPacked] = useState<Set<string>>(() => (day ? loadPackedGear(day) : new Set()))
  const [pending, setPending] = useState(() => (day ? loadPendingPacks(day).size : 0))

  const commit = useCallback((next: Set<string>) => {
    setPacked(next)
    savePackedGear(day, next)
  }, [day])

  // Send what is queued, then take the server's list with anything still
  // unsent laid over it.
  const sync = useCallback(async () => {
    const queued = loadPendingPacks(day)
    for (const value of [true, false]) {
      const keys = [...queued].filter(([, v]) => v === value).map(([k]) => k)
      try {
        await writePacked(day, keys, value)
        const left = loadPendingPacks(day)
        for (const k of keys) if (left.get(k) === value) left.delete(k)
        savePendingPacks(day, left)
      } catch { /* still queued; the next sync tries again */ }
    }
    const server = await fetchPackedKeys(day)
    const left = loadPendingPacks(day)
    commit(applyPending(server, left))
    setPending(left.size)
  }, [day, commit])

  useEffect(() => {
    if (!day) return
    // The device's copy paints first; the server's list replaces it below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPacked(loadPackedGear(day))
    setPending(loadPendingPacks(day).size)
  }, [day])

  useEffect(() => {
    if (!day || !online) return
    void sync().catch(() => { /* offline copy stays on screen */ })
    const unsubscribe = subscribePacked(day, (key, value) => {
      // This device's own unsent tick is newer than whatever just arrived.
      if (loadPendingPacks(day).has(key)) return
      setPacked(prev => {
        if (prev.has(key) === value) return prev
        const next = new Set(prev)
        if (value) next.add(key)
        else next.delete(key)
        savePackedGear(day, next)
        return next
      })
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [day, online, sync])

  const setPieces = useCallback((keys: string[], value: boolean) => {
    commit(setPiecesPacked(packed, keys, value))
    const queued = loadPendingPacks(day)
    for (const k of keys) queued.set(k, value)
    savePendingPacks(day, queued)
    setPending(queued.size)
    if (!online) return
    void writePacked(day, keys, value).then(() => {
      const left = loadPendingPacks(day)
      for (const k of keys) if (left.get(k) === value) left.delete(k)
      savePendingPacks(day, left)
      setPending(left.size)
    }).catch(() => { /* stays queued; sent on reconnect or the next sync */ })
  }, [packed, day, online, commit])

  const toggle = useCallback((key: string) => setPieces([key], !packed.has(key)), [packed, setPieces])

  return { packed, toggle, setPieces, pending }
}
