import type { GearDayDiff, GearDiffLine } from '../../lib/logistics'
import { t } from '../../i18n'

const lg = t.admin.logistics

// The three columns sit on the Overall board's dark glass, so each tone is a
// translucent fill + light ink rather than the light *-50 cards used elsewhere.
// Stays-out is emerald because it is the one column with no work in it; also-
// pack takes the reef accent (the app's "act here" teal); back-to-the-shop is
// deliberately the dimmest, since it's a note rather than a task.
const COLUMN_TONES = {
  keep: { label: 'text-emerald-300', chip: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-50' },
  add:  { label: 'text-reef-300',    chip: 'border-reef-400/45 bg-reef-400/10 text-reef-50' },
  free: { label: 'text-brand-100/70', chip: 'border-white/15 bg-white/5 text-brand-100/80' },
} as const

/** "BCD ×2", or "BCD · M ×2" once the shop packs the item in sizes. */
function pieceLabel(line: GearDiffLine, n: number): string {
  if (line.unknownSize) return lg.gearPieceSized(line.item, lg.sizeUnknown, n)
  return line.size ? lg.gearPieceSized(line.item, line.size, n) : lg.gearPiece(line.item, n)
}

function DiffColumn({ title, hint, tone, lines, count }: {
  title: string
  hint: string
  tone: keyof typeof COLUMN_TONES
  lines: Array<{ line: GearDiffLine; n: number }>
  count: number
}) {
  const { label, chip } = COLUMN_TONES[tone]
  return (
    <div role="group" aria-label={title} className="space-y-1.5">
      <div>
        <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${label}`}>
          {title} · {lg.nextDayPieces(count)}
        </h4>
        <p className="text-[11px] text-brand-100/60 font-medium">{hint}</p>
      </div>
      {lines.length === 0 ? (
        <p className="text-xs text-brand-100/50 font-medium italic">{lg.nextDayNone}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {lines.map(({ line, n }) => (
            <li
              key={`${line.item}|${line.size ?? ''}|${line.unknownSize}`}
              className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                // An unrecorded size is the one entry a packer can't act on, so
                // it carries the warning tone in whichever column it lands in.
                line.unknownSize ? 'border-amber-500/50 bg-amber-500/10 text-amber-100' : chip
              }`}
            >
              {pieceLabel(line, n)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The overlap between the day on screen and the next one, for a shop running
 * back-to-back days: what already on the van gets reused, what still has to
 * come off the rack, and what goes home to dry. Matched size by size, because
 * that's the unit a piece is actually reusable at.
 *
 * `diff` is null while the next day is still loading; `failed` when the read
 * errored, which must be said out loud — an empty next day and an unreadable
 * one produce very different packing advice from identical-looking panels.
 */
export function NextDayGearDiff({ day, diff, failed = false }: {
  day: string
  diff: GearDayDiff | null
  failed?: boolean
}) {
  const chase = (diff?.lines ?? []).filter(l => l.unknownSize && l.nextDivers.length > 0)
  return (
    <div className="space-y-2 rounded-lg border border-white/15 bg-white/5 p-3">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-brand-100/70">
          {lg.nextDayHeading(day)}
        </h3>
        <p className="text-xs text-brand-100/70 font-medium">{lg.nextDayHint}</p>
      </div>
      {failed ? (
        <p className="text-sm font-semibold text-amber-200">{lg.nextDayFailed}</p>
      ) : diff === null ? (
        <p className="text-sm text-brand-100/70 font-medium italic">{lg.nextDayLoading}</p>
      ) : diff.lines.length === 0 ? (
        <p className="text-sm text-brand-100/70 font-medium italic">{lg.nextDayNothing}</p>
      ) : (
        <>
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-3 items-start">
            <DiffColumn
              title={lg.nextDayStaysOut} hint={lg.nextDayStaysOutHint} tone="keep" count={diff.keep}
              lines={diff.lines.filter(l => l.keep > 0).map(line => ({ line, n: line.keep }))}
            />
            <DiffColumn
              title={lg.nextDayAlsoPack} hint={lg.nextDayAlsoPackHint} tone="add" count={diff.add}
              lines={diff.lines.filter(l => l.add > 0).map(line => ({ line, n: line.add }))}
            />
            <DiffColumn
              title={lg.nextDayBackToShop} hint={lg.nextDayBackToShopHint} tone="free" count={diff.free}
              lines={diff.lines.filter(l => l.free > 0).map(line => ({ line, n: line.free }))}
            />
          </div>
          {chase.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 space-y-0.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                {lg.nextDayChase}
              </h4>
              <ul className="space-y-0.5">
                {chase.map(l => (
                  <li key={`chase-${l.item}`} className="text-xs text-amber-100">
                    <span className="font-semibold">{l.item}</span>
                    {' · '}
                    <span className="select-text">{l.nextDivers.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
