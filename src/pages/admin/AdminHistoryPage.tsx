import { useEffect, useState } from 'react'
import { Spinner } from '../../components/ui/Spinner'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import { siteConfig } from '../../config/site'
import { fiscalYearRange } from '../../lib/accounting-export'
import { fetchYearWeather, HOME_REGION, type DailyWeather } from '../../lib/weather'
import {
  monthlyWeather, monthlyCounts, seasonAverages, filterMonths, eventDayWeather,
  PEAK_SEASON_MONTHS, type SeasonAverages, type EventDayComparison,
} from '../../lib/weather-analysis'
import { StatCard, ChartCard, GroupedColumnChart } from '../../components/admin/dashboard-charts'

// Admin "Historical perspective" BI view. Overlays home-region weather (live
// from Open-Meteo) against booking volume, month by month, across the current
// year and the two prior — so an admin can see whether the season's weather
// tracked its performance. Calendar-year axis keeps the peak season (Jun–Aug)
// in the centre. Asia/Taipei throughout.

function taipeiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
}

// Categorical year-series palette (oldest → newest), independent of the brand
// color so the three compared years stay visually distinct after a re-skin.
const SERIES_COLORS = ['bg-slate-400', 'bg-orange-500', 'bg-blue-600']

interface HistoryData {
  years: number[]
  weatherByYear: DailyWeather[][]
  bookingKeys: string[]
  eventKeysThisYear: string[]
  today: string
}

async function loadHistory(): Promise<HistoryData> {
  const nowIso = new Date().toISOString()
  const today = taipeiDate(nowIso)
  const Y = Number(today.slice(0, 4))
  const years = [Y - 2, Y - 1, Y]

  const bookingsStart = fiscalYearRange(Y - 2).startIso
  const bookingsEnd = fiscalYearRange(Y).endIso

  const [weatherByYear, bookingsRes, divesRes, coursesRes] = await Promise.all([
    Promise.all(years.map(y => fetchYearWeather(y, today))),
    supabase.from('bookings').select('created_at').gte('created_at', bookingsStart).lt('created_at', bookingsEnd),
    supabase.from('EO_dives').select('start_date').is('cancelled_at', null).gte('start_date', `${Y}-01-01`).lte('start_date', `${Y}-12-31`),
    supabase.from('EO_courses').select('course_days').is('cancelled_at', null),
  ])
  if (bookingsRes.error) throw bookingsRes.error

  const bookingKeys = (bookingsRes.data ?? []).map(b => taipeiDate(b.created_at))
  const diveKeys = (divesRes.data ?? []).map(d => d.start_date).filter((x): x is string => !!x).map(s => s.slice(0, 10))
  const courseKeys = (coursesRes.data ?? []).flatMap(c => (c.course_days ?? []).map(d => d.slice(0, 10)))
  const eventKeysThisYear = [...diveKeys, ...courseKeys].filter(d => d.slice(0, 4) === String(Y))

  return { years, weatherByYear, bookingKeys, eventKeysThisYear, today }
}

const fmtMm = (n: number) => `${n} mm`
const fmtM = (n: number) => `${n} m`
const fmtDeg = (n: number) => `${n}°C`

function Delta({ curr, prev, fmt, betterWhenHigher }: { curr: number | null; prev: number | null; fmt: (n: number) => string; betterWhenHigher?: boolean }) {
  if (curr == null || prev == null) return <span className="text-brand-900/50">vs prior year: —</span>
  const diff = Math.round((curr - prev) * 10) / 10
  if (diff === 0) return <span className="text-brand-900/60">same as prior year</span>
  const up = diff > 0
  const good = betterWhenHigher == null ? null : up === betterWhenHigher
  const cls = good == null ? 'text-brand-900/60' : good ? 'text-emerald-700' : 'text-red-600'
  return <span className={cls}>{up ? '▲' : '▼'} {fmt(Math.abs(diff))} vs prior year</span>
}

