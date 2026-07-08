import { useEffect, useState } from 'react'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { personName } from '../../lib/names'
import { packageDateLabel } from '../../lib/package-format'
import {
  fetchRegistrationsWithDivers, summarizeKickbacks, setKickbackStatus, setRegistrationStatus,
  type AdminRegistration,
} from '../../lib/package-registrations'
import type { RegistrationStatus } from '../../types/database'

// The Manage roster + kickback ledger for package registrations. Every row is an
// app user who registered for a partner package: their chosen tier + preferred
// dates, the cost estimate, and the kickback we expect (estimate × rate). The
// running tally at the top is expected-vs-paid per currency.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminRegistrationsTab() {
  const toast = useToast()
  const [regs, setRegs] = useState<AdminRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  async function reload() {
    try {
      setRegs(await fetchRegistrationsWithDivers())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchRegistrationsWithDivers()
        if (!cancelled) setRegs(rows)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function act(fn: () => Promise<void>, okMsg: string) {
    try {
      await fn()
      await reload()
      toast.success(okMsg)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const q = query.trim().toLowerCase()
  const shown = q
    ? regs.filter(r =>
        (r.package_title?.toLowerCase().includes(q) ?? false) ||
        (r.tier_name?.toLowerCase().includes(q) ?? false) ||
        (r.diver && personName(r.diver.name, r.diver.nickname).toLowerCase().includes(q)))
    : regs

  if (loading) return <p className="text-sm text-white/70">Loading…</p>

  const kickbacks = summarizeKickbacks(regs)

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>}

      {kickbacks.length > 0 && (
        <div role="group" aria-label="Kickback totals" className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-1">
          <h2 className="text-sm font-bold text-brand-900">Expected kickbacks</h2>
          {kickbacks.map(k => (
            <p key={k.currency} className="text-xs text-brand-900/80">
              <span className="font-semibold">{k.currency}</span>: {k.expected.toLocaleString()} expected ·{' '}
              {k.paid.toLocaleString()} paid ·{' '}
              {(k.expected - k.paid).toLocaleString()} outstanding
            </p>
          ))}
        </div>
      )}

      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search by diver, package or tier…"
        aria-label="Search registrations"
        className={FIELD}
      />

      {shown.length === 0 ? (
        <p className="text-sm text-white/70">No registrations{q ? ' match your search' : ' yet'}.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map(r => (
            <li key={r.id}>
              <RegistrationCard
                reg={r}
                onSetKickback={s => act(() => setKickbackStatus(r.id, s), `Kickback ${s}`)}
                onSetStatus={s => act(() => setRegistrationStatus(r.id, s), `Marked ${s}`)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RegistrationCard({
  reg, onSetKickback, onSetStatus,
}: {
  reg: AdminRegistration
  onSetKickback: (s: 'expected' | 'paid') => void
  onSetStatus: (s: RegistrationStatus) => void
}) {
  const [showContact, setShowContact] = useState(false)
  const diverLabel = reg.diver ? personName(reg.diver.name, reg.diver.nickname) : '(unknown diver)'
  const dates = packageDateLabel(reg.preferred_start, reg.preferred_end)
  const currency = reg.estimated_currency ?? siteConfig.locale.currency

  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-brand-900 text-sm truncate">{reg.package_title ?? '(package)'}</p>
          <p className="text-xs text-brand-900/80 truncate">
            {diverLabel}{reg.tier_name ? ` · ${reg.tier_name}` : ''}{dates ? ` · ${dates}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={reg.status} />
          <KickbackBadge status={reg.kickback_status} />
        </div>
      </div>

      <div className="text-xs text-brand-900/80">
        {reg.estimated_cost != null && <>Est. {reg.estimated_cost.toLocaleString()} {currency}</>}
        {reg.kickback_amount != null && <> · kickback {reg.kickback_amount.toLocaleString()} {currency}</>}
      </div>

      <button type="button" onClick={() => setShowContact(v => !v)} className="text-xs font-semibold text-brand-900 underline">
        {showContact ? 'Hide contact' : 'Reveal contact'}
      </button>
      {showContact && reg.diver && (
        <p className="text-xs text-brand-900/80">
          {reg.diver.email ?? '(no email)'}{reg.diver.contact_id ? ` · ${reg.diver.contact_id}` : ''}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {reg.kickback_status !== 'paid' && (
          <button type="button" onClick={() => onSetKickback('paid')}
            className="text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 rounded-lg">Mark kickback paid</button>
        )}
        {reg.kickback_status === 'paid' && (
          <button type="button" onClick={() => onSetKickback('expected')}
            className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg">Unmark paid</button>
        )}
        {reg.status === 'registered' && (
          <button type="button" onClick={() => onSetStatus('completed')}
            className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-2.5 py-1 rounded-lg">Mark completed</button>
        )}
        {reg.status !== 'cancelled' && (
          <button type="button" onClick={() => onSetStatus('cancelled')}
            className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-2.5 py-1 rounded-lg">Cancel</button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: RegistrationStatus }) {
  const cls = status === 'registered'
    ? 'bg-brand-100 text-brand-800 border-brand-300'
    : status === 'completed'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
      : 'bg-slate-100 text-slate-700 border-slate-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${cls}`}>{status}</span>
}

function KickbackBadge({ status }: { status: 'expected' | 'paid' }) {
  const cls = status === 'paid'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : 'bg-amber-100 text-amber-800 border-amber-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${cls}`}>kickback {status}</span>
}
