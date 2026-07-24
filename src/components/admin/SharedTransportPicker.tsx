import { t } from '../../i18n'

const tp = t.admin.transport

export interface SharedTransportEvent {
  id: string
  title: string
}

interface Props {
  /** The day's events, in display order. */
  events: SharedTransportEvent[]
  /** event_id → ride group id, for the events that travel in company. */
  groupOf: Map<string, string>
  isAdmin: boolean
  busy: boolean
  /** Put `eventId` on the same run as `withEventId`. */
  onShareWith: (eventId: string, withEventId: string) => void
  /** Take `eventId` off its run. */
  onRideAlone: (eventId: string) => void
}

/**
 * Which of the day's events travel together. Nothing in the data model can
 * derive this — two dives at the same site share a van, two at different sites
 * can't — so the shop states it here, per day, and every seat count follows
 * from it (src/lib/vehicle-planning.ts).
 *
 * One picker per event: ride alone, or ride with another event. Picking an
 * event that's already in a run joins that whole run, so three events end up
 * together by choosing the same partner twice. Staff (read-only) see the
 * groupings as text.
 */
export function SharedTransportPicker({
  events, groupOf, isAdmin, busy, onShareWith, onRideAlone,
}: Props) {
  // Nothing to share with.
  if (events.length < 2) return null

  const partnersOf = (id: string) =>
    events.filter(e => e.id !== id && groupOf.get(e.id) && groupOf.get(e.id) === groupOf.get(id))

  if (!isAdmin) {
    const shared = events.filter(e => partnersOf(e.id).length > 0)
    if (shared.length === 0) return null
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-100/70">{tp.sharedTransport}</p>
        {shared.map(e => (
          <p key={e.id} className="text-sm text-brand-900 font-medium">
            {e.title}{tp.runJoin}{partnersOf(e.id).map(p => p.title).join(tp.runJoin)}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-100/70">{tp.sharedTransport}</p>
      <p className="text-xs text-brand-950/70 font-medium">{tp.sharedTransportHint}</p>
      {events.map(e => {
        const partners = partnersOf(e.id)
        return (
          <label key={e.id} className="flex flex-wrap items-center gap-1.5 text-xs text-brand-900 font-medium">
            <span className="truncate max-w-[12rem]">{e.title}</span>
            <select
              aria-label={tp.ridesWithAria(e.title)}
              disabled={busy}
              value={partners[0]?.id ?? ''}
              onChange={ev => {
                if (ev.target.value) onShareWith(e.id, ev.target.value)
                else onRideAlone(e.id)
              }}
              className="px-2 py-1 rounded-full text-xs bg-surface-100 text-brand-900 border border-surface-200 disabled:opacity-50"
            >
              <option value="">{tp.ridesAlone}</option>
              {events.filter(o => o.id !== e.id).map(o => (
                <option key={o.id} value={o.id}>{tp.ridesWith(o.title)}</option>
              ))}
            </select>
          </label>
        )
      })}
    </div>
  )
}