export function AdminHistoryPage() {
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadHistory()
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
  }, [])

  if (error) {
    return <div className="max-w-5xl mx-auto"><p className="text-sm text-red-200 bg-red-900/40 border border-accent rounded-lg p-3">{error}</p></div>
  }
  if (!data) {
    return (
      <div className="max-w-5xl mx-auto flex justify-center py-16">
        <Spinner className="w-6 h-6 border-2 border-surface-300" />
      </div>
    )
  }

  const { years, weatherByYear } = data
  const Y = years[years.length - 1]
  const idxOf = (y: number) => years.indexOf(y)
  const months = monthlyWeather(weatherByYear[idxOf(Y)], Y).map(m => m.month)

  const weatherSeries = (pick: (m: ReturnType<typeof monthlyWeather>[number]) => number | null) =>
    years.map((y, i) => ({ label: String(y), color: SERIES_COLORS[i] ?? 'bg-blue-600', values: monthlyWeather(weatherByYear[i], y).map(pick) }))

  const bookingSeries = years.map((y, i) => ({ label: String(y), color: SERIES_COLORS[i] ?? 'bg-blue-600', values: monthlyCounts(data.bookingKeys, y) }))

  // Peak-season (Jun–Aug) headline: this year vs last.
  const peakNow: SeasonAverages = seasonAverages(filterMonths(weatherByYear[idxOf(Y)], PEAK_SEASON_MONTHS))
  const peakPrev: SeasonAverages = seasonAverages(filterMonths(weatherByYear[idxOf(Y - 1)], PEAK_SEASON_MONTHS))
  const peakIdx = PEAK_SEASON_MONTHS.map(m => m - 1)
  const peakBookings = (y: number) => peakIdx.reduce((s, i) => s + monthlyCounts(data.bookingKeys, y)[i], 0)
  const peakBookingsNow = peakBookings(Y)
  const peakBookingsPrev = peakBookings(Y - 1)

  const ev: EventDayComparison = eventDayWeather(weatherByYear[idxOf(Y)], data.eventKeysThisYear)
  const num = (n: number | null) => (n == null ? '—' : String(n))

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Historical perspective</h1>
          <p className="text-sm text-white/70">
            Weather vs. bookings, {years[0]}–{Y} · {HOME_REGION.label} · peak season (Jun–Aug) centred.
          </p>
        </div>
        <Link to="/admin/dashboard" className="text-sm text-amber-300 hover:text-amber-200 shrink-0 mt-1">← Dashboard</Link>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-white/80 mb-2">Peak season {Y} vs {Y - 1}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Bookings (Jun–Aug)" value={peakBookingsNow} sub={undefined} />
          <StatCard label="Avg rain" value={`${num(peakNow.precipitation)} mm/d`} sub={undefined} />
          <StatCard label="Avg wave" value={`${num(peakNow.waveMax)} m`} sub={undefined} />
          <StatCard label="Avg air max" value={`${num(peakNow.tempMax)}°C`} sub={undefined} />
          <StatCard label="Avg sea temp" value={`${num(peakNow.seaTemp)}°C`} sub={undefined} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-1 text-[11px] px-1">
          <div><Delta curr={peakBookingsNow} prev={peakBookingsPrev} fmt={n => String(n)} betterWhenHigher /></div>
          <div><Delta curr={peakNow.precipitation} prev={peakPrev.precipitation} fmt={fmtMm} /></div>
          <div><Delta curr={peakNow.waveMax} prev={peakPrev.waveMax} fmt={fmtM} /></div>
          <div><Delta curr={peakNow.tempMax} prev={peakPrev.tempMax} fmt={fmtDeg} /></div>
          <div><Delta curr={peakNow.seaTemp} prev={peakPrev.seaTemp} fmt={fmtDeg} /></div>
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Bookings by month">
          <GroupedColumnChart months={months} series={bookingSeries} />
        </ChartCard>
        <ChartCard title="Rainfall by month (avg mm/day)">
          <GroupedColumnChart months={months} series={weatherSeries(m => m.precipitation)} fmt={fmtMm} />
        </ChartCard>
        <ChartCard title="Wave height by month (avg max, m)">
          <GroupedColumnChart months={months} series={weatherSeries(m => m.waveMax)} fmt={fmtM} />
        </ChartCard>
        <ChartCard title="Air temperature by month (avg max, °C)">
          <GroupedColumnChart months={months} series={weatherSeries(m => m.tempMax)} fmt={fmtDeg} />
        </ChartCard>
        <ChartCard title="Sea temperature by month (avg, °C)">
          <GroupedColumnChart months={months} series={weatherSeries(m => m.seaTemp)} fmt={fmtDeg} />
        </ChartCard>
        <ChartCard title="Wind by month (avg max, km/h)">
          <GroupedColumnChart months={months} series={weatherSeries(m => m.windMax)} fmt={n => `${n} km/h`} />
        </ChartCard>
      </section>

      <ChartCard title={`Weather on event days vs all days — ${Y}`} empty={ev.eventDayCount === 0}>
        <table className="w-full text-xs text-brand-900">
          <thead className="text-brand-900/60 text-left">
            <tr>
              <th className="font-medium pb-1">Metric</th>
              <th className="font-medium pb-1 text-right">On event days</th>
              <th className="font-medium pb-1 text-right">All days</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-surface-100"><td className="py-1">Rain (mm/day)</td><td className="py-1 text-right tabular-nums">{num(ev.onEventDays.precipitation)}</td><td className="py-1 text-right tabular-nums">{num(ev.allDays.precipitation)}</td></tr>
            <tr className="border-t border-surface-100"><td className="py-1">Wave (m)</td><td className="py-1 text-right tabular-nums">{num(ev.onEventDays.waveMax)}</td><td className="py-1 text-right tabular-nums">{num(ev.allDays.waveMax)}</td></tr>
            <tr className="border-t border-surface-100"><td className="py-1">Wind (km/h)</td><td className="py-1 text-right tabular-nums">{num(ev.onEventDays.windMax)}</td><td className="py-1 text-right tabular-nums">{num(ev.allDays.windMax)}</td></tr>
          </tbody>
        </table>
        <p className="text-[11px] text-brand-900/60 mt-2">Across {ev.eventDayCount} event day{ev.eventDayCount === 1 ? '' : 's'} in {Y}.</p>
      </ChartCard>

      <p className="text-[11px] text-white/50">Weather: Open-Meteo, {HOME_REGION.label} ({HOME_REGION.latitude}, {HOME_REGION.longitude}).</p>
    </div>
  )
}
