export interface AddonCount {
  title: string
  count: number
}

/**
 * All add-ons rented for one event, by catalog title with a per-item count —
 * the shop's prep list (SMBs, extra wetsuits, nitrox tanks, course upgrades,
 * lights, cameras, …). Delicate items also appear in "Handle with care" with
 * per-diver detail; this is the full at-a-glance tally. Returns null when the
 * event has no add-ons.
 */
export function AddonSummaryGroup({ rows }: { rows: AddonCount[] }) {
  if (rows.length === 0) return null
  return (
    <div role="group" aria-label="Add-ons" className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-bold text-blue-900">Add-ons</h2>
      <div className="flex flex-wrap gap-1.5">
        {rows.map(r => (
          <span key={r.title} className="text-xs px-2 py-0.5 rounded-full border border-sky-400 bg-sky-50 text-blue-900 font-medium">
            {r.title} ×{r.count}
          </span>
        ))}
      </div>
    </div>
  )
}
