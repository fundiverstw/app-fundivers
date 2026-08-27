/**
 * One numeric reading's distribution for a site on a day.
 *
 * A day's stack is small — one reading per diver who filed — so every value is
 * plotted as its own dot rather than smoothed into a shape that implies more
 * data than there is. A box and whiskers only appear once the sample can
 * support quartiles (BOX_MIN_N); below that the dots and the mean are the
 * honest summary, and a lone reading is a number, not a plot at all.
 */
import { t } from '../../i18n'
import type { NumericSummary } from '../../lib/almanac-stats'
import { CHART_INK, CHART_RING, TEXT_BODY, TEXT_SUBTLE } from '../../styles/tokens'

/** Below this, quartiles describe the sample's accidents rather than the day. */
export const BOX_MIN_N = 5

const W = 320
const H = 30
const PAD = 12
const CY = H / 2
const DOT_R = 4
const BOX_H = 12
const MEDIAN_H = 18
/** Vertical room a stack of same-value dots may fan across. */
const BAND = H - DOT_R * 2 - 2
/** Comfortable gap between two dots; the fan tightens below this rather than
 *  spilling out of the track. */
const FAN_GAP = 9

/**
 * Where to put dots that share an x.
 *
 * A strip plot carries its meaning on one axis, so two divers who logged the
 * same temperature land on the same pixel and the day reads as thinner than it
 * was — five readings showing as three. They are spread ACROSS the track
 * rather than along it: nudging a dot sideways would misstate the reading it
 * stands for, where nudging it up says nothing except "there is more than one
 * of me here".
 *
 * Deterministic, not random: the same day has to draw the same way every time
 * it is looked at.
 */
function fanOffsets(count: number): number[] {
  if (count < 2) return [0]
  const step = Math.min(FAN_GAP, BAND / (count - 1))
  const span = step * (count - 1)
  return Array.from({ length: count }, (_, i) => -span / 2 + i * step)
}

interface Props {
  label: string
  summary: NumericSummary
  /** Observations filed for the day, so a skipped metric can say so. */
  total: number
  /** Renders a value the way its metric is written elsewhere (`28.0°C`). */
  format: (value: number) => string
}

export function ReadingStrip({ label, summary, total, format }: Props) {
  const { n, min, max, q1, q3, median, mean, values } = summary

  // An all-identical sample has no width to scale across; pad it so the stack
  // of dots lands mid-track instead of dividing by zero.
  const lo = min === max ? min - 0.5 : min
  const hi = min === max ? max + 0.5 : max
  const x = (v: number) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2)
  const box = n >= BOX_MIN_N

  const centres = values.map(() => CY)
  const sharing = new Map<string, number[]>()
  values.forEach((v, i) => {
    const key = x(v).toFixed(1)
    const seen = sharing.get(key)
    if (seen) seen.push(i)
    else sharing.set(key, [i])
  })
  for (const indexes of sharing.values()) {
    const offsets = fanOffsets(indexes.length)
    indexes.forEach((index, k) => { centres[index] = CY + offsets[k] })
  }
  // The day's own count is already in the header; repeating it under every
  // metric is noise. It earns its place only where this metric has fewer
  // readings than the day has observations — someone left it blank.
  const partial = n !== total

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-xs ${TEXT_SUBTLE}`}>{label}</span>
        <span className={`text-sm ${TEXT_BODY}`}>
          {n > 1 && <span className={`mr-1 text-[10px] ${TEXT_SUBTLE}`}>{t.almanac.avgPrefix}</span>}
          {format(mean)}
        </span>
      </div>

      {n > 1 && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={`h-auto w-full ${CHART_INK}`}
          role="img"
          aria-label={t.almanac.plotAria(label, n, format(min), format(max))}
        >
          <line x1={PAD} y1={CY} x2={W - PAD} y2={CY} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />

          {box && (
            <>
              <line x1={x(min)} y1={CY} x2={x(q1)} y2={CY} stroke="currentColor" strokeOpacity={0.45} strokeWidth={2} />
              <line x1={x(q3)} y1={CY} x2={x(max)} y2={CY} stroke="currentColor" strokeOpacity={0.45} strokeWidth={2} />
              <rect
                x={x(q1)} y={CY - BOX_H / 2} width={Math.max(x(q3) - x(q1), 2)} height={BOX_H}
                rx={2} fill="currentColor" fillOpacity={0.16}
              />
              <line
                x1={x(median)} y1={CY - MEDIAN_H / 2} x2={x(median)} y2={CY + MEDIAN_H / 2}
                stroke="currentColor" strokeOpacity={0.9} strokeWidth={2}
              />
            </>
          )}

          {values.map((v, i) => (
            <circle
              key={`${v}-${i}`}
              cx={x(v)} cy={centres[i]} r={DOT_R}
              fill="currentColor"
              strokeWidth={2}
              className={CHART_RING}
            />
          ))}
        </svg>
      )}

      {(n > 1 || partial) && (
        <div className={`flex text-[10px] ${n > 1 ? 'justify-between' : 'justify-center'} ${TEXT_SUBTLE}`}>
          {n > 1 && <span>{format(min)}</span>}
          {partial && <span>{t.almanac.observationCount(n)}</span>}
          {n > 1 && <span>{format(max)}</span>}
        </div>
      )}
    </div>
  )
}
