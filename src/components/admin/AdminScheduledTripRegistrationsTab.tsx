import { useEffect, useState } from 'react'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { personName } from '../../lib/names'
import {
  fetchRegistrationsWithDivers, setRegistrationStatus,
  type AdminScheduledTripRegistration,
} from '../../lib/scheduled-trip-registrations'
import type { RegistrationStatus } from '../../types/database'
import { t } from '../../i18n'
import { BTN_XS_GHOST } from '../../styles/tokens'

const ar = t.admin.adminRegs

// The Manage roster for scheduled-trip registrations: every app user who
// registered for one of the shop's own trips, their extras + estimate + status.
// No kickback tally — the shop keeps 100% of its own trips.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminScheduledTripRegistrationsTab() {
  const toast = useToast()
  const [regs, setRegs] = useState<AdminScheduledTripRegistration[]>([])
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
        (r.trip_title?.toLowerCase().includes(q) ?? false) ||
        (r.diver && personName(r.diver.name, r.diver.nickname).toLowerCase().includes(q)))
    : regs

  if (loading) return <p className="text-sm text-white/70">{ar.loading}</p>

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>}

      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={ar.searchTripsPlaceholder}
        aria-label={ar.searchAria}
        className={FIELD}
      />

      {shown.length === 0 ? (
        <p className="text-sm text-white/70">{q ? ar.noneMatch : ar.noneYet}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map(r => (
            <li key={r.id}>
              <RegistrationCard
                reg={r}
                onSetStatus={s => act(() => setRegistrationStatus(r.id, s), ar.markedStatus(s))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RegistrationCard({ reg, onSetStatus }: {
  reg: AdminScheduledTripRegistration
  onSetStatus: (s: RegistrationStatus) => void
}) {
  const [showContact, setShowContact] = useState(false)
  const diverLabel = reg.diver ? personName(reg.diver.name, reg.diver.nickname) : ar.unknownDiver
  const currency = reg.estimated_currency ?? siteConfig.locale.currency

  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-brand-900 text-sm truncate">{reg.trip_title ?? ar.tripFallback}</p>
          <p className="text-xs text-brand-900/80 truncate">{diverLabel}</p>
        </div>
        <StatusBadge status={reg.status} />
      </div>

      {reg.estimated_cost != null && (
        <div className="text-xs text-brand-900/80">{ar.estimated(reg.estimated_cost.toLocaleString(), currency)}</div>
      )}

      <button type="button" onClick={() => setShowContact(v => !v)} className={BTN_XS_GHOST}>
        {showContact ? ar.hideContact : ar.revealContact}
      </button>
      {showContact && reg.diver && (
        <p className="text-xs text-brand-900/80">
          {reg.diver.email ?? ar.noEmail}{reg.diver.contact_id ? ` · ${reg.diver.contact_id}` : ''}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {reg.status === 'registered' && (
          <button type="button" onClick={() => onSetStatus('completed')}
            className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-2.5 py-1 rounded-lg">{ar.markCompleted}</button>
        )}
        {reg.status !== 'cancelled' && (
          <button type="button" onClick={() => onSetStatus('cancelled')}
            className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-2.5 py-1 rounded-lg">{ar.cancel}</button>
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
