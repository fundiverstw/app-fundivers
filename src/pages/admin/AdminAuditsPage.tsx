import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import { personName } from '../../lib/names'
import { formatEventSpan } from '../../lib/events'
import { siteConfig } from '../../config/site'
import {
  fetchDiverAuditTrail,
  signedDisplayAmount,
  type AuditEntry,
  type AuditKind,
  type DiverAuditTrail,
  type RegistrationAudit,
} from '../../lib/audit-trail'
import { Spinner } from '../../components/ui/Spinner'
import {
  CARD, CARD_ELEVATED, INPUT,
  TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, TEXT_ERROR, BTN_GHOST,
} from '../../styles/tokens'
import { t } from '../../i18n'
import type { Booking, Profile } from '../../types/database'

const au = t.admin.audits

// Read-only forensic view of everything that ever touched a diver's balance —
// payments, refunds, voids, store credit, admin balance amendments and the
// booking/profile field-change log — merged into one time-ordered feed and
// drilled down per registration. Built for tracing payment bugs: every row is
// timestamped, attributed to whoever did it, and expandable to the raw record.
// No mutations live here; correcting data still happens on the Users / event
// pages, so this page can never itself become a source of drift.

function money(n: number, cur: string): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}${cur} ${Math.abs(Math.round(n)).toLocaleString()}`
}

const TEXT_LINK_MUTED = 'text-reef-300/80 hover:text-reef-200'

// Per-kind label + colour tone. Labels are localized; tones map to the
// dark-glass text tokens (green = money in, amber = owes more / returned,
// muted = neutral/reversed).
const KIND_META: Record<AuditKind, { label: string; tone: string }> = {
  payment_paid:     { label: au.kinds.paymentPaid,    tone: 'text-reef-300' },
  payment_refunded: { label: au.kinds.paymentRefunded, tone: 'text-amber-300' },
  payment_voided:   { label: au.kinds.paymentVoided,  tone: 'text-brand-100/60 line-through' },
  payment_pending:  { label: au.kinds.paymentPending, tone: 'text-brand-100/70' },
  credit_issued:    { label: au.kinds.creditIssued,   tone: 'text-reef-300' },
  credit_settled:   { label: au.kinds.creditSettled,  tone: 'text-brand-100/70' },
  amendment:        { label: au.kinds.amendment,      tone: 'text-amber-300' },
  booking_insert:   { label: au.kinds.bookingCreated, tone: 'text-brand-50/90' },
  booking_update:   { label: au.kinds.bookingChanged, tone: 'text-brand-50/90' },
  booking_delete:   { label: au.kinds.bookingDeleted, tone: 'text-red-300' },
  profile_insert:   { label: au.kinds.profileCreated, tone: 'text-brand-50/90' },
  profile_update:   { label: au.kinds.profileChanged, tone: 'text-brand-50/90' },
  profile_delete:   { label: au.kinds.profileDeleted, tone: 'text-red-300' },
}

const STATUS_TONE: Record<Booking['status'], string> = {
  pending:    'text-amber-300 border-amber-400/40',
  confirmed:  'text-reef-300 border-reef-400/40',
  cancelled:  'text-red-300 border-red-400/40',
  waitlisted: 'text-brand-100/70 border-white/20',
}

const BALANCE_TONE = {
  due:     'text-amber-300',
  settled: 'text-brand-50/90',
  credit:  'text-reef-300',
} as const

interface EntryRowProps {
  entry: AuditEntry
  currency: string
  actorName: (id: string | null) => string
}

function EntryRow({ entry, currency, actorName }: EntryRowProps) {
  const meta = KIND_META[entry.kind]
  const signed = signedDisplayAmount(entry)
  return (
    <li className="border-t border-white/10 first:border-t-0 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm font-semibold ${meta.tone}`}>{meta.label}</span>
        {signed != null && (
          <span className={`text-sm tabular-nums font-medium ${signed < 0 ? 'text-reef-300' : 'text-amber-300'}`}>
            {money(signed, entry.currency ?? currency)}
          </span>
        )}
      </div>
      <div className={`text-xs ${TEXT_SUBTLE} mt-0.5`}>
        {format(new Date(entry.at), 'yyyy-MM-dd HH:mm')}
        {entry.method ? ` · ${entry.method}` : ''}
        {entry.actorId ? ` · ${au.byActor(actorName(entry.actorId))}` : ''}
      </div>
      {entry.note && <div className={`text-xs ${TEXT_MUTED} mt-1`}>{entry.note}</div>}
      {entry.changed && entry.changed.length > 0 && (
        <div className={`text-xs ${TEXT_MUTED} mt-1`}>
          {au.changedFields}: <span className="font-mono">{entry.changed.join(', ')}</span>
        </div>
      )}
      <details className="mt-1">
        <summary className={`text-[11px] ${TEXT_LINK_MUTED} cursor-pointer select-none`}>{au.rawRecord}</summary>
        <pre className="mt-1 text-[11px] leading-snug text-brand-100/70 bg-black/30 rounded-md p-2 overflow-x-auto">
          {JSON.stringify(entry.raw, null, 2)}
        </pre>
      </details>
    </li>
  )
}

