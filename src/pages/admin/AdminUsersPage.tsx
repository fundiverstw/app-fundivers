import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BTN_XS_PRIMARY, BTN_XS_GHOST, BTN_XS_DANGER } from '../../styles/tokens'
import { siteConfig } from '../../config/site'
import { Spinner } from '../../components/ui/Spinner'
import { format } from 'date-fns'
import { shopZoned, parseIsoDate } from '../../lib/dates'
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
import { contactMethodLabel } from '../../lib/contact-labels'
import { profileGapLabels } from '../../lib/profile-completeness'
import { personName } from '../../lib/names'
import { fetchCreditsForUser, openCreditForBooking, openCreditBalance, diverCreditBalance, createCredit, createAccountCharge, applyCreditToBooking } from '../../lib/credits'
import { netPaid, netPaidByBooking } from '../../lib/payments'
import { buildDiverStatement, type DiverStatement, type StatementLine } from '../../lib/diver-statement'
import { fetchActorNames, actorLabel, type ActorNames } from '../../lib/actor-names'
import { issueTempPassword } from '../../lib/admin-password'
import { ProfileForm } from '../ProfilePage'
import { DiverNotes } from '../../components/admin/DiverNotes'
import { DiverWaivers } from '../../components/admin/DiverWaivers'
import { DiverTermsConsent } from '../../components/admin/DiverTermsConsent'
import { AdminFamilyPanel } from '../../components/admin/AdminFamilyPanel'
import { Disclosure } from '../../components/ui/Disclosure'
import type { AppEvent, Booking, BookingAmendment, BookingDetails, Credit, Payment, Profile } from '../../types/database'
import { t } from '../../i18n'

const us = t.admin.users
const cm = t.admin.completeness

interface UserExtras {
  bookings: Array<Booking & { event: AppEvent | null; charges: ChargeLine[] }>
  payments: Payment[]
  amendments: Map<string, BookingAmendment[]>
  credits: Credit[]
  /** Running-balance history: every charge, payment, credit and cancellation
   *  in order, each with the change it made and the balance after it. */
  statement: DiverStatement
  /** Names for the admins behind those lines. */
  actorNames: ActorNames
  /** Spendable account credit -- what "Apply credit" can actually consume,
   *  which is the statement balance floored per booking. Shown alongside the
   *  statement's closing balance, not instead of it: they differ whenever an
   *  active booking is still underpaid. */
  openCreditBalance: number
}

