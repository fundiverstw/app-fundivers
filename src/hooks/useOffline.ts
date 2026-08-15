import { useContext } from 'react'
import { OfflineContext, type OfflineContextValue } from './offline-context'

/**
 * The on-device day-board snapshot and its sync state.
 *
 * Returns null outside <OfflineProvider> rather than throwing, unlike
 * useAuth(): the provider wraps the staff chrome only, and a shared component
 * that also renders on a diver page must be able to ask without knowing which
 * side of that line it is on.
 */
export function useOffline(): OfflineContextValue | null {
  return useContext(OfflineContext)
}
