import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { personName } from '../../lib/names'
import {
  fetchReferralsWithDivers, updateReferral, recordReferralBooking, setKickbackStatus,
  summarizeKickbacks, type AdminReferral,
} from '../../lib/trip-referrals'
import type { Trip, ReferralStatus, KickbackStatus } from '../../types/database'
import { BTN_SECONDARY } from '../../styles/tokens'

// Referrals pipeline + kickback ledger. Each row is one diver-interest; the
// admin walks it interested → introduced → booked → completed (or cancelled),
// reveals the diver's contact to broker the intro, records the booked amount
// the partner reports (kickback_amount is computed by the DB), and tracks the
// kickback pending → invoiced → received.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminReferralsTab({ trips }: { trips: Trip[] }) {
  const toast = useToast()
  const [referrals, setReferrals] = useState<AdminReferral[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [booking, setBooking] = useState<AdminReferral | null>(null)

  const tripById = new Map(trips.map(t => [t.id, t]))

  async function reload() {
    try {
      setReferrals(await fetchReferralsWithDivers())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchReferralsWithDivers()
        if (!cancelled) setReferrals(rows)
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
    ? referrals.filter(r =>
        r.referral_code.toLowerCase().includes(q) ||
        (r.diver && personName(r.diver.name, r.diver.nickname).toLowerCase().includes(q)) ||
        (tripById.get(r.trip_id)?.title.toLowerCase().includes(q) ?? false))
    : referrals

  if (loading) return <p className="text-sm text-white/70">Loading…</p>

  const kickbacks = summarizeKickbacks(referrals)

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>}

      {kickbacks.length > 0 && (
        <div role="group" aria-label="Kickback totals" className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-1">
          <h2 className="text-sm font-bold text-brand-900">Kickbacks</h2>
          {kickbacks.map(k => (
            <p key={k.currency} className="text-xs text-brand-900/80">
              <span className="font-semibold">{k.currency}</span>: {k.received.toLocaleString()} received ·{' '}
              {k.outstanding.toLocaleString()} outstanding
            </p>
          ))}
        </div>
      )}

      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search by code, diver or trip…"
        aria-label="Search referrals"
        className={FIELD}
      />

      {shown.length === 0 ? (
        <p className="text-sm text-white/70">No referrals{q ? ' match your search' : ' yet'}.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map(r => (
            <li key={r.id}>
              <ReferralCard
                referral={r}
                trip={tripById.get(r.trip_id) ?? null}
                onSetStatus={(s) => act(() => updateReferral(r.id, { status: s }), `Marked ${s}`)}
                onRecordBooking={() => setBooking(r)}
                onSetKickback={(s) => act(() => setKickbackStatus(r.id, s), `Kickback ${s}`)}
              />
            </li>
          ))}
        </ul>
      )}

      {booking && (
        <RecordBookingModal
          referral={booking}
          trip={tripById.get(booking.trip_id) ?? null}
          onClose={() => setBooking(null)}
          onSaved={async () => { setBooking(null); await reload(); toast.success('Booking recorded') }}
          onError={m => toast.error(m)}
        />
      )}
    </div>
  )
}