// Active-booking {owed, paid} rows for diverCreditBalance — owed folds in
// amendments; paid sums the diver's paid payments per booking.
function activeCreditRows(
  bookings: Array<Booking & { event: AppEvent | null }>,
  payments: Payment[],
  amendments: Map<string, BookingAmendment[]>,
): Array<{ id: string; owed: number; paid: number }> {
  const paidByBooking = netPaidByBooking(payments)
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

  // Deep link: /admin/users?diver=<id> opens (and scrolls to) that diver's
  // card. Used by the logistics gear cards so an admin can jump from the
  // day-of view straight to a diver's full account. Runs once the roster has
  // loaded so the target card is in the DOM.
  const [searchParams] = useSearchParams()
  const deepLinkId = searchParams.get('diver')
  useEffect(() => {
    if (!deepLinkId || !users.some(u => u.id === deepLinkId)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(deepLinkId)
    if (!extrasCache.has(deepLinkId)) {
      setExtrasLoading(deepLinkId)
      fetchExtras(deepLinkId).then(extras => {
        setExtrasCache(prev => new Map(prev).set(deepLinkId, extras))
        setExtrasLoading(null)
      })
    }
    document.getElementById(`diver-${deepLinkId}`)?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId, users])

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

    const eventIds = bookings.map(b => b.event_id)
    const [eventMap, amendments, catalog] = await Promise.all([
      eventIds.length
        ? fetchEventsForBookings(eventIds)
        : Promise.resolve(new Map<string, AppEvent>()),
      fetchAmendmentsForBookings(bookings.map(b => b.id)),
      fetchChargeCatalog(bookings.map(b => b.details as BookingDetails)),
    ])

    const hydrated = bookings.map(b => {
      const event = eventMap.get(b.event_id) ?? null
      return {
        ...b,
        event,
        charges: resolveCharges({ details: b.details as BookingDetails, event, ...catalog }),
      }
    })
    const statement = buildDiverStatement({ bookings, payments, credits, amendmentsByBooking: amendments })
    const actorNames = await fetchActorNames([
      ...statement.lines.map(l => l.actorId),
      ...bookings.map(b => b.cancellation_settled_by),
    ])

    return {
      bookings: hydrated,
      payments,
      amendments,
      credits,
      statement,
      actorNames,
      // Account credit = awarded credits + overpayments across active bookings.
      openCreditBalance: diverCreditBalance(credits, activeCreditRows(hydrated, payments, amendments)),
    }
  }

  // Every optimistic update re-derives the same four things from the arrays
  // it just changed, because they are all views of the same data: the running
  // statement, the spendable-credit figure, and the actor names the statement
  // is annotated with. Patching them one at a time is how the old code let a
  // recorded payment update `paidSum` and leave the credit figure stale.
  //
  // The acting admin is folded into the name map: the row they just wrote is
  // attributed to them, and they are not necessarily already in there.
  function withDerived(
    cur: UserExtras,
    changed: Partial<Pick<UserExtras, 'bookings' | 'payments' | 'credits' | 'amendments'>>,
  ): UserExtras {
    const bookings   = changed.bookings   ?? cur.bookings
    const payments   = changed.payments   ?? cur.payments
    const credits    = changed.credits    ?? cur.credits
    const amendments = changed.amendments ?? cur.amendments
    const actorNames = new Map(cur.actorNames)
    if (profile?.id) actorNames.set(profile.id, personName(profile.name, profile.nickname))
    return {
      ...cur,
      bookings, payments, credits, amendments,
      statement: buildDiverStatement({ bookings, payments, credits, amendmentsByBooking: amendments }),
      actorNames,
      openCreditBalance: diverCreditBalance(credits, activeCreditRows(bookings, payments, amendments)),
    }
  }

  async function handleRecordPayment(userId: string, bookingId: string, amount: number, note: string, reference: string) {
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
        amount, note, reference,
        recordedBy: profile.id,
        owed: Number((booking.details as { total?: number } | null)?.total ?? 0)
          + amendmentsDelta(extras.amendments.get(bookingId) ?? []),
      })
      const promoted = newStatus !== booking.status
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        const updatedBookings = cur.bookings.map(b =>
          b.id === bookingId ? { ...b, status: newStatus } : b
        )
        next.set(userId, withDerived(cur, {
          bookings: updatedBookings,
          payments: [payment, ...cur.payments],
        }))
        return next
      })
      toast.success(promoted ? us.paymentRecordedConfirmed : us.paymentRecorded)
    } catch (err) {
      toast.error(us.couldNotRecordPayment(errorMessage(err)))
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
        next.set(userId, withDerived(cur, {
          bookings: cur.bookings.map(b => b.id === bookingId ? { ...b, status: 'confirmed' as const } : b),
        }))
        return next
      })
      toast.success(us.depositMarked)
    } catch (err) {
      toast.error(us.couldNotUpdateStatus(errorMessage(err)))
      throw err
    }
  }

  async function handleApplyCredit(userId: string, bookingId: string, amount: number) {
    try {
      const applied = await applyCreditToBooking({ bookingId, amount })
      const extras = await fetchExtras(userId)
      setExtrasCache(prev => new Map(prev).set(userId, extras))
      toast.success(applied > 0 ? t.payments.applied(applied.toLocaleString()) : t.payments.nothingToApply)
    } catch (err) {
      toast.error(us.couldNotApplyCredit(errorMessage(err)))
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
        next.set(userId, withDerived(cur, { credits: [credit, ...cur.credits] }))
        return next
      })
      toast.success(us.creditIssued(amount.toLocaleString()))
    } catch (err) {
      toast.error(us.couldNotIssueCredit(errorMessage(err)))
      throw err
    }
  }

  // The mirror of issuing credit: a negative row on the same ledger. Kept as
  // its own handler rather than a signed argument to the one above, so neither
  // caller can flip the sign by accident.
  async function handleCreateCharge(userId: string, amount: number, reason: string) {
    if (!profile?.id) return
    try {
      const charge = await createAccountCharge({
        user_id: userId, amount, reason, created_by: profile.id,
      })
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        next.set(userId, withDerived(cur, { credits: [charge, ...cur.credits] }))
        return next
      })
      toast.success(us.chargeIssued(amount.toLocaleString()))
    } catch (err) {
      toast.error(us.couldNotIssueCharge(errorMessage(err)))
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

  async function handleDeleteUser(target: Profile) {
    const name = target.name || target.nickname || target.contact_id || target.id
    const confirmed = window.confirm(us.deleteConfirm(name))
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
      toast.success(us.deletedUser(name))
    } catch (err) {
      toast.error(us.couldNotDelete(errorMessage(err)))
    }
  }

  // Promote/demote a user between diver / staff / admin. The DB already gates
  // this — the `profiles: admin update` policy plus block_self_privileged_profile_change
  // let only an admin change a role. The UI only offers it for OTHER users
  // (never isSelf), so an admin can't demote themselves and the shop can never
  // be left without an admin.
  async function handleChangeRole(target: Profile, newRole: Profile['role']) {
    if (newRole === target.role) return
    const name = target.name || target.nickname || target.contact_id || target.id
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', target.id)
      if (error) throw error
      setUsers(prev => prev.map(u => (u.id === target.id ? { ...u, role: newRole } : u)))
      toast.success(us.roleChanged(name, us.roleNames[newRole]))
    } catch (err) {
      toast.error(us.couldNotChangeRole(errorMessage(err)))
    }
  }

  // Issue a temporary password for a diver and hand the plaintext back to the
  // card so the admin can relay it. The password is generated + set entirely
  // server-side (admin-set-temp-password edge function); we never see or store
  // an existing password. Rethrows so the card can skip revealing on failure.
  async function handleIssueTempPassword(target: Profile): Promise<string> {
    const name = target.name || target.nickname || target.contact_id || target.id
    try {
      const password = await issueTempPassword(target.id)
      toast.success(us.tempPasswordIssued(name))
      return password
    } catch (err) {
      toast.error(us.couldNotIssueTempPassword(errorMessage(err)))
      throw err
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
        owed: Number((booking.details as { total?: number } | null)?.total ?? 0)
          + amendmentsDelta(extras.amendments.get(bookingId) ?? []),
      })
      const reverted = newStatus !== booking.status
      setExtrasCache(prev => {
        const next = new Map(prev)
        const cur = next.get(userId)
        if (!cur) return prev
        const updatedBookings = cur.bookings.map(b =>
          b.id === bookingId ? { ...b, status: newStatus } : b
        )
        next.set(userId, withDerived(cur, {
          bookings: updatedBookings,
          payments: cur.payments.map(p => p.id === payment.id ? payment : p),
        }))
        return next
      })
      toast.success(reverted ? us.paymentVoidedReverted : us.paymentVoided)
    } catch (err) {
      toast.error(us.couldNotVoidPayment(errorMessage(err)))
      throw err
    }
  }

  // No roster is shown until the admin searches — a shop with hundreds of
  // divers doesn't want the whole list dumped on open. A deep-linked diver
  // (?diver=<id>) is the one exception, so the gear-card jump-to still works.
  const query = filter.trim().toLowerCase()
  const searching = query.length > 0
  const visible = users.filter(u => {
    if (deepLinkId && u.id === deepLinkId) return true
    if (!searching) return false
    const haystack = [u.name, u.nickname, u.contact_id]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(query)
  })

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-white">{us.title}</h1>
        <span className="text-sm font-medium text-white/80">
          {searching ? us.accountsFiltered(visible.length, users.length) : us.accountsAll(users.length)}
        </span>
      </div>

      <input
        type="text"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder={us.searchPlaceholder}
        className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 text-sm focus:outline-none focus:border-brand-900"
      />

      <div className="space-y-2">
        {visible.map(u => (
          <div key={u.id} id={`diver-${u.id}`}>
          <UserCard
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
            onRecordPayment={(bookingId, amount, note, reference) => handleRecordPayment(u.id, bookingId, amount, note, reference)}
            onVoidPayment={(bookingId, paymentId) => handleVoidPayment(u.id, bookingId, paymentId)}
            onMarkDepositPaid={(bookingId) => handleMarkDepositPaid(u.id, bookingId)}
            onCreateCredit={(amount, reason, bookingId) => handleCreateCredit(u.id, amount, reason, bookingId)}
            onCreateCharge={(amount, reason) => handleCreateCharge(u.id, amount, reason)}
            onApplyCredit={(bookingId, amount) => handleApplyCredit(u.id, bookingId, amount)}
            onDelete={() => handleDeleteUser(u)}
            onChangeRole={(role) => handleChangeRole(u, role)}
            onIssueTempPassword={() => handleIssueTempPassword(u)}
            isAdmin={isAdmin}
            isSelf={profile?.id === u.id}
          />
          </div>
        ))}
        {visible.length === 0 && (
          <p className="text-brand-950 font-medium text-sm">
            {searching ? us.noMatches : us.searchPrompt}
          </p>
        )}
      </div>
    </div>
  )
}

