import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { fetchEventsForBookings } from '../../lib/events'
import { getCertCardSignedUrl } from '../../lib/cert-card'
import { shoeAsJp } from '../../lib/shoe-size'
import type { AppEvent, Booking, Payment, Profile } from '../../types/database'

interface UserExtras {
  bookings: Array<Booking & { event: AppEvent | null }>
  payments: Payment[]
  paidSum: number
  pendingSum: number
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<Profile[]>([])
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [extrasCache, setExtrasCache] = useState<Map<string, UserExtras>>(new Map())
  const [extrasLoading, setExtrasLoading] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true })
      .then(({ data }) => setUsers((data ?? []) as Profile[]))
  }, [])

  async function toggle(userId: string) {
    if (expanded === userId) {
      setExpanded(null)
      return
    }
    setExpanded(userId)
    if (extrasCache.has(userId)) return

    setExtrasLoading(userId)
    const [bookingsRes, paymentsRes] = await Promise.all([
      supabase.from('bookings').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ])
    const bookings = bookingsRes.data ?? []
    const payments = (paymentsRes.data ?? []) as Payment[]

    const diveIds = bookings.map(b => b.eo_dive_id).filter((x): x is string => !!x)
    const courseIds = bookings.map(b => b.eo_course_id).filter((x): x is string => !!x)
    const eventMap = (diveIds.length || courseIds.length)
      ? await fetchEventsForBookings(diveIds, courseIds)
      : new Map<string, AppEvent>()

    const hydrated = bookings.map(b => ({
      ...b,
      event: eventMap.get((b.eo_dive_id ?? b.eo_course_id)!) ?? null,
    }))
    const paidSum = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
    const pendingSum = payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0)

    setExtrasCache(prev => {
      const next = new Map(prev)
      next.set(userId, { bookings: hydrated, payments, paidSum, pendingSum })
      return next
    })
    setExtrasLoading(null)
  }

  const visible = users.filter(u => {
    if (!filter) return true
    const haystack = [u.full_name, u.display_name, u.contact_id, u.phone]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(filter.toLowerCase())
  })

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-slate-100">People</h1>

      <input
        type="text"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Search by name, contact, cert…"
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-sky-500"
      />

      <div className="space-y-2">
        {visible.map(u => (
          <UserCard
            key={u.id}
            user={u}
            open={expanded === u.id}
            extras={extrasCache.get(u.id) ?? null}
            loading={extrasLoading === u.id}
            onToggle={() => toggle(u.id)}
          />
        ))}
        {visible.length === 0 && (
          <p className="text-slate-500 text-sm">No matches.</p>
        )}
      </div>
    </div>
  )
}