function ReferralCard({
  referral, trip, onSetStatus, onRecordBooking, onSetKickback,
}: {
  referral: AdminReferral
  trip: Trip | null
  onSetStatus: (s: ReferralStatus) => void
  onRecordBooking: () => void
  onSetKickback: (s: KickbackStatus) => void
}) {
  const [showContact, setShowContact] = useState(false)
  const diverName = referral.diver ? personName(referral.diver.name, referral.diver.nickname) : '(unknown diver)'
  const booked = referral.status === 'booked' || referral.status === 'completed'

  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-brand-900 text-sm truncate">{trip?.title ?? '(trip removed)'}</p>
          <p className="text-xs text-brand-900/80 truncate">
            {diverName} · <span className="font-mono">{referral.referral_code}</span>
          </p>
        </div>
        <ReferralStatusBadge status={referral.status} />
      </div>

      <div className="text-xs">
        <button type="button" onClick={() => setShowContact(v => !v)} className="text-brand-800 font-semibold hover:underline">
          {showContact ? 'Hide contact' : 'Reveal contact to broker intro'}
        </button>
        {showContact && referral.diver && (
          <p className="text-brand-900/80 mt-1">
            {referral.diver.email ?? 'no email'}{referral.diver.contact_id ? ` · ${referral.diver.contact_id}` : ''}
          </p>
        )}
      </div>

      {booked && (
        <div className="text-xs text-brand-900/80 bg-surface-50 border border-surface-200 rounded-md px-2 py-1">
          Booked {referral.booked_amount?.toLocaleString()} {referral.booked_currency} ·
          kickback {referral.kickback_amount?.toLocaleString() ?? '—'} {referral.booked_currency} ·
          <span className="font-semibold"> {referral.kickback_status}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {referral.status === 'interested' && (
          <Action label="Mark introduced" color="bg-brand-600 hover:bg-brand-500" onClick={() => onSetStatus('introduced')} />
        )}
        {(referral.status === 'interested' || referral.status === 'introduced') && (
          <Action label="Record booking" color="bg-emerald-700 hover:bg-emerald-800" onClick={onRecordBooking} />
        )}
        {referral.status === 'booked' && (
          <Action label="Mark completed" color="bg-brand-900 hover:bg-brand-950" onClick={() => onSetStatus('completed')} />
        )}
        {booked && referral.kickback_status === 'pending' && (
          <Action label="Kickback invoiced" color="bg-amber-600 hover:bg-amber-700" onClick={() => onSetKickback('invoiced')} />
        )}
        {booked && referral.kickback_status !== 'received' && (
          <Action label="Kickback received" color="bg-emerald-700 hover:bg-emerald-800" onClick={() => onSetKickback('received')} />
        )}
        {referral.status !== 'cancelled' && referral.status !== 'completed' && (
          <Action label="Cancel" color="bg-red-700 hover:bg-red-800" onClick={() => onSetStatus('cancelled')} />
        )}
      </div>
    </div>
  )
}

function Action({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`text-xs font-semibold text-white px-2.5 py-1 rounded-lg ${color}`}>
      {label}
    </button>
  )
}

function ReferralStatusBadge({ status }: { status: ReferralStatus }) {
  const map: Record<ReferralStatus, string> = {
    interested: 'bg-surface-100 text-surface-800 border-surface-300',
    introduced: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    booked: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    completed: 'bg-brand-100 text-brand-800 border-brand-300',
    cancelled: 'bg-slate-100 text-slate-600 border-slate-300',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${map[status]}`}>{status}</span>
}

function RecordBookingModal({
  referral, trip, onClose, onSaved, onError,
}: {
  referral: AdminReferral
  trip: Trip | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [amount, setAmount] = useState(referral.booked_amount?.toString() ?? trip?.price?.toString() ?? '')
  const [currency, setCurrency] = useState(referral.booked_currency ?? trip?.currency ?? siteConfig.locale.currency)
  const [rate, setRate] = useState((((referral.kickback_rate ?? trip?.kickback_rate ?? 0.05)) * 100).toString())
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amount.trim() || Number.isNaN(amt) || amt < 0) { onError('Enter the amount the diver booked.'); return }
    setSubmitting(true)
    try {
      await recordReferralBooking({
        id: referral.id,
        bookedAmount: amt,
        bookedCurrency: currency.trim() || siteConfig.locale.currency,
        kickbackRate: Number(rate) / 100,
      })
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const preview = (Number(amount) || 0) * (Number(rate) / 100)

  return (
    <Modal labelledBy="record-booking-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="record-booking-title" className="text-lg font-bold text-brand-900">Record booking</h2>
        <p className="text-xs text-brand-900/80">
          What the partner reported for <span className="font-mono">{referral.referral_code}</span>.
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-brand-900">Booked amount</span>
          <input className={FIELD} type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} aria-label="Booked amount" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-brand-900">Currency</span>
            <input className={FIELD} value={currency} onChange={e => setCurrency(e.target.value)} aria-label="Currency" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-brand-900">Kickback %</span>
            <input className={FIELD} type="number" step="any" value={rate} onChange={e => setRate(e.target.value)} aria-label="Kickback percent" />
          </label>
        </div>
        <p className="text-xs text-brand-900/80">Kickback: <span className="font-semibold">{preview.toLocaleString()} {currency}</span></p>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting}
            className={`flex-1 ${BTN_SECONDARY}`}>Cancel</button>
          <button type="submit" disabled={submitting}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50">
            {submitting ? 'Saving…' : 'Record booking'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Modal({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
