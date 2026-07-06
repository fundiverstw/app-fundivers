import { useMemo, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { supabase } from '../../lib/supabase'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import {
  fiscalYearRange,
  normalizeTransactions,
  buildAccountingCsvs,
  type AccountingTransaction,
} from '../../lib/accounting-export'
import type { Payment } from '../../types/database'

// Admin-only fiscal-year (calendar-year, Asia/Taipei) bookkeeping export.
// Pulls every payment marked in the year, joins booking / event / diver /
// recording-admin, and downloads a ZIP of three CSVs: per-transaction detail,
// a by-event breakdown, and an overall business summary. Reads only — RLS
// already restricts payments/bookings to admins.

function taipeiYear(): number {
  return Number(new Date().toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone, year: 'numeric' }).slice(0, 4))
}

async function fetchTransactions(year: number): Promise<AccountingTransaction[]> {
  const { startIso, endIso } = fiscalYearRange(year)

  const { data: paymentsData, error } = await supabase
    .from('payments')
    .select('*')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at')
  if (error) throw error
  const payments = (paymentsData ?? []) as Payment[]
  if (!payments.length) return []

  const bookingIds = [...new Set(payments.map(p => p.booking_id).filter((x): x is string => !!x))]
  const bookings = bookingIds.length
    ? (await supabase.from('bookings').select('id, user_id, event_id, status, details').in('id', bookingIds)).data ?? []
    : []

  const eventIds = [...new Set(bookings.map(b => b.event_id).filter((x): x is string => !!x))]
  const personIds = [...new Set([
    ...payments.map(p => p.user_id),
    ...payments.map(p => p.recorded_by).filter((x): x is string => !!x),
  ])]

  const [events, profiles] = await Promise.all([
    eventIds.length
      ? supabase.from('events').select('id, kind, display_title, admin_title, start_date, course_days').in('id', eventIds).then(r => r.data ?? [])
      : Promise.resolve([]),
    personIds.length
      ? supabase.from('profiles').select('id, name, email').in('id', personIds).then(r => r.data ?? [])
      : Promise.resolve([]),
  ])

  return normalizeTransactions({ payments, bookings, events, profiles })
}

function downloadZip(filename: string, files: Record<string, string>): void {
  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])),
    { level: 6 },
  )
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function AdminAccountingPage() {
  const toast = useToast()
  const thisYear = taipeiYear()
  const years = useMemo(
    () => Array.from({ length: 5 }, (_, i) => thisYear - i),
    [thisYear],
  )
  const [year, setYear] = useState(thisYear)
  const [busy, setBusy] = useState(false)

  async function handleDownload() {
    setBusy(true)
    try {
      const txns = await fetchTransactions(year)
      if (!txns.length) {
        toast.error(`No payments recorded in ${year}.`)
        return
      }
      const files = buildAccountingCsvs(txns, year)
      downloadZip(`${siteConfig.identity.shortName.toLowerCase()}-accounting-${year}.zip`, files)
      const paid = txns.filter(t => t.status === 'paid').length
      toast.success(`Exported ${txns.length} transaction${txns.length === 1 ? '' : 's'} (${paid} paid) for ${year}.`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Accounting export</h1>
      <p className="text-sm text-white/80">
        Download a fiscal-year (Jan–Dec, {siteConfig.locale.timezone}) bookkeeping ZIP. Includes
        every payment marked in the year — paid, refunded, and voided — with who
        paid, who marked it, when, the method, and the linked event.
      </p>

      <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-brand-900">Fiscal year</span>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

        <ul className="text-xs text-brand-900/80 list-disc pl-5 space-y-0.5">
          <li><strong>transactions-{year}.csv</strong> — one row per payment.</li>
          <li><strong>by-event-{year}.csv</strong> — paid / refunded / net per event.</li>
          <li><strong>summary-{year}.csv</strong> — totals by method, event type, and month.</li>
        </ul>
        <p className="text-[11px] text-brand-900/70">
          Money totals count paid as positive and refunded as negative; voided
          rows are listed but excluded from every sum.
        </p>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="py-2 px-4 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50"
          >
            {busy ? 'Preparing…' : 'Download ZIP'}
          </button>
        </div>
      </div>
    </div>
  )
}