function UserCard({
  user, open, extras, loading, onToggle,
}: {
  user: Profile
  open: boolean
  extras: UserExtras | null
  loading: boolean
  onToggle: () => void
}) {
  return (
    <div className="bg-slate-800 rounded-xl">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-3 flex items-start justify-between hover:bg-slate-700/50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-100 text-sm">
            {user.full_name ?? '(unnamed)'}
            {user.display_name && <span className="text-slate-400"> “{user.display_name}”</span>}
          </p>
          <p className="text-xs text-slate-400">
            {user.cert_agency && user.cert_level ? `${user.cert_agency} ${user.cert_level}` : 'Uncertified'}
            {user.logged_dives > 0 && ` · ${user.logged_dives} logged`}
            {user.nitrox_certified && ' · Nitrox'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            user.role === 'admin' ? 'bg-amber-900 text-amber-300' : 'bg-sky-900 text-sky-300'
          }`}>
            {user.role}
          </span>
          <span className="text-xs text-slate-500">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-700 pt-3 space-y-4 text-sm">
          <ProfileDetails user={user} />
          {loading && (
            <div className="flex justify-center py-2"><div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
          )}
          {extras && <ExtrasBlock extras={extras} />}
        </div>
      )}
    </div>
  )
}

function ProfileDetails({ user }: { user: Profile }) {
  const contact = user.contact_method && user.contact_id
    ? `${labelForMethod(user.contact_method)}: ${user.contact_id}`
    : null
  const sizing = [
    user.height_cm ? `${user.height_cm} cm` : null,
    user.weight_kg ? `${user.weight_kg} kg` : null,
    user.shoe_size ? `shoe ${shoeAsJp(user.shoe_size) ?? user.shoe_size}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-3">
      <Section title="Personal">
        <Row k="Phone" v={user.phone} />
        <Row k="Email contact" v={contact} />
        <Row k="DOB" v={user.date_of_birth ? format(new Date(user.date_of_birth), 'MMM d, yyyy') : null} />
        <Row k="Nationality" v={user.nationality} />
        <Row k="ID / Passport" v={user.id_number} />
        <Row k="Gender" v={user.gender} />
      </Section>

      <Section title="Emergency contact">
        <Row k="Name" v={user.emergency_contact_name} />
        <Row k="Phone" v={user.emergency_contact_phone} />
      </Section>

      <Section title="Certification">
        <Row k="Agency + level" v={user.cert_agency && user.cert_level ? `${user.cert_agency} ${user.cert_level}` : null} />
        <Row k="Logged dives" v={String(user.logged_dives ?? 0)} />
        <Row k="Last dive" v={user.last_dive_date ? format(new Date(user.last_dive_date), 'MMM d, yyyy') : null} />
        <Row k="Nitrox" v={user.nitrox_certified ? 'certified' : 'no'} />
        {user.cert_card_path && <CertCardPreview path={user.cert_card_path} />}
      </Section>

      <Section title="Sizing">
        <Row k="Body + shoe" v={sizing || null} />
      </Section>

      {user.medical_notes && (
        <Section title="Medical notes">
          <p className="text-slate-300 bg-slate-900/50 rounded p-2 text-xs whitespace-pre-wrap">{user.medical_notes}</p>
        </Section>
      )}
    </div>
  )
}

function ExtrasBlock({ extras }: { extras: UserExtras }) {
  const activeBookings = extras.bookings.filter(b => b.status !== 'cancelled')
  return (
    <div className="space-y-3 pt-2 border-t border-slate-700">
      <Section title="Bookings">
        {activeBookings.length === 0 ? (
          <p className="text-slate-500 text-xs">None active.</p>
        ) : (
          <div className="space-y-1">
            {activeBookings.map(b => (
              <div key={b.id} className="flex items-start justify-between text-xs">
                <div className="min-w-0">
                  <p className="text-slate-200 truncate">{b.event?.title ?? '(event)'}</p>
                  {b.event && (
                    <p className="text-slate-500">{format(new Date(b.event.start_time), 'MMM d yyyy')}</p>
                  )}
                </div>
                <span className={`capitalize shrink-0 ml-2 ${statusColor(b.status)}`}>{b.status}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Payments">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Paid</span>
          <span className="text-emerald-400">{extras.paidSum.toLocaleString()}</span>
        </div>
        {extras.pendingSum > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Pending</span>
            <span className="text-amber-400">{extras.pendingSum.toLocaleString()}</span>
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-sky-400 uppercase tracking-wider">{title}</p>
      <div className="pl-1 space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{k}</span>
      <span className="text-slate-200 text-right">{v}</span>
    </div>
  )
}

function labelForMethod(m: NonNullable<Profile['contact_method']>) {
  return m === 'whatsapp' ? 'WhatsApp' : m === 'line' ? 'Line' : m === 'phone' ? 'Phone' : 'Email'
}

function statusColor(s: Booking['status']) {
  return s === 'confirmed' ? 'text-emerald-400'
    : s === 'pending'    ? 'text-amber-400'
    : s === 'waitlisted' ? 'text-violet-400'
    :                      'text-slate-500'
}

function CertCardPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getCertCardSignedUrl(path).then(u => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [path])
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block mt-2">
      <img
        src={url}
        alt="Certification card"
        className="w-full rounded-lg border border-slate-700"
      />
    </a>
  )
}
