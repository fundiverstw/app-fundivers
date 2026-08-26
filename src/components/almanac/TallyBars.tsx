/**
 * A categorical reading counted across a day's observations.
 *
 * Two shapes, one component. An `ordered` reading (current strength, coral
 * health, route condition) keeps its scale's own order — including the levels
 * nobody reported, because "nobody called it strong" is part of the day — and
 * steps its fill along the scale so position reads without the labels. An
 * unordered one (weather, wildlife) lists only what was seen, commonest first,
 * every bar the same fill: there is no rank to encode.
 */
import type { Tally } from '../../lib/almanac-stats'
import { CHART_INK, TEXT_BODY, TEXT_SUBTLE } from '../../styles/tokens'

interface Props<T extends string> {
  label: string
  entries: Tally<T>[]
  labelOf: (value: T) => string
  /** True when the values sit on a scale, so the fill may step along it. */
  ordered?: boolean
}

export function TallyBars<T extends string>({ label, entries, labelOf, ordered = false }: Props<T>) {
  if (entries.length === 0) return null
  const peak = Math.max(...entries.map(e => e.count))
  if (peak === 0) return null

  return (
    <div className="space-y-1">
      <span className={`text-xs ${TEXT_SUBTLE}`}>{label}</span>
      <ul className={`space-y-1 ${CHART_INK}`}>
        {entries.map((entry, i) => (
          <li key={entry.value} className="flex items-center gap-2">
            <span className={`w-24 shrink-0 truncate text-[11px] ${entry.count === 0 ? TEXT_SUBTLE : TEXT_BODY}`}>
              {labelOf(entry.value)}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-sm bg-current/10">
              <span
                className="block h-full rounded-r-[4px] bg-current"
                style={{
                  width: `${(entry.count / peak) * 100}%`,
                  opacity: ordered && entries.length > 1 ? 0.4 + (0.6 * i) / (entries.length - 1) : 1,
                }}
              />
            </span>
            <span className={`w-4 shrink-0 text-right text-[11px] tabular-nums ${entry.count === 0 ? TEXT_SUBTLE : TEXT_BODY}`}>
              {entry.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
