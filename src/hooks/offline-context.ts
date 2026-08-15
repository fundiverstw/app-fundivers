import { createContext } from 'react'
import type { OfflineSnapshot } from '../lib/offline-snapshot'

// Split from OfflineProvider.tsx for the same reason auth-context.ts is split
// from AuthProvider.tsx — react-refresh's "only export components" rule.

export type OfflineSyncStatus =
  /** No capture attempted yet this session. */
  | 'idle'
  /** A capture is running now. */
  | 'syncing'
  /** The last capture finished. */
  | 'synced'
  /** The last capture failed; any snapshot shown is the one before it. */
  | 'failed'

export interface OfflineContextValue {
  /** The usable stored snapshot, or null when there is none for this user. */
  snapshot: OfflineSnapshot | null
  status: OfflineSyncStatus
  /** Live connectivity, as the browser reports it. `navigator.onLine === true`
   *  only means "there is a network interface" — a request can still fail on a
   *  captive portal or a bar of signal — so the board treats a failed read as
   *  offline too rather than trusting this alone. */
  online: boolean
  /** Capture now. No-op while one is already running or while offline. */
  refresh: () => Promise<void>
}

export const OfflineContext = createContext<OfflineContextValue | null>(null)
