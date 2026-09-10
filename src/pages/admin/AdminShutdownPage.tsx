import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchAllRows } from '../../lib/fetch-all'
import { fetchEventsInRange } from '../../lib/events'
import { sendPushBroadcast, pushWorkerUrl } from '../../lib/push-broadcast'
import { computeShutdownReadiness, readyToShutDown, type ReadinessCheck } from '../../lib/shutdown-readiness'
import { todayIso, addIsoDays } from '../../lib/dates'
import { siteConfig } from '../../config/site'
import { Spinner } from '../../components/ui/Spinner'
import { t } from '../../i18n'
import type { Booking, Credit, Payment } from '../../types/database'

const s = t.admin.shutdown

// Closing the shop down, in the order that keeps the data.
//
// Deleting a Supabase project takes two clicks and cannot be undone: the
// bookings, the money owed in both directions, every diver's logbook and every
// signed waiver go at once. This page is the thing that stands between a shop
// owner and that button — it counts what is still outstanding, points at the
// exports that survive the deletion, offers the divers a last word, and only
// then lists the switches, in the order that leaves nothing stranded.
//
// It deliberately deletes nothing itself. The destructive steps live in the
// Supabase and Cloudflare dashboards, where they are already guarded and where
// a shop that changes its mind halfway has not yet lost anything.

// The full walkthrough, which carries the detail no admin panel should try to:
// account closure, DNS, what to keep for tax purposes.
const GUIDE_URL = 'https://github.com/fundive/fundive/blob/main/docs/shutdown.md'

type StepId =
  | 'domain' | 'appWorker' | 'pushWorker' | 'turnstile'
  | 'supabase' | 'gmail' | 'repo' | 'accounts'

interface Step {
  id:   StepId
  href: string | null
}

// Order matters. The site goes dark at the app worker, so the exports and the
// diver notice happen above; the data goes at the Supabase project, which is
// why it sits below everything that reads from it; accounts close last,
// because a closed account cannot be signed into to finish the rest.
const STEPS: Step[] = [
  { id: 'domain',      href: 'https://dash.cloudflare.com' },
  { id: 'appWorker',   href: 'https://dash.cloudflare.com' },
  { id: 'pushWorker',  href: 'https://dash.cloudflare.com' },
  { id: 'turnstile',   href: 'https://dash.cloudflare.com' },
  { id: 'supabase',    href: 'https://supabase.com/dashboard/projects' },
  { id: 'gmail',       href: 'https://myaccount.google.com/apppasswords' },
  { id: 'repo',        href: null },
  { id: 'accounts',    href: null },
]

const TICKS_KEY = 'fundive.shutdown.ticks'

