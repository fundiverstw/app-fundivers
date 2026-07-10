import type { Profile } from '../../types/database'
import { t } from '../../i18n'

export interface TransportRow {
  booking: { id: string }
  profile: Profile | null
}

/**
 * A labelled list of divers for one transport bucket (needs ride / self /
 * unspecified) showing name + phone. Shared by the per-event transportation
 * tab and the day-of Logistics view.
 */
export function TransportGroup({ title, rows, emptyHint, note }: {
  title: string
  rows: TransportRow[]
  emptyHint: string
  note?: string
}) {
  return (
    <div role="group" aria-label={title} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-brand-900">{title}</h2>
        <span className="text-xs text-brand-900 font-semibold">{rows.length}</span>
      </div>
      {note && <p className="text-xs text-brand-950 font-medium italic">{note}</p>}
      {rows.length === 0 ? (
        <p className="text-xs text-brand-950/70 font-medium italic">{emptyHint}</p>
      ) : (
        <ul className="divide-y divide-surface-200">
          {rows.map(r => (
            <li key={r.booking.id} className="py-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm text-brand-900 font-medium">
                {r.profile?.name ?? t.admin.transport.noProfile}
                {r.profile?.nickname && r.profile.nickname !== r.profile.name && (
                  <span className="text-brand-900 font-medium"> ({r.profile.nickname})</span>
                )}
              </span>
              {r.profile?.contact_id && (
                <span className="text-xs text-brand-950 font-medium shrink-0">{r.profile.contact_id}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
