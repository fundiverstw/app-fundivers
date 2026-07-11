import { useEffect, useMemo, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { supabase } from '../../lib/supabase'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { requestEventDiverExport } from '../../lib/admin-event-export'
import {
  fiscalYearRange,
  normalizeTransactions,
  buildAccountingCsvs,
  type AccountingTransaction,
} from '../../lib/accounting-export'
import type { Payment } from '../../types/database'
import { t } from '../../i18n'

const ac = t.admin.accounting

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

// Boat manifest is a per-dive .xlsx the export-event-divers edge function
// builds and emails to the shop (BCCing the admin). The event page has the same
// action; this surfaces it centrally so an admin can pick any dive. Last-used
// boat values are shared with that modal via the same localStorage key.
const BOAT_MANIFEST_LS_KEY = 'fd_boat_manifest_v1'
const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

type DiveOption = { id: string; label: string }

function ManifestSection() {
  const toast = useToast()
  const bm = siteConfig.business.boatManifest
  const [dives, setDives] = useState<DiveOption[]>([])
  const [diveId, setDiveId] = useState('')
  // Prefill from the admin's last-used values (shared with the event page's
  // export modal via the same key), falling back to the shop config defaults.
  const [boat] = useState(() => {
    let v: { boatName?: string; registration?: string; notes?: string } = {}
    try { v = JSON.parse(localStorage.getItem(BOAT_MANIFEST_LS_KEY) ?? '{}') } catch { /* corrupt / unavailable */ }
    return {
      boatName: v.boatName ?? bm.boatName,
      registration: v.registration ?? bm.registration,
      notes: v.notes ?? bm.notes.join('\n'),
    }
  })
  const [boatName, setBoatName] = useState(boat.boatName)
  const [registration, setRegistration] = useState(boat.registration)
  const [notes, setNotes] = useState(boat.notes)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    const today = new Date().toISOString().slice(0, 10)
    supabase
      .from('events')
      .select('id, display_title, admin_title, start_date')
      .eq('kind', 'dive')
      .is('cancelled_at', null)
      .gte('start_date', today)
      .order('start_date')
      .then(({ data }) => {
        if (cancelled || !data) return
        setDives(data.map(d => ({
          id: d.id,
          label: `${d.display_title || d.admin_title || t.calendar.typeDive}${d.start_date ? ` — ${d.start_date}` : ''}`,
        })))
      })
    return () => { cancelled = true }
  }, [])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!diveId) { toast.error(ac.manifestNeedsDive); return }
    setSending(true)
    try {
      try { localStorage.setItem(BOAT_MANIFEST_LS_KEY, JSON.stringify({ boatName, registration, notes })) } catch { /* non-fatal */ }
      const res = await requestEventDiverExport('dive', diveId, {
        boat_name: boatName.trim(),
        registration: registration.trim(),
        notes: notes.split('\n').map(n => n.trim()).filter(Boolean),
      })
      toast.success(ac.manifestSent(res.diver_count))
    } catch (err) {
      toast.error(ac.manifestFailed(errorMessage(err)))
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSend} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <p className="text-xs text-brand-900/80">{ac.manifestBlurb}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-brand-900">{ac.manifestDive}</span>
        <select value={diveId} onChange={e => setDiveId(e.target.value)} className={FIELD}>
          <option value="">{dives.length ? ac.manifestPickDive : ac.manifestNoDives}</option>
          {dives.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-brand-900">{ac.manifestBoatName}</span>
          <input value={boatName} onChange={e => setBoatName(e.target.value)} className={FIELD} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-brand-900">{ac.manifestRegistration}</span>
          <input value={registration} onChange={e => setRegistration(e.target.value)} className={FIELD} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-brand-900">{ac.manifestNotes}</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${FIELD} resize-y`} />
      </label>
      <div className="flex justify-end">
        <button type="submit" disabled={sending || !diveId}
          className="py-2 px-4 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50">
          {sending ? ac.manifestSending : ac.manifestSend}
        </button>
      </div>
    </form>
  )
}

type DiverOption = { id: string; label: string }

// Signed-waiver records are built by the export-diver-waivers edge function
// (admin-only): one attestation PDF per signature, plus the original form PDF
// for uploaded-PDF waivers, zipped and returned base64 for a browser download.
function WaiverExportSection() {
  const toast = useToast()
  const [divers, setDivers] = useState<DiverOption[]>([])
  const [diverId, setDiverId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.from('profiles').select('id, name, email').order('name')
      .then(({ data }) => {
        if (cancelled || !data) return
        setDivers(data.map(d => ({ id: d.id, label: d.name || d.email || d.id })))
      })
    return () => { cancelled = true }
  }, [])

  async function handleExport() {
    if (!diverId) { toast.error(ac.waiverNeedsDiver); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('export-diver-waivers', { body: { diver_id: diverId } })
      if (error) throw error
      const res = data as { count: number; filename?: string; zip_base64?: string }
      if (!res.count || !res.zip_base64) { toast.info(ac.waiverNone); return }
      const bytes = Uint8Array.from(atob(res.zip_base64), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename ?? 'waivers.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(ac.waiverExported(res.count))
    } catch (err) {
      toast.error(ac.waiverFailed(errorMessage(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <p className="text-xs text-brand-900/80">{ac.waiverBlurb}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-brand-900">{ac.waiverDiver}</span>
        <select value={diverId} onChange={e => setDiverId(e.target.value)} className={FIELD}>
          <option value="">{divers.length ? ac.waiverPickDiver : ac.waiverNoDivers}</option>
          {divers.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <div className="flex justify-end">
        <button type="button" onClick={handleExport} disabled={busy || !diverId}
          className="py-2 px-4 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50">
          {busy ? ac.waiverExporting : ac.waiverExport}
        </button>
      </div>
    </div>
  )
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
        toast.error(ac.noPayments(year))
        return
      }
      const files = buildAccountingCsvs(txns, year)
      downloadZip(`${siteConfig.identity.shortName.toLowerCase()}-accounting-${year}.zip`, files)
      const paid = txns.filter(tx => tx.status === 'paid').length
      toast.success(ac.exported(txns.length, paid, year))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-white">{ac.title}</h1>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">{ac.sectionAccounting}</h2>
        <p className="text-sm text-white/80">{ac.blurb(siteConfig.locale.timezone)}</p>
        <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-brand-900">{ac.fiscalYear}</span>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

        <ul className="text-xs text-brand-900/80 list-disc pl-5 space-y-0.5">
          <li><strong>{ac.transactionsCsv(year)}</strong> — {ac.transactionsDesc}</li>
          <li><strong>{ac.byEventCsv(year)}</strong> — {ac.byEventDesc}</li>
          <li><strong>{ac.summaryCsv(year)}</strong> — {ac.summaryDesc}</li>
        </ul>
        <p className="text-[11px] text-brand-900/70">{ac.moneyNote}</p>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="py-2 px-4 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50"
          >
            {busy ? ac.preparing : ac.downloadZip}
          </button>
        </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">{ac.sectionManifest}</h2>
        <ManifestSection />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">{ac.sectionWaivers}</h2>
        <WaiverExportSection />
      </section>
    </div>
  )
}
