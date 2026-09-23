import { gearPieceKey } from '../../lib/gear-packed'
import { t } from '../../i18n'

const gr = t.admin.groups
const gc = t.admin.gearCard

export interface CareItemRow {
  item: string
  divers: Array<{ bookingId: string; name: string }>
}

/**
 * "Handle with care" inventory for one event: delicate rentals (dive
 * computers, lights, cameras) issued separately from the dive bags. Each item
 * shows a count and the divers who rented it, so staff can check every renter
 * gets — and returns — their piece. Returns null when nothing delicate is out.
 *
 * Given `packed`, each name becomes a tick off the same day list the dive-bag
 * chips use: these pieces are carried out of the shop like any other, and a
 * checklist you cannot mark is one staff end up keeping on paper.
 */
export function CareGearGroup({ rows, packed, onTogglePiece }: {
  rows: CareItemRow[]
  packed?: Set<string>
  onTogglePiece?: (bookingId: string, item: string) => void
}) {
  if (rows.length === 0) return null
  const ticking = !!packed && !!onTogglePiece
  return (
    <div role="group" aria-label={gr.handleWithCare} className="bg-amber-50/80 backdrop-blur-md border border-amber-300 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-bold text-amber-900">{gr.handleWithCare}</h2>
      <ul className="space-y-2">
        {rows.map(r => {
          const ticked = packed ? r.divers.filter(d => packed.has(gearPieceKey(d.bookingId, r.item))).length : 0
          return (
            <li key={r.item} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-amber-900">{r.item}</span>
                <span className="text-xs text-amber-900 font-semibold">
                  {ticking && ticked > 0 && (
                    <span className={ticked === r.divers.length ? 'text-emerald-700' : ''}>
                      {ticked === r.divers.length ? gc.packedAll : gc.packedSome(ticked, r.divers.length)}{' · '}
                    </span>
                  )}
                  ×{r.divers.length}
                </span>
              </div>
              {ticking ? (
                <ul className="flex flex-wrap gap-1.5">
                  {r.divers.map(d => {
                    const isPacked = packed!.has(gearPieceKey(d.bookingId, r.item))
                    return (
                      <li key={d.bookingId}>
                        <button
                          type="button"
                          onClick={() => onTogglePiece!(d.bookingId, r.item)}
                          aria-pressed={isPacked}
                          aria-label={isPacked ? gc.unmarkItemPacked(d.name, r.item) : gc.markItemPacked(d.name, r.item)}
                          className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                            isPacked
                              ? 'border-emerald-500 bg-emerald-100 text-emerald-800 font-semibold'
                              : 'border-amber-400 text-amber-950 font-medium hover:border-amber-600 hover:bg-amber-100'
                          }`}
                        >
                          {isPacked ? `${d.name} ✓` : d.name}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-xs text-amber-950 font-medium">
                  {r.divers.map(d => d.name).join(', ')}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
