import type { ReactNode } from 'react'
import type { CountPoint, MoneyPoint } from '../../lib/admin-dashboard'

// Dependency-free dashboard visuals: a KPI tile, a horizontal bar list (for
// distributions), and a column chart (for monthly time series). All sizing is
// relative to the max value in the series, rendered with Tailwind + inline
// width/height percentages — no charting library.

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4">
      <p className="text-xs font-medium text-blue-900/70">{label}</p>
      <p className="text-2xl font-bold text-blue-900 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-blue-900/60 mt-0.5">{sub}</p>}
    </div>
  )
}

export function ChartCard({ title, children, empty }: { title: string; children: ReactNode; empty?: boolean }) {
  return (
    <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-blue-900">{title}</h2>
      {empty ? <p className="text-xs text-blue-900/60">No data in range.</p> : children}
    </div>
  )
}

const TWD = (n: number) => `TWD ${Math.round(n).toLocaleString()}`

/** Horizontal bars sized against the largest absolute value in the series. */
export function BarList({
  items, kind = 'count',
}: { items: Array<MoneyPoint | CountPoint>; kind?: 'count' | 'money' }) {
  const max = Math.max(1, ...items.map(i => Math.abs(i.value)))
  const fmt = kind === 'money' ? TWD : (n: number) => n.toLocaleString()
  return (
    <ul className="space-y-1.5">
      {items.map(i => (
        <li key={i.label} className="text-xs text-blue-900">
          <div className="flex justify-between gap-2">
            <span className="truncate">{i.label}</span>
            <span className="tabular-nums shrink-0">{fmt(i.value)}</span>
          </div>
          <div className="h-1.5 bg-sky-100 rounded mt-0.5 overflow-hidden">
            <div
              className={`h-full rounded ${i.value < 0 ? 'bg-red-400' : 'bg-blue-600'}`}
              style={{ width: `${(Math.abs(i.value) / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Vertical columns for a monthly time series. Labels show the month (MM). */
export function ColumnChart({
  items, kind = 'count',
}: { items: Array<MoneyPoint | CountPoint>; kind?: 'count' | 'money' }) {
  const max = Math.max(1, ...items.map(i => i.value))
  const fmt = kind === 'money' ? TWD : (n: number) => n.toLocaleString()
  return (
    <div className="flex items-end gap-1 h-32">
      {items.map(i => (
        <div key={i.label} className="flex-1 flex flex-col items-center justify-end h-full group">
          <div className="relative w-full flex justify-center">
            <span className="absolute -top-4 text-[9px] text-blue-900/70 tabular-nums opacity-0 group-hover:opacity-100 whitespace-nowrap">
              {fmt(i.value)}
            </span>
          </div>
          <div
            className="w-full bg-blue-600 rounded-t min-h-[2px]"
            style={{ height: `${(i.value / max) * 100}%` }}
            title={`${i.label}: ${fmt(i.value)}`}
          />
          <span className="text-[9px] text-blue-900/60 mt-1">{i.label.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}