function loadTicks(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(TICKS_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export function AdminShutdownPage() {
  const toast = useToast()
  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ticks, setTicks] = useState<Record<string, boolean>>(loadTicks)
  const [reloadToken, setReloadToken] = useState(0)

  // Reloaded by bumping the token, the same shape every other data page here
  // uses: the fetch lives in the effect (so nothing sets state synchronously in
  // an effect body) and `alive` keeps a slow response off an unmounted page.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const today = todayIso()
        const [lastBackup, events, bookings, payments, credits, diverCount] = await Promise.all([
          supabase.from('admin_audit_log')
            .select('created_at')
            .eq('target_table', 'database_backup')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => (data as { created_at: string } | null)?.created_at ?? null),
          // Two years out: far enough that a shop closing down sees everything
          // it has promised, without reading the whole history back.
          fetchEventsInRange(today, addIsoDays(today, 730)),
          fetchAllRows<Pick<Booking, 'id' | 'status' | 'details'>>((from, to) =>
            supabase.from('bookings').select('id, status, details').order('id').range(from, to)),
          fetchAllRows<Pick<Payment, 'booking_id' | 'amount' | 'status'>>((from, to) =>
            supabase.from('payments').select('booking_id, amount, status').order('id').range(from, to)),
          fetchAllRows<Pick<Credit, 'amount' | 'status'>>((from, to) =>
            supabase.from('credits').select('amount, status').order('id').range(from, to)),
          supabase.from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('role', 'diver')
            .then(({ count }) => count ?? 0),
        ])
        if (!alive) return
        setChecks(computeShutdownReadiness({
          lastBackupAt:   lastBackup,
          now:            new Date(),
          upcomingEvents: events.map(e => ({ id: e.id, startDate: e.start_time.slice(0, 10) })),
          bookings,
          payments,
          credits,
          diverCount,
        }))
      } catch (err) {
        if (alive) setLoadError(errorMessage(err))
      }
    })()
    return () => { alive = false }
  }, [reloadToken])

  function recheck() {
    setChecks(null)
    setLoadError(null)
    setReloadToken(n => n + 1)
  }

  function toggleTick(id: StepId) {
    const next = { ...ticks, [id]: !ticks[id] }
    setTicks(next)
    // Written here rather than inside the updater: React may call an updater
    // more than once, and storage is not somewhere to be written twice.
    try { localStorage.setItem(TICKS_KEY, JSON.stringify(next)) } catch { /* private mode: ticks just don't persist */ }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-white">{s.title}</h1>
        <p className="text-sm text-brand-100/80">{s.intro}</p>
      </header>

      <Section title={s.checks.title}>
        {loadError && <p className="text-sm text-red-700 font-semibold">{s.checks.failed(loadError)}</p>}
        {!checks && !loadError && <div className="flex justify-center py-4"><Spinner /></div>}
        {checks && (
          <>
            <ul className="space-y-2">
              {checks.map(check => <CheckRow key={check.id} check={check} />)}
            </ul>
            {readyToShutDown(checks) && (
              <p className="rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
                {s.checks.allClear}
              </p>
            )}
            <button type="button" onClick={recheck} className={SECONDARY_BTN}>
              {s.checks.recheck}
            </button>
          </>
        )}
      </Section>

      <Section title={s.records.title}>
        <p className="text-sm text-brand-900">{s.records.body}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Link to="/admin/backup" className={PRIMARY_BTN}>{s.records.backup}</Link>
          <Link to="/admin/accounting" className={SECONDARY_BTN}>{s.records.documents}</Link>
        </div>
        <p className="rounded-lg border border-amber-400 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
          {s.records.retention}
        </p>
      </Section>

      <NotifySection onSent={n => toast.success(s.notify.sent(n))} onFailed={m => toast.error(s.notify.failed(m))} />

      <Section title={s.switchOff.title}>
        <p className="text-sm text-brand-900">{s.switchOff.body}</p>
        <ol className="space-y-2">
          {STEPS.map((step, i) => (
            <li key={step.id}>
              <label className="flex items-start gap-3 text-sm text-brand-900">
                <input
                  type="checkbox"
                  checked={!!ticks[step.id]}
                  onChange={() => toggleTick(step.id)}
                  className="mt-1 shrink-0"
                />
                <span className={ticks[step.id] ? 'line-through opacity-60' : ''}>
                  <span className="font-semibold">{i + 1}. </span>
                  {s.steps[step.id]}
                  {step.href && (
                    <>
                      {' '}
                      <a href={step.href} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline">
                        {s.switchOff.open}
                      </a>
                    </>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ol>
        <a href={GUIDE_URL} target="_blank" rel="noreferrer" className={SECONDARY_BTN}>
          {s.switchOff.guide}
        </a>
      </Section>
    </div>
  )
}

const PRIMARY_BTN   = 'inline-flex items-center justify-center bg-brand-900 hover:bg-brand-950 text-white text-sm font-semibold py-2 px-5 rounded-lg transition-colors'
const SECONDARY_BTN = 'inline-flex items-center justify-center border border-surface-300 text-brand-900 hover:bg-surface-100 text-sm font-semibold py-2 px-5 rounded-lg transition-colors'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <h2 className="text-base font-bold text-brand-900">{title}</h2>
      {children}
    </section>
  )
}

// Each check reads as a sentence with the number in it, and carries the link to
// the page that would resolve it — a count with nowhere to go is a nag.
function CheckRow({ check }: { check: ReadinessCheck }) {
  const c = s.checks
  const money = (n: number) => `${siteConfig.locale.currency} ${n.toLocaleString()}`
  const copy: Record<ReadinessCheck['id'], { text: string; to?: string; label?: string }> = {
    backup: {
      text: check.level === 'ok'
        ? c.backupOk(new Date(check.detail!).toLocaleString())
        : check.detail
          ? c.backupStale(new Date(check.detail).toLocaleString())
          : c.backupNever,
      to: '/admin/backup', label: c.backupAction,
    },
    upcomingEvents: {
      text:  check.level === 'ok' ? c.upcomingOk : c.upcomingWarn(check.count, check.detail ?? ''),
      to:    '/admin/events', label: c.upcomingAction,
    },
    moneyOwedToShop: {
      text: check.level === 'ok' ? c.owedOk : c.owedWarn(money(check.count)),
      to:   '/admin/audits', label: c.owedAction,
    },
    creditsOwedToDivers: {
      text: check.level === 'ok' ? c.creditsOk : c.creditsWarn(money(check.count)),
      to:   '/admin/refunds', label: c.creditsAction,
    },
    divers: {
      text: check.level === 'ok' ? c.diversOk : c.diversWarn(check.count),
      to:   '/admin/users', label: c.diversAction,
    },
  }
  const row = copy[check.id]

  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden="true" className={check.level === 'ok' ? 'text-emerald-700' : 'text-amber-700'}>
        {check.level === 'ok' ? '✓' : '!'}
      </span>
      <span className="text-brand-900">
        <span className="sr-only">{check.level === 'ok' ? c.srOk : c.srWarn}</span>
        {row.text}
        {check.level === 'warn' && row.to && (
          <>
            {' '}
            <Link to={row.to} className="font-semibold text-brand-700 underline">{row.label}</Link>
          </>
        )}
      </span>
    </li>
  )
}

// The last thing the app can say. Prefilled, because a shop owner writing this
// message is not in the mood to compose it from nothing.
function NotifySection({ onSent, onFailed }: { onSent: (n: number) => void; onFailed: (msg: string) => void }) {
  const shop = siteConfig.identity.shopName
  const [title, setTitle] = useState(s.notify.defaultTitle(shop))
  const [body, setBody] = useState(s.notify.defaultBody(shop))
  const [sending, setSending] = useState(false)
  const configured = !!pushWorkerUrl()

  async function send() {
    if (!title.trim() || !body.trim()) { onFailed(s.notify.needsText); return }
    setSending(true)
    try {
      const result = await sendPushBroadcast({ title, body })
      onSent(result.sent)
    } catch (err) {
      onFailed(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const field = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

  return (
    <Section title={s.notify.title}>
      <p className="text-sm text-brand-900">{s.notify.body}</p>
      {!configured ? (
        <p className="text-sm text-brand-900/80">{s.notify.notConfigured}</p>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-brand-900">{s.notify.titleLabel}</span>
            <input type="text" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} className={field} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-brand-900">{s.notify.bodyLabel}</span>
            <textarea value={body} rows={3} maxLength={300} onChange={e => setBody(e.target.value)} className={`${field} resize-y`} />
          </label>
          <button type="button" onClick={send} disabled={sending} className={`${PRIMARY_BTN} disabled:opacity-60`}>
            {sending ? s.notify.sending : s.notify.send}
          </button>
        </>
      )}
    </Section>
  )
}
