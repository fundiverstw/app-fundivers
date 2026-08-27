import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import {
  fetchSeries, fetchSeriesOccurrences, fetchEventSeriesId, laterOccurrences,
  occurrenceDate, cancelLaterOccurrences, applyToLaterOccurrences, extendSeries,
} from '../../lib/event-series'
import { formStateFromEvent } from './event-form-state'
import { parseIsoDate } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { MAX_OCCURRENCES } from '../../lib/recurrence'
import type { EventRow, EventSeries } from '../../types/database'
import { t } from '../../i18n'
import { BTN_XS_GHOST, BTN_XS_DANGER } from '../../styles/tokens'

const sr = t.admin.series

// The Series panel on an event's admin page: where this occurrence sits in its
// batch, the rest of the batch, and the three things you can do to the ones
// after it.
//
// Every action stops at THIS occurrence — never touching it or anything before
// it. An admin opens the occurrence they are looking at, so "the rest of the
// series" has to mean what comes next, not "all of them including the past".
export function EventSeriesSection({ eventId, onChanged }: {
  eventId: string
  /** Called after an action that changed this event's siblings, so the page can
   *  refetch anything it derives from them. */
  onChanged?: () => void
}) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const toast = useToast()
  const [seriesId, setSeriesId] = useState<string | null>(null)
  const [series, setSeries] = useState<EventSeries | null>(null)
  const [occurrences, setOccurrences] = useState<EventRow[] | null>(null)
  const [busy, setBusy] = useState<'cancel' | 'apply' | 'extend' | null>(null)
  const [extendCount, setExtendCount] = useState('4')

  // The section resolves its own series rather than taking it as a prop.
  // AppEvent — what the page holds — has no series_id, and adding one would be
  // ambiguous: a course row expands into several AppEvents that all share one
  // series. The row is the thing that belongs to a batch.
  const load = useCallback(async () => {
    const id = await fetchEventSeriesId(eventId)
    setSeriesId(id)
    if (!id) { setSeries(null); setOccurrences([]); return }
    const [s, rows] = await Promise.all([fetchSeries(id), fetchSeriesOccurrences(id)])
    setSeries(s)
    setOccurrences(rows)
  }, [eventId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try { await load() } catch { if (!cancelled) setOccurrences([]) }
    })()
    return () => { cancelled = true }
  }, [load])

  if (!seriesId || !series || !occurrences || occurrences.length === 0) return null

  // Captured past the guard so the action closures below see a plain string.
  const sid = seriesId
  const index = occurrences.findIndex(r => r.id === eventId)
  const self = index >= 0 ? occurrences[index] : null
  const selfDate = self ? occurrenceDate(self) : null
  const later = selfDate ? laterOccurrences(occurrences, selfDate) : []

  async function run(kind: 'cancel' | 'apply' | 'extend', action: () => Promise<void>) {
    setBusy(kind)
    try {
      await action()
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(sr.actionFailed(errorMessage(err)))
    } finally {
      setBusy(null)
    }
  }

  function cancelRest() {
    if (!selfDate) return
    if (!window.confirm(sr.confirmCancelRest(later.length))) return
    void run('cancel', async () => {
      const result = await cancelLaterOccurrences({ seriesId: sid, fromDate: selfDate })
      toast.success(sr.cancelledCount(result.cancelled))
      if (result.credited > 0) toast.success(sr.creditedCount(result.credited))
      if (result.stoppedBy) toast.error(sr.stoppedEarly(result.cancelled, errorMessage(result.stoppedBy)))
    })
  }

  function applyToRest() {
    if (!self || !selfDate) return
    if (!window.confirm(sr.confirmApply(later.length))) return
    void run('apply', async () => {
      // The occurrence's own row is the source, so this pushes whatever is
      // currently saved on it — not a half-edited form.
      const touched = await applyToLaterOccurrences(sid, selfDate, formStateFromEvent(self))
      toast.success(sr.appliedCount(touched))
    })
  }

  function addMore() {
    const howMany = Number(extendCount)
    if (!Number.isInteger(howMany) || howMany < 1 || howMany > MAX_OCCURRENCES) {
      toast.error(sr.extendRange(MAX_OCCURRENCES))
      return
    }
    void run('extend', async () => {
      const result = await extendSeries(sid, howMany, row => formStateFromEvent(row))
      toast.success(sr.extendedCount(result.eventIds.length))
    })
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wider">{sr.heading}</h2>
        <p className="text-xs text-brand-900 font-medium">
          {index >= 0 ? sr.positionOf(index + 1, occurrences.length) : sr.notInSeries}
          {series.label ? ` · ${series.label}` : ''}
        </p>
        <p className="text-xs text-brand-950/70 font-medium">{describe(series)}</p>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {occurrences.map(row => {
          const date = occurrenceDate(row)
          const isSelf = row.id === eventId
          return (
            <li key={row.id}>
              <Link
                to={`/admin/events/${row.id}`}
                className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded border ${
                  isSelf
                    ? 'bg-surface-700 text-white border-surface-700'
                    : 'bg-white text-brand-900 border-surface-300 hover:border-brand-700'
                } ${row.cancelled_at ? 'line-through opacity-60' : ''}`}
              >
                {date ? format(parseIsoDate(date), 'EEE d MMM') : sr.noDate}
              </Link>
            </li>
          )
        })}
      </ul>

      {isAdmin && (
        <div className="space-y-2 pt-1 border-t border-surface-200">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={applyToRest}
              disabled={busy !== null || later.length === 0}
              className={BTN_XS_GHOST}
            >
              {busy === 'apply' ? sr.working : sr.applyToLater(later.length)}
            </button>
            <button
              type="button"
              onClick={cancelRest}
              disabled={busy !== null || later.length === 0}
              className={BTN_XS_DANGER}
            >
              {busy === 'cancel' ? sr.working : sr.cancelLater(later.length)}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-xs text-brand-900 font-medium mb-1">{sr.extendLabel}</span>
              <input
                type="number" min={1} max={MAX_OCCURRENCES} step={1}
                value={extendCount}
                onChange={e => setExtendCount(e.target.value)}
                className="w-20 bg-white border border-surface-300 rounded px-2 py-1 text-sm text-brand-900"
              />
            </label>
            <button
              type="button"
              onClick={addMore}
              disabled={busy !== null}
              className={BTN_XS_GHOST}
            >
              {busy === 'extend' ? sr.working : sr.extend}
            </button>
          </div>
          <p className="text-xs text-brand-950/70">{sr.actionsNote}</p>
        </div>
      )}
    </section>
  )
}

function describe(series: EventSeries): string {
  const every = series.interval === 1 ? '' : sr.everyN(series.interval)
  if (series.freq === 'daily') return sr.patternDaily(every)
  if (series.freq === 'monthly_weekday') return sr.patternMonthly(every)
  const days = (series.weekdays ?? [])
    .slice()
    .sort((a, b) => a - b)
    .map(d => t.admin.recurrence.weekdayShort[d - 1])
    .join(', ')
  return sr.patternWeekly(every, days)
}
