import { useEffect, useState } from 'react'
import { siteConfig } from '../../config/site'
import { Spinner } from '../../components/ui/Spinner'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchEventsForBookings, formatEventSpan } from '../../lib/events'
import { fetchAmendmentsForBookings, amendmentsDelta } from '../../lib/booking-amendments'
import { recordPayment, voidPayment } from '../../lib/booking-payments'
import { BookingPaymentsBlock } from '../../components/admin/BookingPaymentsBlock'
import { resolveCharges, type ChargeLine } from '../../lib/booking-charges'
import { fetchChargeCatalog } from '../../lib/booking-charge-catalog'
import { getCertCardSignedUrl } from '../../lib/cert-card'
import { shoeAsJp } from '../../lib/shoe-size'
import { fetchCreditsForUser, openCreditForBooking, openCreditBalance, diverCreditBalance, createCredit, settleCredit, reopenCredit, applyCreditToBooking } from '../../lib/credits'
import { ProfileForm } from '../ProfilePage'
import { DiverNotes } from '../../components/admin/DiverNotes'
import { AdminFamilyPanel } from '../../components/admin/AdminFamilyPanel'
import type { AppEvent, Booking, BookingAmendment, BookingDetails, Credit, Payment, Profile } from '../../types/database'

interface UserExtras {
  bookings: Array<Booking & { event: AppEvent | null; charges: ChargeLine[] }>
  payments: Payment[]
  amendments: Map<string, BookingAmendment[]>
  credits: Credit[]
  paidSum: number
  pendingSum: number
  openCreditBalance: number
}

// Active-booking {owed, paid} rows for diverCreditBalance — owed folds in
// amendments; paid sums the diver's paid payments per booking.
function activeCreditRows(
  bookings: Array<Booking & { event: AppEvent | null }>,
  payments: Payment[],
  amendments: Map<string, BookingAmendment[]>,
): Array<{ id: string; owed: number; paid: number }> {
  const paidByBooking = new Map<string, number>()
  for (const p of payments) {
    if (!p.booking_id || p.status !== 'paid') continue
    paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + p.amount)
  }
  return bookings
    // Exclude cancelled bookings and any a lead booker pays for on this
    // diver's behalf — that money (incl. overpayment) is the lead's, not a
    // credit owed to this diver.
    .filter(b => b.status !== 'cancelled' && !(b.payer_id && b.payer_id !== b.user_id))
    .map(b => ({
      id: b.id,
      owed: Number((b.details as { total?: number } | null)?.total ?? 0) + amendmentsDelta(amendments.get(b.id) ?? []),
      paid: paidByBooking.get(b.id) ?? 0,
    }))
}

