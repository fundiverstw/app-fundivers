import { format } from 'date-fns'
import type { OfflineContextValue } from '../../hooks/offline-context'
import type { DayBoardSource } from '../../lib/day-board-source'
import { OFFLINE_DAYS } from '../../lib/offline-snapshot'
import { BTN_XS_GHOST, TEXT_MUTED } from '../../styles/tokens'
import { t } from '../../i18n'

const lo = t.admin.logistics.offline

// Date as well as time. "Saved at 07:14" on a board that was last online
// yesterday reads as this morning, which is the exact misreading this whole
// indicator exists to prevent.
function stamp(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d, HH:mm')
}

/**
 * Says where the day on screen came from, and lets staff force a save before
 * they leave signal.
 *
 * Two visual weights on purpose. A board served off the device is an amber
 * panel — it is a different thing from a live one and has to look like it. A
 * live board gets one dim line, because a status indicator that shouts on every
 * normal day is one nobody reads on the day it matters.
 */
export function OfflineBoardStatus({
  offline, source,
}: {
  offline: OfflineContextValue | null
  /** null while the day is still loading. */
  source: DayBoardSource | 'unavailable' | null
}) {
  if (!offline) return null
  const { snapshot, status, online, refresh } = offline
  const busy = status === 'syncing'

  if (source === 'snapshot') {
    return (
      <div className="bg-amber-400/10 border border-amber-400/40 rounded-xl p-3 space-y-1" role="status">
        <p className="text-sm font-semibold text-amber-300">
          {lo.showingSaved(snapshot ? stamp(snapshot.capturedAt) : '—')}
        </p>
        <p className="text-xs text-brand-50/80 font-medium">{lo.redacted}</p>
        {status === 'failed' && (
          <p className="text-xs text-brand-50/80 font-medium">{lo.saveFailed}</p>
        )}
      </div>
    )
  }

  if (source === 'unavailable') {
    return (
      <div className="bg-amber-400/10 border border-amber-400/40 rounded-xl p-3" role="status">
        <p className="text-sm font-semibold text-amber-300">{lo.unavailable}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`${TEXT_MUTED} font-medium`}>
        {snapshot ? lo.savedAt(stamp(snapshot.capturedAt)) : lo.neverSaved}
        {snapshot && ` · ${lo.savedDays(OFFLINE_DAYS)}`}
      </span>
      <button
        type="button"
        className={BTN_XS_GHOST}
        onClick={() => { void refresh() }}
        disabled={busy || !online}
      >
        {busy ? lo.saving : lo.saveNow}
      </button>
      {status === 'failed' && (
        <span className={`${TEXT_MUTED} font-medium`}>{lo.saveFailed}</span>
      )}
    </div>
  )
}