function UserCard({
  user, allUsers, onFamilyChanged, open, extras, loading, editing, onToggle, onEdit, onCancelEdit, onProfileSaved,
  onRecordPayment, onVoidPayment, onMarkDepositPaid, onCreateCredit, onCreateCharge, onApplyCredit, onDelete, onChangeRole, onIssueTempPassword, isAdmin, isSelf,
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
  onRecordPayment: (bookingId: string, amount: number, note: string, reference: string) => Promise<void>
  onVoidPayment: (bookingId: string, paymentId: string) => Promise<void>
  onMarkDepositPaid: (bookingId: string) => Promise<void>
  onCreateCredit: (amount: number, reason: string, bookingId: string | null) => Promise<void>
  onCreateCharge: (amount: number, reason: string) => Promise<void>
  onApplyCredit: (bookingId: string, amount: number) => Promise<void>
  onDelete: () => Promise<void>
  onChangeRole: (role: Profile['role']) => Promise<void>
  onIssueTempPassword: () => Promise<string>
  isAdmin: boolean
  isSelf: boolean
}) {
  const { user: authUser } = useAuth()
  // The freshly-issued temp password to reveal to the admin, plus per-card
  // action state. Held here (not in the page) so it's scoped to this diver and
  // clears when the card unmounts.
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [copied, setCopied] = useState(false)
  const gaps = profileGapLabels(user)

  async function handleIssue() {
    const name = user.name || user.nickname || user.contact_id || user.id
    if (!window.confirm(us.tempPasswordConfirm(name))) return
    setIssuing(true)
    try {
      const pw = await onIssueTempPassword()
      setTempPassword(pw)
      setCopied(false)
    } catch {
      // The page handler already surfaced the error toast.
    } finally {
      setIssuing(false)
    }
  }
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
            {user.name ?? t.admin.family.unnamed}
            {user.nickname && <span className="text-brand-900 font-medium"> ({user.nickname})</span>}
          </p>
          <p className="text-xs text-brand-900 font-medium">
            {user.cert_agency && user.cert_level ? `${user.cert_agency} ${user.cert_level}` : t.profile.family.uncertified}
            {user.logged_dives > 0 && us.loggedSuffix(user.logged_dives)}
            {user.nitrox_certified && us.nitroxSuffix}
            {user.deep_certified && us.deepSuffix}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {/* Visible while the card is still collapsed, so an admin scanning
              search results can see who needs chasing without opening each. */}
          {gaps.length > 0 && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full select-none bg-amber-100 text-amber-900"
              title={cm.missingList(gaps.join(', '))}
            >
              {cm.incomplete}
            </span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full select-none ${
            user.role === 'admin' ? 'bg-accent text-white'
            : user.role === 'staff' ? 'bg-amber-500 text-white'
            : 'bg-brand-900 text-white'
          }`}>
            {user.role}
          </span>
          <span className="text-lg leading-none text-brand-950 font-medium select-none px-1">{open ? '▲' : '▼'}</span>
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
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wider">{us.editingProfile}</p>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className={BTN_XS_GHOST}
                >
                  {us.done}
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
              <div className="flex flex-wrap justify-end items-center gap-2">
                {isAdmin && (
                  <Link to={`/admin/events?diver=${user.id}`} className={BTN_XS_PRIMARY}>
                    {us.registerForEvent}
                  </Link>
                )}
                {isAdmin && (
                  <button type="button" onClick={onEdit} className={BTN_XS_GHOST}>
                    {us.editProfile}
                  </button>
                )}
                {isAdmin && !isSelf && (
                  <label className="flex items-center gap-1.5 text-xs text-brand-700">
                    {us.roleLabel}
                    <select
                      value={user.role}
                      onChange={e => onChangeRole(e.target.value as Profile['role'])}
                      className="text-xs rounded-lg px-2 py-1 bg-white text-brand-900 border border-surface-300"
                    >
                      <option value="diver">{us.roleNames.diver}</option>
                      <option value="staff">{us.roleNames.staff}</option>
                      <option value="admin">{us.roleNames.admin}</option>
                    </select>
                  </label>
                )}
                {isAdmin && !isSelf && (
                  <button type="button" onClick={handleIssue} disabled={issuing} className={BTN_XS_GHOST}>
                    {issuing ? us.issuing : us.issueTempPassword}
                  </button>
                )}
                {isAdmin && !isSelf && (
                  <button type="button" onClick={onDelete} className={BTN_XS_DANGER}>
                    {us.deleteUser}
                  </button>
                )}
              </div>

              {tempPassword && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-900 uppercase tracking-wider">{us.tempPasswordTitle}</p>
                  <div className="flex items-center gap-2">
                    {/* select-all + selectable so the admin can copy it even if
                        the clipboard API is unavailable. */}
                    <code className="flex-1 select-all font-mono text-sm text-brand-900 bg-white border border-surface-300 rounded px-2 py-1 break-all">
                      {tempPassword}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        try { await navigator.clipboard?.writeText(tempPassword); setCopied(true) }
                        catch { /* clipboard blocked — the admin can still select the text */ }
                      }}
                      className={BTN_XS_GHOST}
                    >
                      {copied ? us.copied : us.copy}
                    </button>
                  </div>
                  <p className="text-xs text-amber-900">{us.tempPasswordHint}</p>
                  <div className="flex justify-end">
                    <button type="button" onClick={() => setTempPassword(null)} className={BTN_XS_GHOST}>
                      {us.dismiss}
                    </button>
                  </div>
                </div>
              )}
              <ProfileDetails user={user} />
              <DiverTermsConsent user={user} />
              {/* The legal name alone, never "Name (nickname)": this string is
                  stored as the signature on the waiver record. */}
              <DiverWaivers
                diverId={user.id}
                diverName={user.name || user.nickname || user.email}
              />
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
                  onCreateCharge={onCreateCharge}
                  onApplyCredit={onApplyCredit}
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

// Sits at the top of the expanded diver, above the sections it summarises, so
// an admin sees at a glance whether anything is outstanding before scrolling
// the field-by-field chips.
function IncompleteBanner({ user }: { user: Profile }) {
  const missing = profileGapLabels(user)
  if (missing.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <p className="text-xs font-semibold text-amber-900 uppercase tracking-wider">{cm.incomplete}</p>
      <p className="text-xs text-amber-900">{cm.missingList(missing.join(', '))}</p>
    </div>
  )
}

function ProfileDetails({ user }: { user: Profile }) {
  const contact = user.contact_method && user.contact_id
    ? `${contactMethodLabel(user.contact_method)}: ${user.contact_id}`
    : null
  const sizing = [
    user.height_cm ? us.heightCm(user.height_cm) : null,
    user.weight_kg ? us.weightKg(user.weight_kg) : null,
    user.shoe_size ? us.shoeSize(shoeAsJp(user.shoe_size) ?? user.shoe_size) : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-3">
      <IncompleteBanner user={user} />

      <Section title={us.secPersonal}>
        <Row k={us.rowEmail} v={user.email} />
        <Row k={us.rowName} v={personName(user.name, user.nickname) || null} required />
        <Row k={us.rowPreferredContact} v={contact} required />
        <Row k={us.rowDob} v={user.date_of_birth ? format(parseIsoDate(user.date_of_birth), 'MMM d, yyyy') : null} required />
        <Row k={us.rowNationality} v={user.nationality} required />
        <Row k={us.rowIdPassport} v={user.id_number} />
        <Row k={us.rowGender} v={user.gender} required />
      </Section>

      <Section title={us.secEmergency}>
        <Row k={us.rowName} v={user.emergency_contact_name} />
        <Row k={us.rowPhone} v={user.emergency_contact_phone} />
      </Section>

      <Section title={t.profile.certification}>
        {/* Not required of a diver who ticked "not certified yet" — for them
            the blank is the answer, not a gap. */}
        <Row
          k={us.rowAgencyLevel}
          v={user.cert_level ? `${user.cert_agency ?? ''} ${user.cert_level}`.trim() : null}
          required={!user.uncertified}
        />
        <Row k={us.rowLoggedDives} v={String(user.logged_dives ?? 0)} />
        <Row k={us.rowLastDive} v={user.last_dive_date ? format(parseIsoDate(user.last_dive_date), 'MMM d, yyyy') : null} />
        <Row k={us.rowNitrox} v={user.nitrox_certified ? us.certifiedYes : us.certifiedNo} />
        <Row k={us.rowDeep} v={user.deep_certified ? us.certifiedYes : us.certifiedNo} />
        {user.cert_card_path && <CertCardPreview path={user.cert_card_path} />}
      </Section>

      <Section title={us.secSizing}>
        <Row k={us.rowBodyShoe} v={sizing || null} />
      </Section>

      {user.medical_notes && (
        <Section title={us.secMedicalNotes}>
          <p className="text-brand-950 font-medium bg-surface-50 rounded p-2 text-xs whitespace-pre-wrap">{user.medical_notes}</p>
        </Section>
      )}
    </div>
  )
}

function ExtrasBlock({ extras, onRecordPayment, onVoidPayment, onMarkDepositPaid, onCreateCredit, onCreateCharge, onApplyCredit, isAdmin }: {
  extras: UserExtras
  onRecordPayment: (bookingId: string, amount: number, note: string, reference: string) => Promise<void>
  onVoidPayment: (bookingId: string, paymentId: string) => Promise<void>
  onMarkDepositPaid: (bookingId: string) => Promise<void>
  onCreateCredit: (amount: number, reason: string, bookingId: string | null) => Promise<void>
  onCreateCharge: (amount: number, reason: string) => Promise<void>
  onApplyCredit: (bookingId: string, amount: number) => Promise<void>
  isAdmin: boolean
}) {
  const activeBookings = extras.bookings.filter(b => b.status !== 'cancelled')
  // Bookings that still owe money — credit-apply targets for the panel below.
  const applyTargets = activeBookings.map(b => {
    const paid = netPaid(extras.payments.filter(p => p.booking_id === b.id))
    const owed = Number((b.details as { total?: number } | undefined)?.total ?? 0) + amendmentsDelta(extras.amendments.get(b.id) ?? [])
    const due = Math.max(0, owed - paid - openCreditForBooking(extras.credits, b.id))
    return { id: b.id, label: b.event?.title ?? t.payments.eventFallback, due }
  }).filter(tg => tg.due > 0)
  return (
    <div className="space-y-3 pt-2 border-t border-surface-200">
      <Section title={us.secBookings}>
        {activeBookings.length === 0 ? (
          <p className="text-brand-950 font-medium text-xs">{us.noneActive}</p>
        ) : (
          <div className="space-y-3">
            {activeBookings.map(b => {
              const bookingPayments = extras.payments.filter(p => p.booking_id === b.id)
              const baseTotal = Number((b.details as { total?: number } | undefined)?.total ?? 0)
              const owed = baseTotal + amendmentsDelta(extras.amendments.get(b.id) ?? [])
              const paid = netPaid(bookingPayments)
              const credit = openCreditForBooking(extras.credits, b.id)
              return (
                <div key={b.id} className="space-y-1">
                  <div className="flex items-start justify-between text-xs">
                    <div className="min-w-0">
                      {b.event ? (
                        <Link
                          to={`/admin/events/${b.event.id}`}
                          className="block text-brand-900 hover:text-brand-700 underline truncate"
                        >
                          {b.event.title}
                        </Link>
                      ) : (
                        <p className="text-brand-900 truncate">{t.payments.eventFallback}</p>
                      )}
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
                    actorName={(id: string | null) => actorLabel(extras.actorNames, id, t.admin.actor)}
                    onRecord={(amount, note, reference) => onRecordPayment(b.id, amount, note, reference)}
                    onVoid={(paymentId) => onVoidPayment(b.id, paymentId)}
                    onMarkDepositPaid={() => onMarkDepositPaid(b.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title={us.secBalance} defaultOpen>
        <BalancePanel
          statement={extras.statement}
          spendable={extras.openCreditBalance}
          credits={extras.credits}
          bookings={extras.bookings}
          actorNames={extras.actorNames}
          applyTargets={applyTargets}
          readOnly={!isAdmin}
          onCreate={onCreateCredit}
          onCharge={onCreateCharge}
          onApply={onApplyCredit}
        />
      </Section>
    </div>
  )
}

const money = (n: number) => Math.abs(Math.round(n)).toLocaleString()
const signed = (n: number) => `${n < 0 ? '-' : '+'}${money(n)}`

/**
 * Balance, and the history that produced it.
 *
 * These were two sections -- "Account credits" and "Totals across all
 * bookings" -- which is why nobody could reconcile them: one showed credit
 * owed, the other showed money paid, and the arithmetic tying them together
 * existed nowhere on screen. One section now, read like a bank statement.
 *
 * TWO figures, deliberately, because they answer different questions:
 *
 *   Balance    where the diver stands overall. Free to be negative -- a diver
 *              who owes money has a negative balance, and hiding that is what
 *              made the old "Account credits: 0" so uninformative.
 *   Spendable  what "Apply credit" can actually consume today. Floored per
 *              booking, so a shortfall on one booking cannot be lent to
 *              another. Only shown when it differs from the balance, which is
 *              exactly when the difference matters.
 */
function BalancePanel({ statement, spendable, credits, bookings, actorNames, applyTargets, readOnly, onCreate, onCharge, onApply }: {
  statement: DiverStatement
  spendable: number
  credits: Credit[]
  bookings: Array<Booking & { event: AppEvent | null; charges: ChargeLine[] }>
  actorNames: ActorNames
  applyTargets: Array<{ id: string; label: string; due: number }>
  readOnly: boolean
  onCreate: (amount: number, reason: string, bookingId: string | null) => Promise<void>
  onCharge: (amount: number, reason: string) => Promise<void>
  onApply: (bookingId: string, amount: number) => Promise<void>
}) {
  const { balance, totals } = statement
  const state = balance > 0 ? 'credit' : balance < 0 ? 'owed' : 'settled'
  const eventTitle = (bookingId: string | null): string | null =>
    bookingId ? bookings.find(b => b.id === bookingId)?.event?.title ?? null : null

  return (
    <div className="text-xs space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-brand-900 font-medium">
          {state === 'credit' ? us.balanceCredit : state === 'owed' ? us.balanceOwed : us.balanceSettled}
        </span>
        <span className={`font-semibold text-sm tabular-nums ${
          state === 'credit' ? 'text-emerald-700' : state === 'owed' ? 'text-red-600' : 'text-brand-900'
        }`}>
          {state === 'settled' ? '0' : money(balance)}
        </span>
      </div>
      <p className="text-brand-950">{us.balanceExplainer}</p>

      <dl className="grid grid-cols-3 gap-2 pt-1 border-t border-surface-200">
        <div>
          <dt className="text-brand-900 font-medium opacity-70">{us.totalCharged}</dt>
          <dd className="text-brand-900 font-semibold tabular-nums">{money(totals.charged)}</dd>
        </div>
        <div>
          <dt className="text-brand-900 font-medium opacity-70">{t.payments.paid}</dt>
          <dd className="text-brand-900 font-semibold tabular-nums">{money(totals.paid)}</dd>
        </div>
        <div>
          <dt className="text-brand-900 font-medium opacity-70">{us.totalOpenCredit}</dt>
          <dd className="text-brand-900 font-semibold tabular-nums">{money(totals.openCredit)}</dd>
        </div>
      </dl>

      {spendable !== balance && (
        <div className="pt-1 border-t border-surface-200 space-y-0.5">
          <div className="flex justify-between">
            <span className="text-brand-900 font-medium">{us.spendableCredit}</span>
            <span className="text-emerald-700 font-semibold tabular-nums">{money(spendable)}</span>
          </div>
          <p className="text-brand-950">{us.spendableNote}</p>
        </div>
      )}

      <StatementList
        lines={statement.lines}
        actorNames={actorNames}
        eventTitle={eventTitle}
      />

      <LedgerActions
        credits={credits}
        spendable={spendable}
        bookings={bookings}
        applyTargets={applyTargets}
        readOnly={readOnly}
        onCreate={onCreate}
        onCharge={onCharge}
        onApply={onApply}
      />
    </div>
  )
}

const KIND_LABEL: Record<StatementLine['kind'], string> = us.statementKinds

/** One statement line: what happened, who did it, the change, the balance
 *  after. Read-only by design — nothing here can be edited or reversed in
 *  place. Correcting a balance means issuing the opposite row, which leaves
 *  both halves on the record instead of quietly rewriting one. */
function StatementList({ lines, actorNames, eventTitle }: {
  lines: StatementLine[]
  actorNames: ActorNames
  eventTitle: (bookingId: string | null) => string | null
}) {
  if (lines.length === 0) {
    return <p className="text-brand-950 font-medium italic pt-1 border-t border-surface-200">{us.statementEmpty}</p>
  }

  return (
    <div className="pt-1 border-t border-surface-200 space-y-1">
      <div className="flex justify-between text-brand-900 font-medium opacity-70">
        <span>{us.statementHeading}</span>
        <span className="flex gap-3">
          <span className="w-16 text-right">{us.colChange}</span>
          <span className="w-16 text-right">{us.colBalance}</span>
        </span>
      </div>
      <ul className="space-y-1">
        {[...lines].reverse().map(l => {
          const title = eventTitle(l.bookingId)
          return (
            <li key={l.id} className="flex items-baseline justify-between gap-2">
              <span className={`flex-1 min-w-0 ${l.inert ? 'text-brand-950 opacity-60' : 'text-brand-950 font-medium'}`}>
                {format(shopZoned(new Date(l.at)), 'MMM d')} · {KIND_LABEL[l.kind]}
                {title && <span className="opacity-70">{us.reEvent(title)}</span>}
                {l.approximateDate && <span className="opacity-70"> · {us.approxDate}</span>}
                <span className="block opacity-70 font-normal break-words">
                  {l.note ? `${l.note} · ` : ''}
                  {l.reference ? `${t.admin.bookingPayments.refShort(l.reference)} · ` : ''}
                  {t.admin.actor.by(actorLabel(actorNames, l.actorId, t.admin.actor))}
                </span>
              </span>
              <span className={`shrink-0 w-16 text-right tabular-nums font-semibold ${
                l.inert ? 'text-brand-950 opacity-60' : l.delta < 0 ? 'text-red-600' : 'text-emerald-700'
              }`}>
                {l.inert ? us.noMoneyMoved : signed(l.delta)}
              </span>
              <span className={`shrink-0 w-16 text-right tabular-nums ${
                l.balance < 0 ? 'text-red-600' : 'text-brand-900'
              }`}>
                {l.balance < 0 ? `-${money(l.balance)}` : money(l.balance)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The three things an admin can do to a diver's ledger: spend credit they
 * already hold against an unpaid booking, hand them credit, or charge them.
 *
 * Issuing and charging are the same form with the sign flipped, and both
 * REQUIRE a reason — an unexplained movement on someone's balance is the thing
 * nobody can answer questions about six weeks later. A charge takes no booking:
 * a charge against a specific trip is a balance adjustment on the event page,
 * where it belongs to that booking's total.
 */
function LedgerActions({ credits, spendable, bookings, applyTargets, readOnly, onCreate, onCharge, onApply }: {
  credits: Credit[]
  spendable: number
  bookings: Array<Booking & { event: AppEvent | null; charges: ChargeLine[] }>
  applyTargets: Array<{ id: string; label: string; due: number }>
  readOnly: boolean
  onCreate: (amount: number, reason: string, bookingId: string | null) => Promise<void>
  onCharge: (amount: number, reason: string) => Promise<void>
  onApply: (bookingId: string, amount: number) => Promise<void>
}) {
  const [form, setForm] = useState<'credit' | 'charge' | null>(null)
  const pool = openCreditBalance(credits)

  if (readOnly) return null

  return (
    <div className="space-y-2">
      {pool > 0 && applyTargets.length > 0 && (
        <ApplyToBookingForm
          spendable={spendable}
          targets={applyTargets}
          tiedCredit={bookingId => openCreditForBooking(credits, bookingId)}
          onApply={onApply}
        />
      )}

      <div className="pt-1 border-t border-surface-200">
        {form === null ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setForm('credit')} className={BTN_XS_GHOST}>
              {us.issueCreditLink}
            </button>
            <button type="button" onClick={() => setForm('charge')} className={BTN_XS_GHOST}>
              {us.issueChargeLink}
            </button>
          </div>
        ) : (
          <LedgerEntryForm
            kind={form}
            bookings={bookings}
            onCancel={() => setForm(null)}
            onSubmit={async (amount, reason, bookingId) => {
              if (form === 'charge') await onCharge(amount, reason)
              else await onCreate(amount, reason, bookingId)
              setForm(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

function LedgerEntryForm({ kind, bookings, onCancel, onSubmit }: {
  kind: 'credit' | 'charge'
  bookings: Array<Booking & { event: AppEvent | null; charges: ChargeLine[] }>
  onCancel: () => void
  onSubmit: (amount: number, reason: string, bookingId: string | null) => Promise<void>
}) {
  const [amountStr, setAmountStr] = useState('')
  const [reason, setReason] = useState('')
  const [linkedBooking, setLinkedBooking] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isCharge = kind === 'charge'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = parseInt(amountStr, 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t.admin.bookingPayments.amountMustBePositive)
      return
    }
    if (reason.trim().length < 3) {
      setError(isCharge ? us.chargeReasonRequired : us.reasonRequired)
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(amount, reason.trim(), linkedBooking || null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="number" inputMode="numeric" min={1} step={1}
          value={amountStr}
          onChange={e => setAmountStr(e.target.value)}
          placeholder={us.amountPlaceholder}
          aria-label={us.amountPlaceholder}
          className="w-24 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
        />
        {/* A credit can offset one booking's balance; a charge never can --
            see LedgerActions. */}
        {!isCharge && (
          <select
            value={linkedBooking}
            onChange={e => setLinkedBooking(e.target.value)}
            className="flex-1 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
          >
            <option value="">{us.noLinkedBooking}</option>
            {bookings.map(b => (
              <option key={b.id} value={b.id}>
                {b.event?.title ?? t.payments.eventFallback}
              </option>
            ))}
          </select>
        )}
      </div>
      {/* Validated in `submit` rather than with `required`, so the message
          names which field and reads like the amount check beside it. */}
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder={isCharge ? us.chargeReasonPlaceholder : us.creditReasonPlaceholder}
        aria-label={isCharge ? us.chargeReasonPlaceholder : us.creditReasonPlaceholder}
        maxLength={500}
        className="w-full bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded"
        >
          {submitting
            ? (isCharge ? us.charging : us.issuing)
            : (isCharge ? us.issueCharge : us.issueCredit)}
        </button>
        <button type="button" onClick={onCancel} className={BTN_XS_GHOST}>
          {t.admin.catalog.cancel}
        </button>
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </form>
  )
}

function ApplyToBookingForm({ spendable, targets, tiedCredit, onApply }: {
  spendable: number
  targets: Array<{ id: string; label: string; due: number }>
  tiedCredit: (bookingId: string) => number
  onApply: (bookingId: string, amount: number) => Promise<void>
}) {
  const [bookingId, setBookingId] = useState(targets[0]?.id ?? '')
  const target = targets.find(tg => tg.id === bookingId) ?? targets[0]
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
      <p className="text-brand-900 font-medium">{us.applyToBooking}</p>
      <div className="flex items-center gap-2">
        <select
          value={bookingId}
          onChange={e => { setBookingId(e.target.value); setAmountStr('') }}
          className="flex-1 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
        >
          {targets.map(tg => (
            <option key={tg.id} value={tg.id}>{us.dueOption(tg.label, tg.due.toLocaleString())}</option>
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
          {busy ? t.payments.applying : us.apply}
        </button>
      </div>
      <p className="text-brand-950">{us.upToOf(cap.toLocaleString(), spendable.toLocaleString())}</p>
    </form>
  )
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <Disclosure title={title} defaultOpen={defaultOpen} bodyClassName="pl-1 pt-1 space-y-0.5">
      {children}
    </Disclosure>
  )
}

// An empty optional field is nothing to say, so the row stays hidden. An empty
// *required* one is the opposite — it's the thing the admin needs to see, and
// hiding it is what made "Profile incomplete" a riddle. Those rows render with
// a Missing chip in place of the value.
function Row({ k, v, required }: { k: string; v: string | null | undefined; required?: boolean }) {
  if (!v && !required) return null
  return (
    <div className="flex justify-between text-xs gap-3">
      <span className="text-brand-900 font-medium">{k}</span>
      {v
        ? <span className="text-brand-900 text-right">{v}</span>
        : <span className="shrink-0 font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">{cm.missing}</span>}
    </div>
  )
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
        alt={us.certCardAlt}
        className="w-full rounded-lg border border-surface-200"
      />
    </a>
  )
}