export function AdminUsersPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const isAdmin = profile?.role === 'admin'
  const [users, setUsers] = useState<Profile[]>([])
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  // null = nobody editing; userId = inline ProfileForm visible for that user.
  // Only one row can be in edit mode at a time so unsaved fields don't get
  // visually confused across cards.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [extrasCache, setExtrasCache] = useState<Map<string, UserExtras>>(new Map())
  const [extrasLoading, setExtrasLoading] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true })
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
    const extras = await fetchExtras(userId)
    setExtrasCache(prev => new Map(prev).set(userId, extras))
    setExtrasLoading(null)
  }

  // Load (or reload) a diver's bookings/payments/credits panel data. Used on
  // first expand and after credit-apply, which mutates credits + payments +
  // booking status in one server round-trip — cheaper to refetch than to
  // mirror the RPC's consume-and-split locally.
  async function fetchExtras(userId: string): Promise<UserExtras> {
    const [bookingsRes, paymentsRes, credits] = await Promise.all([
      supabase.from('bookings').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      fetchCreditsForUser(userId),
    ])
    const bookings = bookingsRes.data ?? []
    const payments = (paymentsRes.data ?? []) as Payment[]

    const diveIds = bookings.map(b => b.eo_dive_id).filter((x): x is string => !!x)
    const courseIds = bookings.map(b => b.eo_course_id).filter((x): x is string => !!x)
    const [eventMap, amendments, catalog] = await Promise.all([
      diveIds.length || courseIds.length
        ? fetchEventsForBookings(diveIds, courseIds)
        : Promise.resolve(new Map<string, AppEvent>()),
      fetchAmendmentsForBookings(bookings.map(b => b.id)),
      fetchChargeCatalog(bookings.map(b => b.details as BookingDetails)),
    ])

    const hydrated = bookings.map(b => {
      const event = eventMap.get((b.eo_dive_id ?? b.eo_course_id)!) ?? null
      return {
        ...b,
        event,
        charges: resolveCharges({ details: b.details as BookingDetails, event, ...catalog }),
      }
    })
    const paidSum = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
    const pendingSum = payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0)

    return {
      bookings: hydrated,
      payments,
      amendments,
      credits,
      paidSum,
      pendingSum,
      // Account credit = awarded credits + overpayments across active bookings.
      openCreditBalance: diverCreditBalance(credits, activeCreditRows(hydrated, payments, amendments)),
    }
  }

  async function handleRecordPayment(userId: string, bookingId: string, amount: number, note: string) {
    if (!profile?.id) return
    const extras = extrasCache.get(userId)
    if (!extras) return
    const booking = extras.bookings.find(b => b.id === bookingId)
    if (!booking) return

    const existingForBooking = extras.payments.filter(p => p.booking_id === bookingId)
    try {
      const { payment, newStatus } = await recordPayment({
        booking,
        existingPayments: existingForBooking,
        amount, note,
        recordedBy: profile.id,
      })
      const promoted = newStatus !== booking.status
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        const updatedBookings = cur.bookings.map(b =>
          b.id === bookingId ? { ...b, status: newStatus } : b
        )
        const updatedPayments = [payment, ...cur.payments]
        next.set(userId, {
          ...cur,
          bookings: updatedBookings,
          payments: updatedPayments,
          paidSum: updatedPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
          pendingSum: updatedPayments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0),
          // A payment change can push the diver into/out of overpayment, which counts as credit.
          openCreditBalance: diverCreditBalance(cur.credits, activeCreditRows(updatedBookings, updatedPayments, cur.amendments)),
        })
        return next
      })
      toast.success(promoted ? 'Payment recorded · status set to confirmed' : 'Payment recorded')
    } catch (err) {
      toast.error(`Could not record payment: ${errorMessage(err)}`)
      throw err
    }
  }

  // "Mark deposit paid" — confirm a pending booking (deposit received
  // off-app) WITHOUT recording a payment or touching the balance.
  async function handleMarkDepositPaid(userId: string, bookingId: string) {
    const extras = extrasCache.get(userId)
    const booking = extras?.bookings.find(b => b.id === bookingId)
    if (!booking || booking.status !== 'pending') return
    try {
      const { error } = await supabase.from('bookings').update({ status: 'confirmed' }).eq('id', bookingId)
      if (error) throw error
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        next.set(userId, {
          ...cur,
          bookings: cur.bookings.map(b => b.id === bookingId ? { ...b, status: 'confirmed' } : b),
        })
        return next
      })
      toast.success('Marked deposit paid · status set to confirmed')
    } catch (err) {
      toast.error(`Could not update status: ${errorMessage(err)}`)
      throw err
    }
  }

  async function handleApplyCredit(userId: string, bookingId: string, amount: number) {
    try {
      const applied = await applyCreditToBooking({ bookingId, amount })
      const extras = await fetchExtras(userId)
      setExtrasCache(prev => new Map(prev).set(userId, extras))
      toast.success(applied > 0 ? `Applied ${applied.toLocaleString()} credit` : 'Nothing to apply')
    } catch (err) {
      toast.error(`Could not apply credit: ${errorMessage(err)}`)
      throw err
    }
  }

  async function handleCreateCredit(userId: string, amount: number, reason: string, bookingId: string | null) {
    if (!profile?.id) return
    try {
      const credit = await createCredit({
        user_id: userId,
        amount,
        reason,
        booking_id: bookingId,
        created_by: profile.id,
      })
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        const updatedCredits = [credit, ...cur.credits]
        next.set(userId, {
          ...cur,
          credits: updatedCredits,
          openCreditBalance: diverCreditBalance(updatedCredits, activeCreditRows(cur.bookings, cur.payments, cur.amendments)),
        })
        return next
      })
      toast.success(`Credit of ${amount.toLocaleString()} issued`)
    } catch (err) {
      toast.error(`Could not issue credit: ${errorMessage(err)}`)
      throw err
    }
  }

  async function handleSettleCredit(userId: string, creditId: string, note: string) {
    try {
      const credit = await settleCredit({ creditId, note })
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        const updatedCredits = cur.credits.map(c => c.id === credit.id ? credit : c)
        next.set(userId, {
          ...cur,
          credits: updatedCredits,
          openCreditBalance: diverCreditBalance(updatedCredits, activeCreditRows(cur.bookings, cur.payments, cur.amendments)),
        })
        return next
      })
      toast.success('Credit settled')
    } catch (err) {
      toast.error(`Could not settle credit: ${errorMessage(err)}`)
      throw err
    }
  }

  async function refetchUser(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (!data) return
    setUsers(prev => prev.map(u => u.id === userId ? (data as Profile) : u))
  }

  // Full refetch — used after parent/child link mutations since they touch
  // two rows and shift eligibility for every other diver in the picker.
  async function refetchAllUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true })
    setUsers((data ?? []) as Profile[])
  }

  async function handleReopenCredit(userId: string, creditId: string) {
    try {
      const credit = await reopenCredit(creditId)
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        const updatedCredits = cur.credits.map(c => c.id === credit.id ? credit : c)
        next.set(userId, {
          ...cur,
          credits: updatedCredits,
          openCreditBalance: diverCreditBalance(updatedCredits, activeCreditRows(cur.bookings, cur.payments, cur.amendments)),
        })
        return next
      })
      toast.success('Credit re-opened')
    } catch (err) {
      toast.error(`Could not re-open credit: ${errorMessage(err)}`)
      throw err
    }
  }

  async function handleDeleteUser(target: Profile) {
    const name = target.name || target.nickname || target.contact_id || target.id
    const confirmed = window.confirm(
      `Permanently delete ${name}?\n\n` +
      `This removes their account, profile, bookings, payments, ` +
      `credits, notifications, dive log entries, and every other ` +
      `record tied to them. This cannot be undone.`,
    )
    if (!confirmed) return
    try {
      const { error } = await supabase.rpc('admin_delete_user', { p_user_id: target.id })
      if (error) throw error
      setUsers(prev => prev.filter(u => u.id !== target.id))
      setExpanded(null)
      setExtrasCache(prev => {
        const next = new Map(prev)
        next.delete(target.id)
        return next
      })
      toast.success(`Deleted ${name}`)
    } catch (err) {
      toast.error(`Could not delete: ${errorMessage(err)}`)
    }
  }

  async function handleVoidPayment(userId: string, bookingId: string, paymentId: string) {
    const extras = extrasCache.get(userId)
    if (!extras) return
    const booking = extras.bookings.find(b => b.id === bookingId)
    if (!booking) return

    const existingForBooking = extras.payments.filter(p => p.booking_id === bookingId)
    try {
      const { payment, newStatus } = await voidPayment({
        booking,
        existingPayments: existingForBooking,
        paymentId,
      })
      const reverted = newStatus !== booking.status
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        const updatedBookings = cur.bookings.map(b =>
          b.id === bookingId ? { ...b, status: newStatus } : b
        )
        const updatedPayments = cur.payments.map(p => p.id === payment.id ? payment : p)
        next.set(userId, {
          ...cur,
          bookings: updatedBookings,
          payments: updatedPayments,
          paidSum: updatedPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
          pendingSum: updatedPayments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0),
          // A payment change can push the diver into/out of overpayment, which counts as credit.
          openCreditBalance: diverCreditBalance(cur.credits, activeCreditRows(updatedBookings, updatedPayments, cur.amendments)),
        })
        return next
      })
      toast.success(reverted ? 'Payment voided · status reverted to pending' : 'Payment voided')
    } catch (err) {
      toast.error(`Could not void payment: ${errorMessage(err)}`)
      throw err
    }
  }

  const visible = users.filter(u => {
    if (!filter) return true
    const haystack = [u.name, u.nickname, u.contact_id]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(filter.toLowerCase())
  })

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-white">People</h1>
        <span className="text-sm font-medium text-white/80">
          {filter ? `${visible.length} of ${users.length}` : `${users.length}`} account{users.length === 1 ? '' : 's'}
        </span>
      </div>

      <input
        type="text"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Search by name, contact, cert…"
        className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 text-sm focus:outline-none focus:border-brand-900"
      />

      <div className="space-y-2">
        {visible.map(u => (
          <UserCard
            key={u.id}
            user={u}
            allUsers={users}
            onFamilyChanged={refetchAllUsers}
            open={expanded === u.id}
            extras={extrasCache.get(u.id) ?? null}
            loading={extrasLoading === u.id}
            editing={editingId === u.id}
            onToggle={() => toggle(u.id)}
            onEdit={() => setEditingId(u.id)}
            onCancelEdit={() => setEditingId(null)}
            onProfileSaved={() => { refetchUser(u.id); setEditingId(null) }}
            onRecordPayment={(bookingId, amount, note) => handleRecordPayment(u.id, bookingId, amount, note)}
            onVoidPayment={(bookingId, paymentId) => handleVoidPayment(u.id, bookingId, paymentId)}
            onMarkDepositPaid={(bookingId) => handleMarkDepositPaid(u.id, bookingId)}
            onCreateCredit={(amount, reason, bookingId) => handleCreateCredit(u.id, amount, reason, bookingId)}
            onApplyCredit={(bookingId, amount) => handleApplyCredit(u.id, bookingId, amount)}
            onSettleCredit={(creditId, note) => handleSettleCredit(u.id, creditId, note)}
            onReopenCredit={(creditId) => handleReopenCredit(u.id, creditId)}
            onDelete={() => handleDeleteUser(u)}
            isAdmin={isAdmin}
            isSelf={profile?.id === u.id}
          />
        ))}
        {visible.length === 0 && (
          <p className="text-brand-950 font-medium text-sm">No matches.</p>
        )}
      </div>
    </div>
  )
}

