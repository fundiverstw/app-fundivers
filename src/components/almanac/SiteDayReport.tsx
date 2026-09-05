/**
 * Everything the almanac holds for one site on one day.
 *
 * A day's stack is what the divers who were there filed — usually a handful of
 * readings, occasionally one. The report reads top-down as: how much data this
 * is, what the numbers came to, what the conditions were called, and finally
 * who reported what. The per-diver list at the bottom is deliberate: every
 * value a plot shows is also written out, so nothing is readable only as a
 * position on a track.
 */
import { t } from '../../i18n'
import {
  summarize, tallyByCount, tallyOrdered, valuesOf, type NumericSummary,
} from '../../lib/almanac-stats'
import {
  ALMANAC_CURRENT_STRENGTHS,
  ALMANAC_CORAL_HEALTHS,
  ALMANAC_ROUTE_CONDITIONS,
  ALMANAC_TRASH_BANDS,
  type AlmanacEventRecord,
} from '../../types/database'
import { CARD, TEXT_BODY, TEXT_HEADING, TEXT_SUBTLE } from '../../styles/tokens'
import { ReadingStrip } from './ReadingStrip'
import { TallyBars } from './TallyBars'
import { formatNum, readingsOf } from '../../lib/almanac-readings'
import { ReadingGrid } from './ReadingGrid'

interface Metric {
  label: string
  summary: NumericSummary | null
  format: (value: number) => string
}

export function SiteDayReport({
  siteName, dateLabel, records,
}: {
  siteName: string
  dateLabel: string
  records: AlmanacEventRecord[]
}) {
  if (records.length === 0) {
    return (
      <div className={`${CARD} p-4 text-center`}>
        <p className={`text-sm ${TEXT_HEADING}`}>{siteName}</p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{dateLabel}</p>
        <p className={`mt-2 text-sm ${TEXT_SUBTLE}`}>{t.almanac.noDayRecords}</p>
      </div>
    )
  }

  const metrics: Metric[] = [
    { label: t.almanac.airTemp, summary: summarize(valuesOf(records, r => r.air_temp_c)), format: v => `${formatNum(v)}°C` },
    { label: t.almanac.waterTemp, summary: summarize(valuesOf(records, r => r.water_temp_c)), format: v => `${formatNum(v)}°C` },
    { label: t.almanac.visibility, summary: summarize(valuesOf(records, r => r.visibility_m)), format: v => `${formatNum(v)}m` },
    { label: t.almanac.waveHeight, summary: summarize(valuesOf(records, r => r.wave_height_m)), format: v => `${formatNum(v)}m` },
    { label: t.almanac.wavePeriod, summary: summarize(valuesOf(records, r => r.wave_period_s)), format: v => `${formatNum(v)}s` },
    { label: t.almanac.elevation, summary: summarize(valuesOf(records, r => r.elevation_m)), format: v => `${formatNum(v, 0)}m` },
  ]
  const plotted = metrics.filter((m): m is Metric & { summary: NumericSummary } => m.summary !== null)

  const currents = tallyOrdered(records.map(r => r.current_strength), ALMANAC_CURRENT_STRENGTHS)
  const corals = tallyOrdered(records.map(r => r.coral_health), ALMANAC_CORAL_HEALTHS)
  const routes = tallyOrdered(records.map(r => r.route_condition), ALMANAC_ROUTE_CONDITIONS)
  const weathers = tallyByCount(records.map(r => r.weather))
  const wildlife = tallyByCount(records.flatMap(r => r.wildlife ?? []))
  const trashAmounts = tallyOrdered(records.map(r => r.trash_band), ALMANAC_TRASH_BANDS)
  const trash = tallyByCount(records.flatMap(r => r.trash_kinds ?? []))
  const summits = tallyByCount(records.map(r =>
    r.summit_visible === null ? null : r.summit_visible ? 'yes' : 'no'))

  const contributors = [...new Set(records
    .map(r => r.diver_display)
    .filter((name): name is string => !!name))]

  return (
    <div className="space-y-3">
      <header className={`${CARD} p-4`}>
        <h3 className={`text-base ${TEXT_HEADING}`}>{siteName}</h3>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{dateLabel}</p>
        <p className={`mt-2 text-sm ${TEXT_BODY}`}>{t.almanac.observationCount(records.length)}</p>
        {contributors.length > 0 && (
          <p className={`text-xs ${TEXT_SUBTLE}`}>{t.almanac.recordsFrom(contributors.join(', '))}</p>
        )}
      </header>

      {plotted.length > 0 && (
        <section className={`${CARD} space-y-4 p-4`}>
          <h4 className={`text-sm ${TEXT_HEADING}`}>{t.almanac.measured}</h4>
          {plotted.map(metric => (
            <ReadingStrip
              key={metric.label}
              label={metric.label}
              summary={metric.summary}
              total={records.length}
              format={metric.format}
            />
          ))}
        </section>
      )}

      <section className={`${CARD} space-y-4 p-4`}>
        <h4 className={`text-sm ${TEXT_HEADING}`}>{t.almanac.called}</h4>
        <TallyBars
          label={t.almanac.current} entries={currents} ordered
          labelOf={v => t.almanac.currentStrengths[v]}
        />
        <TallyBars
          label={t.almanac.weather} entries={weathers}
          labelOf={v => t.almanac.weathers[v]}
        />
        <TallyBars
          label={t.almanac.coralHealth} entries={corals} ordered
          labelOf={v => t.almanac.coralHealths[v]}
        />
        <TallyBars
          label={t.almanac.routeCondition} entries={routes} ordered
          labelOf={v => t.almanac.routeConditions[v]}
        />
        <TallyBars
          label={t.almanac.summitVisible} entries={summits}
          labelOf={v => (v === 'yes' ? t.almanac.yes : t.almanac.no)}
        />
        <TallyBars
          label={t.almanac.wildlife} entries={wildlife}
          labelOf={v => v}
        />
        <TallyBars
          label={t.almanac.trashAmount} entries={trashAmounts} ordered
          labelOf={v => t.almanac.trashBands[v]}
        />
        <TallyBars
          label={t.almanac.trashKindsLabel} entries={trash}
          labelOf={v => t.almanac.trashKinds[v]}
        />
      </section>

      <section className={`${CARD} p-4`}>
        <h4 className={`text-sm ${TEXT_HEADING}`}>{t.almanac.whoReported}</h4>
        <ul className="mt-2 space-y-3">
          {records.map(record => (
            <li key={record.id} className="border-t border-white/10 pt-2 first:border-0 first:pt-0">
              {record.diver_display && (
                <span className={`text-xs ${TEXT_SUBTLE}`}>{t.almanac.recordsFrom(record.diver_display)}</span>
              )}
              <ReadingGrid readings={readingsOf(record)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
