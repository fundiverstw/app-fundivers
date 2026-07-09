import type { ReactNode } from 'react'
import type { CountPoint, MoneyPoint } from '../../lib/admin-dashboard'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'

// Dependency-free dashboard visuals: a KPI tile, a horizontal bar list (for
// distributions), and a column chart (for monthly time series). All sizing is
// relative to the max value in the series, rendered with Tailwind + inline
// width/height percentages — no charting library.

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4">
      <p className="text-xs font-medium text-brand-900/70">{label}</p>
      <p className="text-2xl font-bold text-brand-900 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-brand-900/60 mt-0.5">{sub}</p>}
    </div>
  )
}

export function ChartCard({ title, children, empty }: { title: string; children: ReactNode; empty?: boolean }) {
  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-brand-900">{title}</h2>
      {empty ? <p className="text-xs text-brand-900/60">{t.admin.charts.noData}</p> : children}
    </div>
  )
}

const TWD = (n: number) => `${siteConfig.locale.currency} ${Math.round(n).toLocaleString()}`

/** Horizontal bars sized against the largest absolute value in the series. */
export function BarList({
  items, kind = 'count',
}: { items: Array<MoneyPoint | CountPoint>; kind?: 'count' | 'money' }) {
  const max = Math.max(1, ...items.map(i => Math.abs(i.value)))
  const fmt = kind === 'money' ? TWD : (n: number) => n.toLocaleString()
  return (
    <ul className="space-y-1.5">
      {items.map(i => (
        <li key={i.label} className="text-xs text-brand-900">
          <div className="flex justify-between gap-2">
            <span className="truncate">{i.label}</span>
            <span className="tabular-nums shrink-0">{fmt(i.value)}</span>
          </div>
          <div className="h-1.5 bg-surface-100 rounded mt-0.5 overflow-hidden">
            <div
              className={`h-full rounded ${i.value < 0 ? 'bg-red-400' : 'bg-brand-600'}`}
              style={{ width: `${(Math.abs(i.value) / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Plot frame shared by the column charts: a left y-axis gutter (max / mid / 0
 * ticks), a baselined bar area, and a month-label row beneath. `bars` is the
 * row of equal-flex columns; the label row mirrors its column count so they
 * stay aligned.
 */
function ChartFrame({ max, fmt, labels, bars }: {
  max: number
  fmt: (n: number) => string
  labels: string[]
  bars: ReactNode
}) {
  return (
    <div className="flex gap-1">
      <div className="shrink-0 flex flex-col justify-between h-32 text-[9px] text-brand-900/50 tabular-nums text-right pr-0.5">
        <span>{fmt(max)}</span>
        <span>{fmt(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-1 h-32 border-b border-surface-300">{bars}</div>
        <div className="flex gap-1 mt-1">
          {labels.map((l, i) => (
            <span key={i} className="flex-1 text-center text-[9px] text-brand-900/60">{l.slice(5)}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Grouped vertical columns: one cluster per month, one thin bar per series
 * (e.g. one series per year). Bars are scaled against the global max across
 * every series so the seasons are visually comparable. Null values render as
 * a gap. `color` is a Tailwind bg class per series.
 */
export function GroupedColumnChart({
  months, series, fmt,
}: {
  months: string[]
  series: Array<{ label: string; color: string; values: Array<number | null> }>
  fmt?: (n: number) => string
}) {
  const f = fmt ?? ((n: number) => n.toLocaleString())
  const max = Math.max(1, ...series.flatMap(s => s.values.map(v => v ?? 0)))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {series.map(s => (
          <span key={s.label} className="flex items-center gap-1 text-[11px] text-brand-900/80">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${s.color}`} />{s.label}
          </span>
        ))}
      </div>
      <ChartFrame
        max={max}
        fmt={f}
        labels={months}
        bars={months.map((m, i) => (
          <div key={m} className="flex-1 flex items-end justify-center gap-px h-full">
            {series.map(s => {
              const v = s.values[i]
              return (
                <div
                  key={s.label}
                  className={`flex-1 max-w-[7px] rounded-t ${s.color} ${v == null ? 'opacity-0' : ''}`}
                  style={{ height: `${((v ?? 0) / max) * 100}%` }}
                  title={`${s.label} · ${m}: ${v == null ? '—' : f(v)}`}
                />
              )
            })}
          </div>
        ))}
      />
    </div>
  )
}

/** Vertical columns for a monthly time series. Labels show the month (MM). */
export function ColumnChart({
  items, kind = 'count',
}: { items: Array<MoneyPoint | CountPoint>; kind?: 'count' | 'money' }) {
  const max = Math.max(1, ...items.map(i => i.value))
  const fmt = kind === 'money' ? TWD : (n: number) => n.toLocaleString()
  return (
    <ChartFrame
      max={max}
      fmt={fmt}
      labels={items.map(i => i.label)}
      bars={items.map(i => (
        <div
          key={i.label}
          className="flex-1 flex items-end justify-center h-full"
          title={`${i.label}: ${fmt(i.value)}`}
        >
          <div className="w-full bg-brand-600 rounded-t min-h-[2px]" style={{ height: `${(i.value / max) * 100}%` }} />
        </div>
      ))}
    />
  )
}
