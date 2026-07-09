import { t } from '../../i18n'

const gr = t.admin.groups

export interface CareItemRow {
  item: string
  divers: Array<{ bookingId: string; name: string }>
}

/**
 * "Handle with care" inventory for one event: delicate rentals (dive
 * computers, lights, cameras) issued separately from the dive bags. Each item
 * shows a count and the divers who rented it, so staff can check every renter
 * gets — and returns — their piece. Returns null when nothing delicate is out.
 */
export function CareGearGroup({ rows }: { rows: CareItemRow[] }) {
  if (rows.length === 0) return null
  return (
    <div role="group" aria-label={gr.handleWithCare} className="bg-amber-50/80 backdrop-blur-md border border-amber-300 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-bold text-amber-900">{gr.handleWithCare}</h2>
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.item} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-amber-900">{r.item}</span>
              <span className="text-xs text-amber-900 font-semibold">×{r.divers.length}</span>
            </div>
            <p className="text-xs text-amber-950 font-medium">
              {r.divers.map(d => d.name).join(', ')}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