interface RegistrationCardProps {
  reg: RegistrationAudit
  currency: string
  actorName: (id: string | null) => string
}

function RegistrationCard({ reg, currency, actorName }: RegistrationCardProps) {
  const { booking, event, balance } = reg
  const cur = event?.currency ?? currency
  return (
    <div className={`${CARD} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-semibold ${TEXT_BODY} truncate`}>{event?.title ?? au.eventFallback}</div>
          {event && (
            <div className={`text-xs ${TEXT_MUTED}`}>{formatEventSpan(event, { withYear: true })}</div>
          )}
        </div>
        <span className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_TONE[booking.status]}`}>
          {booking.status}
        </span>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div>
          <dt className={`text-[11px] ${TEXT_SUBTLE}`}>{au.owed}</dt>
          <dd className={`tabular-nums ${TEXT_BODY}`}>{money(reg.owed, cur)}</dd>
          {reg.amendmentsDelta !== 0 && (
            <dd className={`text-[11px] ${TEXT_SUBTLE}`}>
              {au.base}: {money(reg.owedBase, cur)} · {au.adjusted}: {money(reg.amendmentsDelta, cur)}
            </dd>
          )}
        </div>
        <div>
          <dt className={`text-[11px] ${TEXT_SUBTLE}`}>{au.paid}</dt>
          <dd className={`tabular-nums ${TEXT_BODY}`}>{money(reg.paid, cur)}</dd>
        </div>
        <div>
          <dt className={`text-[11px] ${TEXT_SUBTLE}`}>{au.openCredit}</dt>
          <dd className={`tabular-nums ${TEXT_BODY}`}>{money(reg.openCredit, cur)}</dd>
        </div>
        <div>
          <dt className={`text-[11px] ${TEXT_SUBTLE}`}>{au.balance}</dt>
          <dd className={`tabular-nums font-semibold ${BALANCE_TONE[balance.state]}`}>
            {balance.state === 'settled' ? au.settled : money(balance.amount, cur)}
          </dd>
        </div>
      </dl>

      {reg.entries.length === 0 ? (
        <p className={`text-xs ${TEXT_SUBTLE}`}>{au.noActivity}</p>
      ) : (
        <ul>
          {reg.entries.map(e => (
            <EntryRow key={e.id} entry={e} currency={cur} actorName={actorName} />
          ))}
        </ul>
      )}
    </div>
  )
}

interface DiverTrailProps {
  trail: DiverAuditTrail
  actorName: (id: string | null) => string
}

function DiverTrail({ trail, actorName }: DiverTrailProps) {
  const [showFeed, setShowFeed] = useState(false)
  const cur = siteConfig.locale.currency
  const { totals } = trail

  return (
    <div className="space-y-4">
      <div className={`${CARD_ELEVATED} p-4 space-y-3`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={`text-lg ${TEXT_HEADING}`}>{personName(trail.profile.name, trail.profile.nickname)}</h2>
          <span className={`text-sm ${TEXT_MUTED}`}>
            {au.accountCredit}: <span className="tabular-nums text-reef-300 font-semibold">{money(trail.accountCreditBalance, cur)}</span>
          </span>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div><dt className={`text-[11px] ${TEXT_SUBTLE}`}>{au.totalPaid}</dt><dd className={`tabular-nums ${TEXT_BODY}`}>{money(totals.paid, cur)}</dd></div>
          <div><dt className={`text-[11px] ${TEXT_SUBTLE}`}>{au.totalRefunded}</dt><dd className={`tabular-nums ${TEXT_BODY}`}>{money(totals.refunded, cur)}</dd></div>
          <div><dt className={`text-[11px] ${TEXT_SUBTLE}`}>{au.totalCredited}</dt><dd className={`tabular-nums ${TEXT_BODY}`}>{money(totals.credited, cur)}</dd></div>
          <div><dt className={`text-[11px] ${TEXT_SUBTLE}`}>{au.totalAdjusted}</dt><dd className={`tabular-nums ${TEXT_BODY}`}>{money(totals.adjusted, cur)}</dd></div>
        </dl>
      </div>

      <div className="space-y-1">
        <h3 className={`text-xs font-semibold uppercase tracking-wider ${TEXT_MUTED}`}>{au.registrations}</h3>
      </div>
      {trail.registrations.length === 0 ? (
        <p className={`text-sm ${TEXT_SUBTLE}`}>{au.noRegistrations}</p>
      ) : (
        <div className="space-y-3">
          {trail.registrations.map(reg => (
            <RegistrationCard key={reg.booking.id} reg={reg} currency={cur} actorName={actorName} />
          ))}
        </div>
      )}

      {trail.generalCredits.length > 0 && (
        <div className={`${CARD} p-4 space-y-2`}>
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${TEXT_MUTED}`}>{au.otherCredits}</h3>
          <ul className="space-y-1">
            {trail.generalCredits.map(c => (
              <li key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className={TEXT_BODY}>{c.reason}</span>
                <span className={`tabular-nums ${c.status === 'open' ? 'text-reef-300' : TEXT_SUBTLE}`}>
                  {money(Number(c.amount), c.currency)} · {c.status === 'open' ? au.creditOpen : au.creditSettledShort}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button type="button" onClick={() => setShowFeed(v => !v)} className={`${BTN_GHOST} text-sm px-3`}>
          {showFeed ? au.hideFeed : au.showFeed}
        </button>
      </div>
      {showFeed && (
        <div className={`${CARD} p-4`}>
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${TEXT_MUTED} mb-2`}>{au.combinedFeed}</h3>
          <ul>
            {[...trail.allEntries].reverse().map(e => (
              <EntryRow key={e.id} entry={e} currency={cur} actorName={actorName} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function AdminAuditsPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trail, setTrail] = useState<DiverAuditTrail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    supabase.from('profiles').select('*').order('name', { ascending: true })
      .then(({ data }) => setProfiles((data ?? []) as Profile[]))
  }, [])

  // Deep link: /admin/audits?diver=<id> opens straight to that diver — used
  // when jumping here from the Users page to trace a specific account.
  const deepLinkId = searchParams.get('diver')
  useEffect(() => {
    if (deepLinkId && deepLinkId !== selectedId) select(deepLinkId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId])

  const nameById = useMemo(
    () => new Map(profiles.map(p => [p.id, personName(p.name, p.nickname)])),
    [profiles],
  )
  const actorName = (id: string | null): string =>
    (id && nameById.get(id)) || (id ? `${au.unknownActor} (${id.slice(0, 8)})` : au.unknownActor)

  async function select(id: string) {
    setSelectedId(id)
    setTrail(null)
    setError(null)
    setLoading(true)
    try {
      setTrail(await fetchDiverAuditTrail(id))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setSelectedId(null)
    setTrail(null)
    setError(null)
    if (deepLinkId) setSearchParams({})
  }

  const q = filter.trim().toLowerCase()
  const matches = q
    ? profiles.filter(p =>
        [p.name, p.nickname, p.contact_id].some(v => (v ?? '').toLowerCase().includes(q)))
    : profiles

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className={`text-xl ${TEXT_HEADING}`}>{au.title}</h1>
        <p className={`text-sm ${TEXT_MUTED}`}>{au.subtitle}</p>
      </header>

      {selectedId ? (
        <div className="space-y-4">
          <button type="button" onClick={clear} className={`${BTN_GHOST} text-sm px-3`}>{au.changeDiver}</button>
          {error && <p className={`text-sm ${TEXT_ERROR}`}>{error}</p>}
          {loading && (
            <div className="flex justify-center py-16"><Spinner className="w-6 h-6 border-2 border-surface-300" /></div>
          )}
          {trail && <DiverTrail trail={trail} actorName={actorName} />}
        </div>
      ) : (
        <>
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={au.searchPlaceholder}
            className={INPUT}
          />
          <ul className="space-y-2">
            {matches.map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(p.id)}
                  className={`${CARD} w-full text-left p-3 flex items-baseline justify-between gap-3`}
                >
                  <span className={`font-medium ${TEXT_BODY} truncate`}>{personName(p.name, p.nickname)}</span>
                  <span className={`text-xs ${TEXT_SUBTLE} shrink-0`}>{p.contact_id ?? ''}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className={`text-sm ${TEXT_SUBTLE}`}>{au.noDivers}</li>}
          </ul>
        </>
      )}
    </div>
  )
}