function UserCard({
  user, allUsers, onFamilyChanged, open, extras, loading, editing, onToggle, onEdit, onCancelEdit, onProfileSaved,
  onRecordPayment, onVoidPayment, onMarkDepositPaid, onCreateCredit, onApplyCredit, onSettleCredit, onReopenCredit, onDelete, isAdmin, isSelf,
}: {
  user: Profile
  allUsers: Profile[]
  onFamilyChanged: () => void
  open: boolean
  extras: UserExtras | null
  loading: boolean
  editing: boolean
  onToggle: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onProfileSaved: () => void
  onRecordPayment: (bookingId: string, amount: number, note: string) => Promise<void>
  onVoidPayment: (bookingId: string, paymentId: string) => Promise<void>
  onMarkDepositPaid: (bookingId: string) => Promise<void>
  onCreateCredit: (amount: number, reason: string, bookingId: string | null) => Promise<void>
  onApplyCredit: (bookingId: string, amount: number) => Promise<void>
  onSettleCredit: (creditId: string, note: string) => Promise<void>
  onReopenCredit: (creditId: string) => Promise<void>
  onDelete: () => Promise<void>
  isAdmin: boolean
  isSelf: boolean
}) {
  const { user: authUser } = useAuth()
  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl">
      {/* role="button", not a real <button>: text inside a <button> can't be
          selected by click-drag on desktop, so admins couldn't copy a diver's
          name/cert. A div keeps the whole row tappable while leaving the text
          selectable; the onClick guard skips the expand/collapse when the click
          is the tail end of a text selection. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => { if (!window.getSelection()?.toString()) onToggle() }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className="w-full text-left p-3 flex items-start justify-between hover:bg-surface-100 rounded-xl transition-colors cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-brand-900 text-sm">
            {user.name ?? '(unnamed)'}
            {user.nickname && <span className="text-brand-900 font-medium"> ({user.nickname})</span>}
          </p>
          <p className="text-xs text-brand-900 font-medium">
            {user.cert_agency && user.cert_level ? `${user.cert_agency} ${user.cert_level}` : 'Uncertified'}
            {user.logged_dives > 0 && ` · ${user.logged_dives} logged`}
            {user.nitrox_certified && ' · Nitrox'}
            {user.deep_certified && ' · Deep'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full select-none ${
            user.role === 'admin' ? 'bg-accent text-white'
            : user.role === 'staff' ? 'bg-amber-500 text-white'
            : 'bg-brand-900 text-white'
          }`}>
            {user.role}
          </span>
          <span className="text-xs text-brand-950 font-medium select-none">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 border-t border-surface-200 pt-3 space-y-4 text-sm">
          {editing && authUser && isAdmin ? (
            // Reuses the diver-facing form so field validation / save logic /
            // gates (cert + nitrox card requirements) stay in one place. The
            // form saves with .eq('id', profile.id), so as long as the admin
            // RLS policy is in place, this writes through to the target row.
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wider">Editing profile</p>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="text-xs text-brand-700 hover:text-brand-900 underline"
                >
                  Done
                </button>
              </div>
              <ProfileForm
                key={user.id}
                user={authUser}
                profile={user}
                onSaved={onProfileSaved}
              />
            </div>
          ) : (
            <>
              <div className="flex justify-end items-center gap-4">
                {isAdmin && !isSelf && (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="text-xs text-red-700 hover:text-red-900 underline"
                  >
                    Delete user
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={onEdit}
                    className="text-xs text-brand-700 hover:text-brand-900 underline"
                  >
                    Edit profile
                  </button>
                )}
              </div>
              <ProfileDetails user={user} />
              <DiverNotes profileId={user.id} />
              {isAdmin && (
                <AdminFamilyPanel user={user} allUsers={allUsers} onChanged={onFamilyChanged} />
              )}
              {loading && (
                <div className="flex justify-center py-2"><Spinner className="w-5 h-5 border-2 border-brand-900" /></div>
              )}
              {extras && (
                <ExtrasBlock
                  extras={extras}
                  onRecordPayment={onRecordPayment}
                  onVoidPayment={onVoidPayment}
                  onMarkDepositPaid={onMarkDepositPaid}
                  onCreateCredit={onCreateCredit}
                  onApplyCredit={onApplyCredit}
                  onSettleCredit={onSettleCredit}
                  onReopenCredit={onReopenCredit}
                  isAdmin={isAdmin}
                />
              )}
            </>
          )}
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
        <Row k="Email" v={user.email} />
        <Row k="Preferred contact" v={contact} />
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
        <Row k="Deep (40m)" v={user.deep_certified ? 'certified' : 'no'} />
        {user.cert_card_path && <CertCardPreview path={user.cert_card_path} />}
      </Section>

      <Section title="Sizing">
        <Row k="Body + shoe" v={sizing || null} />
      </Section>

      {user.medical_notes && (
        <Section title="Medical notes">
          <p className="text-brand-950 font-medium bg-surface-50 rounded p-2 text-xs whitespace-pre-wrap">{user.medical_notes}</p>
        </Section>
      )}
    </div>
  )
}

function ExtrasBlock({ extras, onRecordPayment, onVoidPayment, onMarkDepositPaid, onCreateCredit, onApplyCredit, onSettleCredit, onReopenCredit, isAdmin }: {
  extras: UserExtras
  onRecordPayment: (bookingId: string, amount: number, note: string) => Promise<void>
  onVoidPayment: (bookingId: string, paymentId: string) => Promise<void>
  onMarkDepositPaid: (bookingId: string) => Promise<void>
  onCreateCredit: (amount: number, reason: string, bookingId: string | null) => Promise<void>
  onApplyCredit: (bookingId: string, amount: number) => Promise<void>
  onSettleCredit: (creditId: string, note: string) => Promise<void>
  onReopenCredit: (creditId: string) => Promise<void>
  isAdmin: boolean
}) {
  const activeBookings = extras.bookings.filter(b => b.status !== 'cancelled')
  // Bookings that still owe money — credit-apply targets for the panel below.
  const applyTargets = activeBookings.map(b => {
    const paid = extras.payments.filter(p => p.booking_id === b.id && p.status === 'paid').reduce((s, p) => s + p.amount, 0)
    const owed = Number((b.details as { total?: number } | undefined)?.total ?? 0) + amendmentsDelta(extras.amendments.get(b.id) ?? [])
    const due = Math.max(0, owed - paid - openCreditForBooking(extras.credits, b.id))
    return { id: b.id, label: b.event?.title ?? '(event)', due }
  }).filter(t => t.due > 0)
  return (
    <div className="space-y-3 pt-2 border-t border-surface-200">
      <Section title="Bookings" defaultOpen>
        {activeBookings.length === 0 ? (
          <p className="text-brand-950 font-medium text-xs">None active.</p>
        ) : (
          <div className="space-y-3">
            {activeBookings.map(b => {
              const bookingPayments = extras.payments.filter(p => p.booking_id === b.id)
              const baseTotal = Number((b.details as { total?: number } | undefined)?.total ?? 0)
              const owed = baseTotal + amendmentsDelta(extras.amendments.get(b.id) ?? [])
              const paid = bookingPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
              const credit = openCreditForBooking(extras.credits, b.id)
              return (
                <div key={b.id} className="space-y-1">
                  <div className="flex items-start justify-between text-xs">
                    <div className="min-w-0">
                      <p className="text-brand-900 truncate">{b.event?.title ?? '(event)'}</p>
                      {b.event && (
                        <p className="text-brand-950 font-medium">{formatEventSpan(b.event, { style: 'compact', withYear: true })}</p>
                      )}
                    </div>
                    <span className={`capitalize shrink-0 ml-2 ${statusColor(b.status)}`}>{b.status}</span>
                  </div>
                  <BookingPaymentsBlock
                    payments={bookingPayments}
                    owed={owed}
                    paid={paid}
                    credit={credit}
                    charges={b.charges}
                    amendments={(extras.amendments.get(b.id) ?? []).map(a => ({ label: a.note, amount: a.amount }))}
                    currency={b.event?.currency ?? siteConfig.locale.currencyLabel}
                    pending={b.status === 'pending'}
                    cancelled={false}
                    readOnly={!isAdmin}
                    onRecord={(amount, note) => onRecordPayment(b.id, amount, note)}
                    onVoid={(paymentId) => onVoidPayment(b.id, paymentId)}
                    onMarkDepositPaid={() => onMarkDepositPaid(b.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Account credits" defaultOpen>
        <CreditsPanel
          credits={extras.credits}
          openBalance={extras.openCreditBalance}
          bookings={extras.bookings}
          applyTargets={applyTargets}
          readOnly={!isAdmin}
          onCreate={onCreateCredit}
          onApply={onApplyCredit}
          onSettle={onSettleCredit}
          onReopen={onReopenCredit}
        />
      </Section>

      <Section title="Totals across all bookings" defaultOpen>
        <div className="flex justify-between text-xs">
          <span className="text-brand-900 font-medium">Paid</span>
          <span className="text-brand-900 font-semibold">{extras.paidSum.toLocaleString()}</span>
        </div>
        {extras.pendingSum > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-brand-900 font-medium">Pending</span>
            <span className="text-red-600">{extras.pendingSum.toLocaleString()}</span>
          </div>
        )}
        {extras.openCreditBalance > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-brand-900 font-medium">Open credit (owed to diver)</span>
            <span className="text-emerald-700 font-semibold">{extras.openCreditBalance.toLocaleString()}</span>
          </div>
        )}
      </Section>
    </div>
  )
}

function CreditsPanel({ credits, openBalance, bookings, applyTargets, readOnly, onCreate, onApply, onSettle, onReopen }: {
  credits: Credit[]
  openBalance: number
  bookings: Array<Booking & { event: AppEvent | null; charges: ChargeLine[] }>
  applyTargets: Array<{ id: string; label: string; due: number }>
  readOnly: boolean
  onCreate: (amount: number, reason: string, bookingId: string | null) => Promise<void>
  onApply: (bookingId: string, amount: number) => Promise<void>
  onSettle: (creditId: string, note: string) => Promise<void>
  onReopen: (creditId: string) => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const [amountStr, setAmountStr] = useState('')
  const [reason, setReason] = useState('')
  const [linkedBooking, setLinkedBooking] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const spendable = openCreditBalance(credits)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = parseInt(amountStr, 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive integer.')
      return
    }
    if (reason.trim().length < 3) {
      setError('Reason is required.')
      return
    }
    setSubmitting(true)
    try {
      await onCreate(amount, reason.trim(), linkedBooking || null)
      setAmountStr(''); setReason(''); setLinkedBooking(''); setShowForm(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSettle(c: Credit) {
    const note = window.prompt(
      `Settle credit of ${Number(c.amount).toLocaleString()} for "${c.reason}"?\n\nNote (e.g. "Refunded via bank transfer" or "Applied to booking #abc"):`,
      ''
    )
    if (note === null) return
    setSettlingId(c.id)
    try { await onSettle(c.id, note.trim()) } finally { setSettlingId(null) }
  }

  async function handleReopen(c: Credit) {
    if (!window.confirm(`Re-open this settled credit (${Number(c.amount).toLocaleString()} — "${c.reason}")?`)) return
    setSettlingId(c.id)
    try { await onReopen(c.id) } finally { setSettlingId(null) }
  }

  return (
    <div className="text-xs space-y-2">
      <div className="flex justify-between">
        <span className="text-brand-900 font-medium">Credit owed (incl. overpayments)</span>
        <span className={`font-semibold ${openBalance > 0 ? 'text-emerald-700' : 'text-brand-900'}`}>
          {openBalance.toLocaleString()}
        </span>
      </div>

      {credits.length === 0 ? (
        <p className="text-brand-950 font-medium italic">No credits on record.</p>
      ) : (
        <ul className="space-y-1 pt-1 border-t border-surface-200">
          {credits.map(c => {
            const linked = c.booking_id ? bookings.find(b => b.id === c.booking_id) : null
            return (
              <li key={c.id} className="flex items-baseline justify-between gap-2">
                <span className="text-brand-950 font-medium flex-1">
                  {format(new Date(c.created_at), 'MMM d')} · {c.reason}
                  {linked?.event && <span className="opacity-70"> (re: {linked.event.title})</span>}
                  {c.status === 'settled' && c.settled_note && (
                    <span className="opacity-70"> · settled: {c.settled_note}</span>
                  )}
                  {c.status === 'settled' && !c.settled_note && (
                    <span className="opacity-70"> · settled</span>
                  )}
                </span>
                {!readOnly && c.status === 'open' && (
                  <button
                    type="button"
                    disabled={settlingId === c.id}
                    onClick={() => handleSettle(c)}
                    className="shrink-0 text-[10px] text-brand-700 hover:text-brand-900 underline disabled:opacity-50"
                  >
                    {settlingId === c.id ? '…' : 'Settle'}
                  </button>
                )}
                {!readOnly && c.status === 'settled' && (
                  <button
                    type="button"
                    disabled={settlingId === c.id}
                    onClick={() => handleReopen(c)}
                    className="shrink-0 text-[10px] text-brand-700 hover:text-brand-900 underline disabled:opacity-50"
                  >
                    {settlingId === c.id ? '…' : 'Re-open'}
                  </button>
                )}
                <span className={`shrink-0 font-semibold ${c.status === 'settled' ? 'text-brand-950 line-through' : 'text-emerald-700'}`}>
                  {Number(c.amount).toLocaleString()}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly && spendable > 0 && applyTargets.length > 0 && (
        <ApplyToBookingForm
          spendable={spendable}
          targets={applyTargets}
          tiedCredit={bookingId => openCreditForBooking(credits, bookingId)}
          onApply={onApply}
        />
      )}

      {!readOnly && (
        <div className="pt-1 border-t border-surface-200">
          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="text-xs text-brand-700 hover:text-brand-900 underline"
            >
              + Issue credit
            </button>
          ) : (
            <form onSubmit={submit} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="number" inputMode="numeric" min={1} step={1}
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  placeholder="Amount"
                  className="w-24 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
                />
                <select
                  value={linkedBooking}
                  onChange={e => setLinkedBooking(e.target.value)}
                  className="flex-1 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
                >
                  <option value="">— no linked booking —</option>
                  {bookings.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.event?.title ?? '(event)'}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Reason (e.g. weather-cancelled Kenting May 15)"
                maxLength={500}
                className="w-full bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="text-xs bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded"
                >
                  {submitting ? 'Issuing…' : 'Issue credit'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setError(null); setAmountStr(''); setReason(''); setLinkedBooking('') }}
                  className="text-xs text-brand-700 hover:text-brand-900 underline"
                >
                  Cancel
                </button>
              </div>
              {error && <p className="text-red-600">{error}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  )
}

function ApplyToBookingForm({ spendable, targets, tiedCredit, onApply }: {
  spendable: number
  targets: Array<{ id: string; label: string; due: number }>
  tiedCredit: (bookingId: string) => number
  onApply: (bookingId: string, amount: number) => Promise<void>
}) {
  const [bookingId, setBookingId] = useState(targets[0]?.id ?? '')
  const target = targets.find(t => t.id === bookingId) ?? targets[0]
  // Spendable here excludes credit already tied to (and offsetting) this same
  // booking — the RPC clamps identically, this just keeps the UI honest.
  const cap = target ? Math.min(target.due, Math.max(0, spendable - tiedCredit(target.id))) : 0
  const [amountStr, setAmountStr] = useState('')
  const [busy, setBusy] = useState(false)
  const amount = Math.min(Math.max(0, parseInt(amountStr || '0', 10) || 0), cap)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!target || amount <= 0) return
    setBusy(true)
    try {
      await onApply(target.id, amount)
      setAmountStr('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="pt-1 border-t border-surface-200 space-y-1.5">
      <p className="text-brand-900 font-medium">Apply credit to a booking</p>
      <div className="flex items-center gap-2">
        <select
          value={bookingId}
          onChange={e => { setBookingId(e.target.value); setAmountStr('') }}
          className="flex-1 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
        >
          {targets.map(t => (
            <option key={t.id} value={t.id}>{t.label} · {t.due.toLocaleString()} due</option>
          ))}
        </select>
        <input
          type="number" inputMode="numeric" min={1} max={cap} step={1}
          value={amountStr}
          onChange={e => setAmountStr(e.target.value)}
          placeholder={cap.toLocaleString()}
          className="w-24 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
        />
        <button
          type="submit"
          disabled={busy || amount <= 0}
          className="text-xs bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded"
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
      <p className="text-brand-950">Up to {cap.toLocaleString()} of {spendable.toLocaleString()} available credit.</p>
    </form>
  )
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group space-y-1">
      <summary className="flex items-center gap-1 cursor-pointer select-none list-none text-xs font-semibold text-brand-700 uppercase tracking-wider [&::-webkit-details-marker]:hidden">
        <span className="text-brand-400 transition-transform group-open:rotate-90">&#9656;</span>
        {title}
      </summary>
      <div className="pl-1 pt-1 space-y-0.5">{children}</div>
    </details>
  )
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null
  return (
    <div className="flex justify-between text-xs">
      <span className="text-brand-900 font-medium">{k}</span>
      <span className="text-brand-900 text-right">{v}</span>
    </div>
  )
}

function labelForMethod(m: NonNullable<Profile['contact_method']>) {
  return m === 'whatsapp' ? 'WhatsApp' : m === 'line' ? 'Line' : m === 'phone' ? 'Phone' : 'Email'
}

function statusColor(s: Booking['status']) {
  return s === 'confirmed' ? 'text-brand-900 font-semibold'
    : s === 'pending'    ? 'text-red-600'
    : s === 'waitlisted' ? 'text-violet-400'
    :                      'text-brand-950 font-medium'
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
        className="w-full rounded-lg border border-surface-200"
      />
    </a>
  )
}
