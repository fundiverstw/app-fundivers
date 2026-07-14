import { useEffect, useState } from 'react'
import { siteConfig } from '../../config/site'
import { PageLoading } from '../../components/ui/Spinner'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchEventsForBookings, formatEventSpan } from '../../lib/events'
import { notifyRefundApproved } from '../../lib/refunds'
import { AdminNotes } from '../../components/admin/AdminNotes'
import { AdminAddDiverModal } from '../../components/admin/AdminAddDiverModal'
import { EventStaffSection } from '../../components/admin/EventStaffSection'
import { RegisterForm } from '../../components/register/RegisterForm'
import { shoeAsJp } from '../../lib/shoe-size'
import { uniqueUuids } from '../../lib/uuid'
import { notifyEventCancelled } from '../../lib/event-cancellation'
import { issueCancellationCredits, applyCreditToBooking } from '../../lib/credits'
import { fetchAmendmentsForBookings, addAmendment, formAmount, amendmentsDelta } from '../../lib/booking-amendments'
import { recordPayment as recordPaymentRow, voidPayment as voidPaymentRow, recordGroupPayment } from '../../lib/booking-payments'
import { personName } from '../../lib/names'
import { requestEventDiverExport } from '../../lib/admin-event-export'
import { BookingPaymentsBlock } from '../../components/admin/BookingPaymentsBlock'
import { resolveCharges, type ChargeLine } from '../../lib/booking-charges'
import { openCreditForBooking } from '../../lib/credits'
import { bookingBalance } from '../../lib/booking-balance'
import { netPaid } from '../../lib/payments'
import { EventTransportPanel } from '../../components/admin/EventTransportPanel'
import { missingWaivers, fetchEventWaiverOverrides, fetchSignaturesForDivers, fetchWaivers } from '../../lib/waivers'
import type { WaiverDef } from '../../config/waivers'
import { ShareEventButton } from '../../components/ShareEventButton'
import type { AppEvent, Booking, BookingAmendment, BookingDetails, Credit, DiverNote, Payment, Profile } from '../../types/database'
import { BTN_SECONDARY, ERROR_NOTE_LIGHT } from '../../styles/tokens'
import { t } from '../../i18n'

const ed = t.admin.eventDetail
const us = t.admin.users

interface Registrant {
  booking: Booking
  profile: Profile | null
  payments: Payment[]
  amendments: BookingAmendment[]
  diverNotes: DiverNote[]
  charges: ChargeLine[]
  /** Open (unsettled) credit awarded to this diver for this event. */
  credit: number
  /** Diver's open account credit NOT already tied to this booking — the
   *  pool spendable against this booking's balance. */
  spendable: number
  /** Display name of the lead booker paying for this booking, when someone
   *  other than the diver covers it. Null when the diver pays their own. */
  payerName: string | null
}

type AddonNameMap = Map<string, string>
type RoomNameMap = Map<string, string>

export function AdminEventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const toast = useToast()
  const isAdmin = profile?.role === 'admin'
  const [event, setEvent] = useState<AppEvent | null>(null)
  const [registrants, setRegistrants] = useState<Registrant[]>([])
  // Waivers each registrant still needs for this event, keyed by diver id.
  // `waiverState` gates the badge so an unresolved/failed lookup never renders a
  // false "Waivers OK".
  const [missingByDiver, setMissingByDiver] = useState<Record<string, WaiverDef[]>>({})
  const [waiverState, setWaiverState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [addonNames, setAddonNames] = useState<AddonNameMap>(new Map())
  const [roomNames, setRoomNames] = useState<RoomNameMap>(new Map())
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Registrant | null>(null)
  const [addDiverOpen, setAddDiverOpen] = useState(false)
  // ?diver=<id> deep link (from the Create-diver page) auto-opens the add-diver
  // modal preselected to that diver. Captured once, then the param is consumed
  // so a refresh — or a later manual "Add diver" — starts from a clean picker.
  const [searchParams, setSearchParams] = useSearchParams()
  const [preselectDiverId, setPreselectDiverId] = useState<string | null>(() => searchParams.get('diver'))
  useEffect(() => {
    if (searchParams.get('diver')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAddDiverOpen(true)
      setSearchParams(prev => { prev.delete('diver'); return prev }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [refreshKey, setRefreshKey] = useState(0)
  // Cancel-event flow state. The modal opens on click; the actual update
  // runs only after the admin confirms in the modal.
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelInFlight, setCancelInFlight] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [notifyModalOpen, setNotifyModalOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  // Delete-event flow state. Only surfaced after the event is cancelled
  // so admins can't accidentally hard-delete an active event. The actual
  // DELETE relies on the existing ON DELETE CASCADE FKs to clean up
  // bookings, payments, memos, amendments, duties, junctions, etc.
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteInFlight, setDeleteInFlight] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [view, setView] = useState<'registrants' | 'transportation' | 'balances'>('registrants')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      // Event info via helper
      const eventMap = await fetchEventsForBookings([id])
      if (cancelled) return
      const ev = eventMap.get(id) ?? null
      setEvent(ev)

      // Bookings on this event
      const { data: bookings } = await supabase
        .from('bookings')
        .select('*')
        .eq('event_id', id)
        .order('created_at')

      if (cancelled) return
      if (!bookings?.length) { setRegistrants([]); setLoading(false); return }

      const userIds = [...new Set(bookings.flatMap(b => [b.user_id, b.payer_id]).filter((x): x is string => !!x))]
      const bookingIds = bookings.map(b => b.id)

      const [profilesRes, paymentsRes, amendmentsByBooking, diverNotesRes, creditsRes] = await Promise.all([
        supabase.from('profiles').select('*').in('id', userIds),
        supabase.from('payments').select('*').in('booking_id', bookingIds),
        fetchAmendmentsForBookings(bookingIds),
        supabase.from('diver_notes').select('*').in('profile_id', userIds).order('created_at', { ascending: false }),
        supabase.from('credits').select('*').in('user_id', userIds).eq('status', 'open'),
      ])
      if (cancelled) return

      // Every open credit row for these divers (event-tied or general), so we
      // can both offset this event's balance and size the spendable pool.
      const credits = (creditsRes.data ?? []) as Credit[]
      const profileMap = new Map((profilesRes.data ?? []).map(p => [p.id, p]))
      const diverNotesByUser = new Map<string, DiverNote[]>()
      for (const n of diverNotesRes.data ?? []) {
        const arr = diverNotesByUser.get(n.profile_id) ?? []
        arr.push(n)
        diverNotesByUser.set(n.profile_id, arr)
      }
      const paymentsByBooking = new Map<string, Payment[]>()
      for (const p of paymentsRes.data ?? []) {
        if (!p.booking_id) continue
        const arr = paymentsByBooking.get(p.booking_id) ?? []
        arr.push(p)
        paymentsByBooking.set(p.booking_id, arr)
      }

      // Resolve any add-on / room IDs referenced in the bookings to display
      // names so the admin doesn't see raw UUIDs.
      const addonIds = uniqueUuids(bookings.flatMap(b => (b.details as BookingDetails).add_ons ?? []))
      const roomIds = uniqueUuids(bookings.map(b => (b.details as BookingDetails).room?.option_id))
      const [addonRes, roomRes] = await Promise.all([
        addonIds.length
          ? supabase.from('addons').select('id, display_title, admin_title, price').in('id', addonIds)
          : Promise.resolve({ data: [] as { id: string; display_title: string | null; admin_title: string | null; price: number | null }[] }),
        roomIds.length
          ? supabase.from('rooms').select('id, display_title, admin_title, added_price').in('id', roomIds)
          : Promise.resolve({ data: [] as { id: string; display_title: string | null; admin_title: string | null; added_price: number | null }[] }),
      ])
      if (cancelled) return
      const addonNameMap = new Map((addonRes.data ?? []).map(a => [a.id, a.display_title || a.admin_title || a.id]))
      const roomNameMap = new Map((roomRes.data ?? []).map(r => [r.id, r.display_title || r.admin_title || r.id]))
      setAddonNames(addonNameMap)
      setRoomNames(roomNameMap)

      // Price maps drive the display-time recompute for bookings created before
      // the itemized charge snapshot existed (see resolveCharges).
      const addonPrices = new Map((addonRes.data ?? []).map(a => [a.id, { label: addonNameMap.get(a.id) ?? a.id, amount: a.price ?? 0 }]))
      const roomPrices = new Map((roomRes.data ?? []).map(r => [r.id, { label: roomNameMap.get(r.id) ?? r.id, amount: r.added_price ?? 0 }]))

      setRegistrants(bookings.map(b => ({
        booking: b,
        profile: profileMap.get(b.user_id) ?? null,
        payments: paymentsByBooking.get(b.id) ?? [],
        amendments: amendmentsByBooking.get(b.id) ?? [],
        diverNotes: diverNotesByUser.get(b.user_id) ?? [],
        charges: resolveCharges({ details: b.details as BookingDetails, event: ev, roomPrices, addonPrices }),
        credit: openCreditForBooking(credits, b.id),
        spendable: credits
          .filter(c => c.user_id === b.user_id && c.booking_id !== b.id)
          .reduce((s, c) => s + Number(c.amount), 0),
        payerName: (b.payer_id && b.payer_id !== b.user_id)
          ? (personName(profileMap.get(b.payer_id)?.name, profileMap.get(b.payer_id)?.nickname) || t.admin.logistics.leadBooker)
          : null,
      })))
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [id, refreshKey])

  // Flag, per registrant, the waivers they haven't signed for this event. Staff
  // can read all signatures, so one batched query covers the whole roster. Kept
  // above the loading/not-found early returns to satisfy the rules of hooks.
  const diverIdsKey = registrants.map(r => r.booking.user_id).join(',')
  useEffect(() => {
    if (!event || !diverIdsKey) return
    let cancelled = false
    ;(async () => {
      try {
        const diverIds = [...new Set(diverIdsKey.split(','))]
        const [overrides, sigs, waivers] = await Promise.all([
          fetchEventWaiverOverrides(event.type === 'dive' ? { dive_id: event.id } : { course_id: event.id }),
          fetchSignaturesForDivers(diverIds),
          fetchWaivers(),
        ])
        const now = new Date()
        const ref = { id: event.id, type: event.type, title: event.title }
        const map: Record<string, WaiverDef[]> = {}
        for (const did of diverIds) {
          map[did] = missingWaivers(ref, overrides, sigs.filter(s => s.diver_id === did), now, waivers)
        }
        if (!cancelled) { setMissingByDiver(map); setWaiverState('ready') }
      } catch {
        // Don't leave the roster showing a green "Waivers OK" we never verified —
        // a read failure must read as unknown, not as covered.
        if (!cancelled) setWaiverState('error')
      }
    })()
    return () => { cancelled = true }
  }, [event, diverIdsKey])

  async function updateStatus(bookingId: string, newStatus: Booking['status']) {
    await supabase.from('bookings').update({ status: newStatus }).eq('id', bookingId)
    setRegistrants(prev => prev.map(r =>
      r.booking.id === bookingId ? { ...r, booking: { ...r.booking, status: newStatus } } : r
    ))
  }

  // Revert a lead-paid booking back to the diver paying their own share. The
  // already-recorded payments stay on the booking (the money was applied to
  // this diver's event); only future responsibility changes.
  async function billToDiver(bookingId: string) {
    await supabase.from('bookings').update({ payer_id: null }).eq('id', bookingId)
    setRegistrants(prev => prev.map(r =>
      r.booking.id === bookingId
        ? { ...r, booking: { ...r.booking, payer_id: null }, payerName: null }
        : r
    ))
  }

  // Record one lump payment from the lead booker, distributed across the
  // group's bookings (deposits first, then balances). Refetch to reflect the
  // new payment rows + any auto-confirmed siblings.
  async function recordGroupPaymentFor(leadId: string, groupId: string | null, amount: number) {
    const applied = await recordGroupPayment({ leadId, amount, groupId })
    if (applied > 0) toast.success(ed.recordedAcrossGroup(applied.toLocaleString()))
    else toast.info(ed.nothingOutstanding)
    setRefreshKey(k => k + 1)
  }

  async function approveRefund(bookingId: string) {
    // Processing the actual refund happens off-app (bank transfer etc.);
    // admin approval just marks the booking cancelled.
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    // Fire-and-forget diver notification (in-app inbox + push); a push failure
    // must not undo the approval above.
    void notifyRefundApproved(bookingId).catch(() => {})
    setRegistrants(prev => prev.map(r =>
      r.booking.id === bookingId ? { ...r, booking: { ...r.booking, status: 'cancelled' } } : r
    ))
  }

  async function submitAmendment(bookingId: string, sign: '+' | '-', amount: number, note: string) {
    if (!profile?.id) return
    try {
      const row = await addAmendment({
        bookingId,
        signedAmount: formAmount(sign, amount),
        note,
        createdBy: profile.id,
      })
      setRegistrants(prev => prev.map(r =>
        r.booking.id === bookingId ? { ...r, amendments: [...r.amendments, row] } : r
      ))
      toast.success(ed.amendmentAdded)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function recordPayment(r: Registrant, amount: number, note: string) {
    if (!profile?.id) return
    try {
      const { payment, newStatus } = await recordPaymentRow({
        booking: r.booking,
        existingPayments: r.payments,
        amount, note,
        recordedBy: profile.id,
      })
      const promoted = newStatus !== r.booking.status
      setRegistrants(prev => prev.map(x =>
        x.booking.id === r.booking.id
          ? { ...x, payments: [...x.payments, payment], booking: { ...x.booking, status: newStatus } }
          : x
      ))
      toast.success(promoted ? us.paymentRecordedConfirmed : us.paymentRecorded)
    } catch (err) {
      toast.error(us.couldNotRecordPayment(errorMessage(err)))
    }
  }

  async function applyCredit(r: Registrant, amount: number) {
    try {
      const applied = await applyCreditToBooking({ bookingId: r.booking.id, amount })
      if (applied > 0) {
        toast.success(ed.appliedCredit(event?.currency ?? siteConfig.locale.currencyLabel, applied.toLocaleString()))
        // Credit-apply settles/splits credit rows and inserts a payment in one
        // round-trip; reload rather than mirror that locally.
        setRefreshKey(k => k + 1)
      } else {
        toast.info(t.payments.nothingToApply)
      }
    } catch (err) {
      toast.error(us.couldNotApplyCredit(errorMessage(err)))
    }
  }

  async function voidPayment(r: Registrant, paymentId: string) {
    try {
      const { payment, newStatus } = await voidPaymentRow({
        booking: r.booking,
        existingPayments: r.payments,
        paymentId,
      })
      const reverted = newStatus !== r.booking.status
      setRegistrants(prev => prev.map(x =>
        x.booking.id === r.booking.id
          ? {
              ...x,
              payments: x.payments.map(p => p.id === payment.id ? payment : p),
              booking: { ...x.booking, status: newStatus },
            }
          : x
      ))
      toast.success(reverted ? us.paymentVoidedReverted : us.paymentVoided)
    } catch (err) {
      toast.error(us.couldNotVoidPayment(errorMessage(err)))
    }
  }

  async function setCancelledAt(value: string | null) {
    if (!id || !event) return
    setCancelInFlight(true)
    setCancelError(null)
    try {
      const { error } = await supabase
        .from('events')
        .update({ cancelled_at: value } as never)
        .eq('id', id)
      if (error) throw error
      setEvent(prev => (prev ? { ...prev, cancelled_at: value } : prev))
      setCancelModalOpen(false)
      // Notify registrants on cancel only (not restore) — email + in-app +
      // push, best-effort so a notification failure never blocks the cancel.
      if (value) notifyEventCancelled(id, event.type).catch(() => { /* best-effort */ })
      toast.success(value ? ed.eventCancelled : ed.eventRestored)
      // Auto-credit each registrant what they've paid. The cancel already
      // committed, so a failure here can't un-cancel it — surface it instead
      // so the admin knows to issue the credits by hand on the Users page.
      if (value && event && profile?.id) {
        try {
          const { issued, totalAmount } = await issueCancellationCredits({ event, createdBy: profile.id })
          if (issued > 0) {
            toast.success(ed.creditedDivers(issued, event.currency, totalAmount.toLocaleString()))
          }
        } catch (err) {
          toast.error(ed.autoCreditFailed(errorMessage(err)))
        }
      }
    } catch (err) {
      const msg = errorMessage(err)
      setCancelError(msg)
      toast.error(value ? ed.couldNotCancelEvent(msg) : ed.couldNotRestoreEvent(msg))
    } finally {
      setCancelInFlight(false)
    }
  }

  async function deleteEvent() {
    if (!id) return
    setDeleteInFlight(true)
    setDeleteError(null)
    try {
      const { error } = await supabase.from('events').delete().eq('id', id)
      if (error) throw error
      toast.success(ed.eventDeleted)
      navigate('/admin/events')
    } catch (err) {
      const msg = errorMessage(err)
      setDeleteError(msg)
      toast.error(ed.couldNotDeleteEvent(msg))
    } finally {
      setDeleteInFlight(false)
    }
  }

  if (loading) {
    return <PageLoading />
  }

  // Cancelled bookings drop out of the roster and every headcount — a diver who
  // cancelled (or cancelled then re-registered, leaving a stale cancelled row)
  // isn't attending. They stay reachable in a collapsed disclosure so an admin
  // can still restore one via its status dropdown.
  const activeRegistrants = registrants.filter(r => r.booking.status !== 'cancelled')
  const cancelledRegistrants = registrants.filter(r => r.booking.status === 'cancelled')

  const renderRegistrant = (r: Registrant) => (
    <RegistrantCard
      key={r.booking.id}
      r={r}
      waiverMissing={missingByDiver[r.booking.user_id] ?? []}
      waiverState={waiverState}
      addonNames={addonNames}
      roomNames={roomNames}
      currency={event?.currency ?? siteConfig.locale.currencyLabel}
      onStatusChange={updateStatus}
      onApproveRefund={approveRefund}
      onEdit={() => setEditing(r)}
      onAddAmendment={submitAmendment}
      onRecordPayment={(amount, note) => recordPayment(r, amount, note)}
      onApplyCredit={(amount) => applyCredit(r, amount)}
      onVoidPayment={(paymentId) => voidPayment(r, paymentId)}
      onMarkDepositPaid={() => updateStatus(r.booking.id, 'confirmed')}
      onBillToDiver={() => billToDiver(r.booking.id)}
      onRecordGroupPayment={(amount) =>
        recordGroupPaymentFor(r.booking.payer_id ?? r.booking.user_id, r.booking.group_id, amount)}
      readOnly={!isAdmin}
    />
  )

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to="/admin/events" className="text-sm text-white/70 hover:text-white">{ed.backToEvents}</Link>

      <header className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4">
        <h1 className="text-xl font-bold text-brand-900">{event?.title ?? ed.eventNotFound}</h1>
        {event && (
          <p className="text-sm text-brand-900 font-medium mt-1">
            {formatEventSpan(event, { style: 'long' })}
            {' · '}
            <span className="capitalize">{event.type}</span>
            {event.price != null && ed.fromPrice(event.currency, event.price.toLocaleString())}
          </p>
        )}
        <p className="text-sm text-red-600 mt-2">{ed.registrantCount(activeRegistrants.length)}</p>
        {event?.cancelled_at && (
          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-red-700 bg-red-50 border border-accent rounded px-2 py-1 inline-block">
            {ed.cancelledOn(format(new Date(event.cancelled_at), 'MMM d, yyyy'))}
          </p>
        )}
      </header>

      {event && id && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setAddDiverOpen(true)}
                  className="text-xs bg-emerald-900/60 hover:bg-emerald-900 text-white px-3 py-1 rounded-lg"
                >
                  {ed.addDiver}
                </button>
                <Link
                  to={`/admin/events/${id}/edit`}
                  className="text-xs bg-brand-900/60 hover:bg-brand-900 text-white px-3 py-1 rounded-lg"
                >
                  {t.admin.catalog.edit}
                </Link>
                <button
                  type="button"
                  onClick={() => { setCancelError(null); setCancelModalOpen(true) }}
                  className="text-xs bg-red-900/60 hover:bg-red-900 text-white px-3 py-1 rounded-lg"
                >
                  {event?.cancelled_at ? ed.restoreEvent : ed.cancelEvent}
                </button>
                {event?.cancelled_at && (
                  <button
                    type="button"
                    onClick={() => { setDeleteError(null); setDeleteModalOpen(true) }}
                    className="text-xs bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg"
                  >
                    {ed.deleteEvent}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNotifyModalOpen(true)}
                  className="text-xs bg-amber-700/80 hover:bg-amber-700 text-white px-3 py-1 rounded-lg"
                >
                  {ed.notifyDivers}
                </button>
                <button
                  type="button"
                  onClick={() => setExportModalOpen(true)}
                  className="text-xs bg-surface-700/80 hover:bg-surface-700 text-white px-3 py-1 rounded-lg"
                >
                  {ed.exportDiverInfo}
                </button>
              </>
            )}
            <Link
              to={`/admin/events/${id}/gear-map`}
              className="text-xs bg-surface-900/50 hover:bg-surface-900 text-surface-200 px-3 py-1 rounded-lg"
            >
              {ed.gearMap}
            </Link>
            <ShareEventButton eventId={id} className="text-xs bg-surface-700/80 hover:bg-surface-700 text-white px-3 py-1 rounded-lg" />
          </div>
          {event && (
            <EventStaffSection
              eventType={event.type}
              eventId={id}
              eventStartDate={event.start_time}
              eventEndDate={event.end_time}
              nonAdminDiverCount={activeRegistrants.length}
              readOnly={!isAdmin}
            />
          )}
          <AdminNotes target={{ kind: event.type, id }} title={ed.memos} />
        </>
      )}

      {event && (
        <>
          {/* Tabs are available even before anyone registers — an admin needs
              to assign cars and set transport info on a fresh event (the
              registration ride-gate depends on cars being assigned first). */}
          <nav role="tablist" aria-label={ed.sectionsAria} className="flex gap-2">
            <TabButton active={view === 'registrants'} onClick={() => setView('registrants')}>
              {ed.tabRegistrants(activeRegistrants.length)}
            </TabButton>
            <TabButton active={view === 'transportation'} onClick={() => setView('transportation')}>
              {t.bookings.breakdown.transportation}
            </TabButton>
            <TabButton active={view === 'balances'} onClick={() => setView('balances')}>
              {ed.tabAmountOwed}
            </TabButton>
          </nav>

          {view === 'registrants' && (
            <section className="space-y-2">
              {registrants.length === 0 ? (
                <p className="text-brand-950 font-medium text-sm">{ed.noneRegistered}</p>
              ) : activeRegistrants.length === 0 ? (
                <p className="text-brand-950 font-medium text-sm">{ed.allCancelled}</p>
              ) : (
                activeRegistrants.map(renderRegistrant)
              )}
              {cancelledRegistrants.length > 0 && (
                <details className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl px-4 py-2">
                  <summary className="text-sm font-medium text-brand-950/70 cursor-pointer select-none">
                    {ed.cancelledCount(cancelledRegistrants.length)}
                  </summary>
                  <div className="space-y-2 pt-2">
                    {cancelledRegistrants.map(renderRegistrant)}
                  </div>
                </details>
              )}
            </section>
          )}

          {view === 'transportation' && event && (
            <EventTransportPanel
              event={event}
              registrants={registrants}
              isAdmin={isAdmin}
              createdBy={profile?.id ?? null}
              onRideChanged={(bookingId, details) => setRegistrants(prev => prev.map(r =>
                r.booking.id === bookingId ? { ...r, booking: { ...r.booking, details } } : r,
              ))}
            />
          )}

          {view === 'balances' && (
            <BalancesView registrants={activeRegistrants} currency={event?.currency ?? siteConfig.locale.currencyLabel} />
          )}
        </>
      )}

      {editing && event && (
        <RegisterForm
          event={event}
          profile={editing.profile}
          userId={editing.booking.user_id}
          existingBooking={editing.booking}
          onClose={() => setEditing(null)}
          onBooked={updated => {
            const b = updated as Booking
            setRegistrants(prev => prev.map(r =>
              r.booking.id === b.id ? { ...r, booking: b } : r
            ))
            setEditing(null)
          }}
        />
      )}

      {addDiverOpen && event && (
        <AdminAddDiverModal
          event={event}
          initialDiverId={preselectDiverId ?? undefined}
          onClose={() => { setAddDiverOpen(false); setPreselectDiverId(null) }}
          onAdded={() => {
            toast.success(ed.diverRegistered)
            setPreselectDiverId(null)
            setRefreshKey(k => k + 1)
          }}
        />
      )}

      {cancelModalOpen && (
        <CancelEventModal
          alreadyCancelled={!!event?.cancelled_at}
          activeBookingCount={registrants.filter(r => r.booking.status !== 'cancelled').length}
          inFlight={cancelInFlight}
          error={cancelError}
          onClose={() => setCancelModalOpen(false)}
          onConfirm={() => setCancelledAt(event?.cancelled_at ? null : new Date().toISOString())}
        />
      )}

      {deleteModalOpen && event && (
        <DeleteEventModal
          eventTitle={event.title}
          bookingCount={registrants.length}
          inFlight={deleteInFlight}
          error={deleteError}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={deleteEvent}
        />
      )}

      {notifyModalOpen && id && event && (
        <NotifyDiversModal
          eventTitle={event.title}
          eventId={id}
          eventType={event.type}
          confirmedCount={registrants.filter(r => r.booking.status === 'confirmed').length}
          onClose={() => setNotifyModalOpen(false)}
          onSent={summary => {
            toast.success(summary)
            setNotifyModalOpen(false)
          }}
        />
      )}

      {exportModalOpen && id && event && (
        <ExportManifestModal
          eventType={event.type}
          eventId={id}
          onClose={() => setExportModalOpen(false)}
          onDone={summary => {
            toast.success(summary)
            setExportModalOpen(false)
          }}
          onError={msg => toast.error(msg)}
        />
      )}
    </div>
  )
}

function CancelEventModal({
  alreadyCancelled, activeBookingCount, inFlight, error, onClose, onConfirm,
}: {
  alreadyCancelled: boolean
  activeBookingCount: number
  inFlight: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-event-title"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3">
        <h2 id="cancel-event-title" className="text-lg font-bold text-brand-900">
          {alreadyCancelled ? ed.restoreTitle : ed.cancelTitle}
        </h2>
        {alreadyCancelled ? (
          <p className="text-sm text-brand-900">{ed.restoreBody}</p>
        ) : (
          <>
            <p className="text-sm text-brand-900">{ed.cancelBody}</p>
            {activeBookingCount > 0 && (
              <p className="text-sm font-semibold text-red-700 bg-red-50 border border-accent rounded px-3 py-2">
                {ed.activeBookingsWarn(activeBookingCount)}
              </p>
            )}
          </>
        )}
        {error && (
          <p className={ERROR_NOTE_LIGHT}>{error}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={inFlight}
            className={`flex-1 ${BTN_SECONDARY}`}
          >
            {ed.back}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={inFlight}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${
              alreadyCancelled
                ? 'bg-brand-900 hover:bg-brand-950'
                : 'bg-red-700 hover:bg-red-800'
            }`}
          >
            {inFlight
              ? (alreadyCancelled ? ed.restoring : ed.cancelling)
              : (alreadyCancelled ? ed.restoreEvent : ed.cancelEvent)}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteEventModal({
  eventTitle, bookingCount, inFlight, error, onClose, onConfirm,
}: {
  eventTitle: string
  bookingCount: number
  inFlight: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === eventTitle.trim()
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-event-title"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3">
        <h2 id="delete-event-title" className="text-lg font-bold text-red-700">
          {ed.deleteTitle}
        </h2>
        <p className="text-sm text-brand-900">
          {ed.deleteBody}<strong>{ed.deleteBodyStrong}</strong>
        </p>
        {bookingCount > 0 && (
          <p className="text-sm font-semibold text-red-700 bg-red-50 border border-accent rounded px-3 py-2">
            {ed.deleteBookingsWarn(bookingCount)}
          </p>
        )}
        <label className="block text-xs text-brand-900 font-medium">
          {ed.typeToConfirmPrefix}<span className="font-mono text-red-700">{eventTitle}</span>{ed.typeToConfirmSuffix}
          <input
            type="text"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            disabled={inFlight}
            autoFocus
            className="mt-1 w-full bg-white border border-surface-300 rounded-lg px-2 py-2 text-sm text-brand-900 focus:outline-none focus:border-red-700"
          />
        </label>
        {error && (
          <p className={ERROR_NOTE_LIGHT}>{error}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={inFlight}
            className={`flex-1 ${BTN_SECONDARY}`}
          >
            {ed.back}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={inFlight || !matches}
            className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50"
          >
            {inFlight ? ed.deleting : ed.deleteForever}
          </button>
        </div>
      </div>
    </div>
  )
}

function NotifyDiversModal({
  eventTitle, eventId, eventType, confirmedCount, onClose, onSent,
}: {
  eventTitle: string
  eventId: string
  eventType: 'dive' | 'course'
  confirmedCount: number
  onClose: () => void
  onSent: (summary: string) => void
}) {
  const [status, setStatus] = useState<'on' | 'cancelled'>('on')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const headerPreview = status === 'on'
    ? ed.pushHeaderOn(eventTitle)
    : ed.pushHeaderCancelled(eventTitle)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!body.trim()) {
      setError(ed.bodyRequired)
      return
    }
    const workerUrl = ((import.meta.env.VITE_PUSH_WORKER_URL as string | undefined) ?? '').replace(/\/$/, '')
    if (!workerUrl) {
      setError(ed.pushWorkerMissing)
      return
    }
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error(ed.notSignedIn)
      const res = await fetch(`${workerUrl}/admin-event-broadcast`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          event_id:   eventId,
          event_type: eventType,
          status,
          body:       body.trim(),
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || ed.notifyFailed(res.status))
      }
      const result = await res.json() as { sent?: number; skipped?: number; recipients?: number }
      const sent = result.sent ?? 0
      const recipients = result.recipients ?? 0
      onSent(ed.notifiedSummary(recipients, sent))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notify-divers-title"
      onClick={onClose}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 id="notify-divers-title" className="text-lg font-bold text-brand-900">
          {ed.notifyTitle}
        </h2>
        <p className="text-sm text-brand-900">{ed.notifyBlurb(confirmedCount)}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-brand-900">{ed.statusLabel}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStatus('on')}
                className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg border ${
                  status === 'on'
                    ? 'bg-brand-900 text-white border-brand-900'
                    : 'bg-white text-brand-900 border-surface-300 hover:bg-surface-50'
                }`}
              >
                {ed.onAsScheduled}
              </button>
              <button
                type="button"
                onClick={() => setStatus('cancelled')}
                className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg border ${
                  status === 'cancelled'
                    ? 'bg-red-700 text-white border-red-700'
                    : 'bg-white text-brand-900 border-surface-300 hover:bg-surface-50'
                }`}
              >
                {ed.cancelledCaps}
              </button>
            </div>
            <p className="text-[11px] text-brand-900/70 pt-1">
              {ed.pushTitlePrefix}<span className="font-medium">{headerPreview}</span>
            </p>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-brand-900">{ed.noteLabel}</span>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={ed.notePlaceholder}
              rows={5}
              maxLength={1000}
              className="w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900 resize-none"
            />
          </label>

          {error && (
            <p className={ERROR_NOTE_LIGHT}>{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={`flex-1 ${BTN_SECONDARY}`}
            >
              {ed.back}
            </button>
            <button
              type="submit"
              disabled={submitting || confirmedCount === 0}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${
                status === 'cancelled'
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-brand-900 hover:bg-brand-950'
              }`}
            >
              {submitting ? ed.sending : ed.sendTo(confirmedCount)}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Boat-manifest defaults come from the shop config (business.boatManifest); the
// chartered vessel varies per trip, so the admin's last-used values override
// them from localStorage. Notes are shop-authored and never translated.
const BOAT_MANIFEST_LS_KEY = 'fd_boat_manifest_v1'
const DEFAULT_BOAT_MANIFEST = {
  boatName: siteConfig.business.boatManifest.boatName,
  registration: siteConfig.business.boatManifest.registration,
  notes: siteConfig.business.boatManifest.notes.join('\n'),
}

function loadBoatManifestDefaults(): { boatName: string; registration: string; notes: string } {
  try {
    const raw = localStorage.getItem(BOAT_MANIFEST_LS_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<typeof DEFAULT_BOAT_MANIFEST>
      return {
        boatName:     typeof v.boatName === 'string' ? v.boatName : DEFAULT_BOAT_MANIFEST.boatName,
        registration: typeof v.registration === 'string' ? v.registration : DEFAULT_BOAT_MANIFEST.registration,
        notes:        typeof v.notes === 'string' ? v.notes : DEFAULT_BOAT_MANIFEST.notes,
      }
    }
  } catch { /* corrupt / unavailable storage — fall back to defaults */ }
  return { ...DEFAULT_BOAT_MANIFEST }
}

function ExportManifestModal({
  eventType, eventId, onClose, onDone, onError,
}: {
  eventType: 'dive' | 'course'
  eventId: string
  onClose: () => void
  onDone: (summary: string) => void
  onError: (message: string) => void
}) {
  const initial = loadBoatManifestDefaults()
  const [boatName, setBoatName] = useState(initial.boatName)
  const [registration, setRegistration] = useState(initial.registration)
  const [notes, setNotes] = useState(initial.notes)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      try {
        localStorage.setItem(BOAT_MANIFEST_LS_KEY, JSON.stringify({ boatName, registration, notes }))
      } catch { /* non-fatal: just won't remember next time */ }
      const res = await requestEventDiverExport(eventType, eventId, {
        boat_name: boatName.trim(),
        registration: registration.trim(),
        notes: notes.split('\n').map(n => n.trim()).filter(Boolean),
      })
      const staffPart = res.staff_count ? ed.staffSuffix(res.staff_count) : ''
      onDone(ed.manifestEmailed(res.diver_count, staffPart))
    } catch (err) {
      onError(ed.exportFailed(errorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-manifest-title"
      onClick={onClose}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 id="export-manifest-title" className="text-lg font-bold text-brand-900">
          {ed.exportTitle}
        </h2>
        <p className="text-sm text-brand-900">{ed.exportBlurb}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <label className="flex-1 space-y-1">
              <span className="text-xs font-medium text-brand-900">{ed.boatName}</span>
              <input
                type="text"
                value={boatName}
                onChange={e => setBoatName(e.target.value)}
                className="w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
              />
            </label>
            <label className="flex-1 space-y-1">
              <span className="text-xs font-medium text-brand-900">{ed.registration}</span>
              <input
                type="text"
                value={registration}
                onChange={e => setRegistration(e.target.value)}
                className="w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-brand-900">{ed.footerNotes}</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={6}
              className="w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900 resize-none"
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={`flex-1 ${BTN_SECONDARY}`}
            >
              {ed.back}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-brand-900 hover:bg-brand-950 disabled:opacity-50"
            >
              {submitting ? ed.exporting : ed.exportAndEmail}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const BOOKING_STATUSES: Booking['status'][] = ['pending', 'confirmed', 'waitlisted', 'cancelled']

/** Record one lump payment from the lead booker, distributed across their
 *  whole group (deposits first, then balances). Shown only on the lead's own
 *  booking so it's offered exactly once per group. */
function GroupPaymentInline({ currency, onRecord }: {
  currency: string
  onRecord: (amount: number) => Promise<void>
}) {
  const [amountStr, setAmountStr] = useState('')
  const [busy, setBusy] = useState(false)
  const amount = Math.max(0, parseInt(amountStr || '0', 10) || 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (amount <= 0) return
    setBusy(true)
    try {
      await onRecord(amount)
      setAmountStr('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-violet-50 border border-violet-200 rounded p-2 space-y-1.5">
      <p className="text-xs font-semibold text-violet-900">{ed.recordGroupPayment}</p>
      <p className="text-[11px] text-violet-800">{ed.groupBlurb}</p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-violet-900 font-medium">{currency}</span>
        <input
          type="number" inputMode="numeric" min={1} step={1}
          value={amountStr}
          onChange={e => setAmountStr(e.target.value)}
          placeholder={ed.amountReceived}
          className="flex-1 bg-white border border-violet-300 rounded px-2 py-1 text-xs text-brand-900"
        />
        <button
          type="submit"
          disabled={busy || amount <= 0}
          className="text-xs bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded shrink-0"
        >
          {busy ? t.admin.bookingPayments.recording : ed.record}
        </button>
      </div>
    </form>
  )
}

function ApplyCreditInline({ cap, spendable, currency, onApply }: {
  cap: number
  spendable: number
  currency: string
  onApply: (amount: number) => Promise<void>
}) {
  const [amountStr, setAmountStr] = useState(String(cap))
  const [busy, setBusy] = useState(false)
  const amount = Math.min(Math.max(0, parseInt(amountStr || '0', 10) || 0), cap)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (amount <= 0) return
    setBusy(true)
    try { await onApply(amount) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="bg-emerald-50 border border-emerald-300 rounded p-2 space-y-1.5">
      <p className="text-xs text-emerald-900">
        {ed.creditBlurb(currency, spendable.toLocaleString(), cap.toLocaleString())}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-brand-950 font-medium">{currency}</span>
        <input
          type="number" inputMode="numeric" min={1} max={cap} step={1}
          value={amountStr}
          onChange={e => setAmountStr(e.target.value)}
          className="w-24 bg-white border border-emerald-300 rounded px-2 py-1 text-xs text-brand-900"
        />
        <button
          type="submit"
          disabled={busy || amount <= 0}
          className="text-xs bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded"
        >
          {busy ? t.payments.applying : ed.applyCredit}
        </button>
      </div>
    </form>
  )
}

/** What a registrant owes for this event: total + amendments, net of paid
 *  payments and any open event credit. Shared by the registrant card and the
 *  Balances summary so the figure is computed in exactly one place. */
function registrantBalance(r: Registrant) {
  const owed = Number((r.booking.details as { total?: number } | undefined)?.total ?? 0)
    + amendmentsDelta(r.amendments)
  const paid = netPaid(r.payments)
  return { owed, paid, bal: bookingBalance(owed, paid, r.credit, { cancelled: r.booking.status === 'cancelled' }) }
}

function RegistrantCard({ r, waiverMissing, waiverState, addonNames, roomNames, currency, onStatusChange, onApproveRefund, onEdit, onAddAmendment, onRecordPayment, onApplyCredit, onVoidPayment, onMarkDepositPaid, onBillToDiver, onRecordGroupPayment, readOnly }: {
  r: Registrant
  waiverMissing: WaiverDef[]
  waiverState: 'loading' | 'ready' | 'error'
  addonNames: AddonNameMap
  roomNames: RoomNameMap
  currency: string
  onStatusChange: (id: string, s: Booking['status']) => void
  onApproveRefund: (id: string) => void
  onEdit: () => void
  onAddAmendment: (id: string, sign: '+' | '-', amount: number, note: string) => Promise<void>
  onRecordPayment: (amount: number, note: string) => Promise<void>
  onApplyCredit: (amount: number) => Promise<void>
  onVoidPayment: (paymentId: string) => Promise<void>
  onMarkDepositPaid: () => Promise<void>
  onBillToDiver: () => Promise<void>
  onRecordGroupPayment: (amount: number) => Promise<void>
  readOnly?: boolean
}) {
  // payer_id set to someone else → this diver is covered by a lead booker.
  // payer_id set to themselves → this is the lead's own booking (the place to
  // record one group payment for everyone they cover).
  const coveredByLead = !!r.payerName
  const isLeadOwn = !!r.booking.payer_id && r.booking.payer_id === r.booking.user_id
  const [expanded, setExpanded] = useState(false)

  // Balance nets open credit-for-this-event against what's owed. 'overpaid' is
  // kept distinct from 'credit' so a plain overpayment is never mislabelled as
  // an awarded account credit.
  const { owed: adjusted, paid: totalPaid, bal } = registrantBalance(r)
  const paymentStatus = bal.state === 'due'
    ? (totalPaid === 0 && r.credit === 0 ? 'none' : 'partial')
    : bal.state

  const statusStyles: Record<string, string> = {
    confirmed:  'text-brand-900 font-semibold',
    pending:    'text-red-600',
    cancelled:  'text-brand-950 font-medium line-through',
    waitlisted: 'text-violet-400',
  }
  const payStyles: Record<string, string> = {
    settled: 'text-brand-900 font-semibold',
    partial: 'text-red-600',
    credit:  'text-emerald-700 font-semibold',
    none:    'text-brand-950 font-medium',
  }

  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-lg overflow-hidden">
      {/* Dense single-line row when collapsed: caret + name + status + payment.
          Cert / sizing / contact info moved to the expanded block so the
          scroll-length stays short on mobile. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v) }
        }}
        aria-expanded={expanded}
        className="w-full text-left flex items-center gap-2 px-3 py-2 cursor-pointer focus:outline-none"
      >
        <span aria-hidden="true" className="text-xs text-brand-950 font-medium shrink-0">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="flex-1 min-w-0 text-sm truncate">
          {/* Names stay selectable for copy/paste; clicking one places a
              caret rather than toggling the card (stopPropagation). */}
          <span
            className="text-brand-900 font-medium select-text cursor-text"
            onClick={e => e.stopPropagation()}
          >
            {r.profile?.name ?? t.admin.transport.noProfile}
          </span>
          {r.profile?.nickname && (
            <span
              className="text-brand-900/80 font-medium select-text cursor-text"
              onClick={e => e.stopPropagation()}
            >
              {' '}({r.profile.nickname})
            </span>
          )}
          {r.diverNotes.length > 0 && (
            <span className="ml-2 text-xs font-semibold text-red-700">
              {ed.diverNoteCount(r.diverNotes.length)}
            </span>
          )}
          {waiverState === 'loading' ? null
            : waiverState === 'error' ? (
              <span className="ml-2 text-xs font-semibold text-amber-700">{ed.waiversUnknown}</span>
            ) : waiverMissing.length > 0 ? (
              <span
                className="ml-2 text-xs font-semibold text-red-700"
                title={waiverMissing.map(w => w.title).join(', ')}
              >
                {ed.missingWaivers(waiverMissing.map(w => w.title).join(', '))}
              </span>
            ) : (
              <span className="ml-2 text-xs font-semibold text-emerald-700">{ed.waiversOk}</span>
            )}
          {coveredByLead && (
            <span className="ml-2 text-xs font-semibold text-violet-700">{ed.paidBy(r.payerName!)}</span>
          )}
          {isLeadOwn && (
            <span className="ml-2 text-xs font-semibold text-violet-700">{ed.leadPayer}</span>
          )}
        </span>
        <span className="shrink-0 flex items-center gap-1.5">
          {/* Wrapped in a click-stopper so opening the select doesn't collapse/expand the card. */}
          {readOnly ? (
            <span className={`bg-white border border-surface-300 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${statusStyles[r.booking.status]}`}>
              {r.booking.status}
            </span>
          ) : (
            <span onClick={e => e.stopPropagation()}>
              <select
                value={r.booking.status}
                onChange={e => onStatusChange(r.booking.id, e.target.value as Booking['status'])}
                className={`bg-white border border-surface-300 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${statusStyles[r.booking.status]}`}
              >
                {BOOKING_STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </span>
          )}
          <span className={`${payStyles[paymentStatus]} text-xs font-medium whitespace-nowrap`}>
            {paymentStatus === 'settled'  && (totalPaid > 0 ? ed.paidAmount(totalPaid.toLocaleString()) : ed.settled)}
            {paymentStatus === 'partial'  && ed.dueAmount(bal.amount.toLocaleString())}
            {paymentStatus === 'credit'   && ed.creditAmount(bal.amount.toLocaleString())}
            {paymentStatus === 'none'     && ed.unpaid}
          </span>
        </span>
      </div>

      {expanded && (
        <div className="border-t border-surface-200 px-3 pb-3 pt-2 space-y-2">
          {r.profile && (
            <div className="space-y-1">
              {(r.profile.cert_agency || r.profile.cert_level || r.profile.nitrox_certified || r.profile.deep_certified) && (
                <p className="text-xs text-brand-900 font-medium select-text">
                  {r.profile.cert_agency && r.profile.cert_level && `${r.profile.cert_agency} ${r.profile.cert_level}`}
                  {r.profile.nitrox_certified && us.nitroxSuffix}
                  {r.profile.deep_certified && us.deepSuffix}
                </p>
              )}
              {/* Decorative emoji are select-none so a drag-select copies the
                  clean value; the contact id is select-all for one-click copy. */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-brand-900 font-medium select-text">
                {r.profile.contact_method && r.profile.contact_id && (
                  <span>
                    <span aria-hidden="true" className="select-none">{methodEmoji(r.profile.contact_method)} </span>
                    <span className="select-all">{r.profile.contact_id}</span>
                  </span>
                )}
                {r.profile.logged_dives > 0 && (
                  <span><span aria-hidden="true" className="select-none">📖 </span>{ed.loggedDives(r.profile.logged_dives)}</span>
                )}
                {r.profile.height_cm && r.profile.weight_kg && (
                  <span><span aria-hidden="true" className="select-none">📏 </span>{r.profile.height_cm}cm / {r.profile.weight_kg}kg</span>
                )}
                {r.profile.shoe_size && (
                  <span><span aria-hidden="true" className="select-none">👟 </span>{shoeAsJp(r.profile.shoe_size) ?? r.profile.shoe_size}</span>
                )}
              </div>
            </div>
          )}

          {renderDetails(r.booking.details, { addonNames, roomNames }) && (
            <div className="text-xs text-brand-950 font-medium bg-surface-50 rounded p-2 space-y-1">
              {renderDetails(r.booking.details, { addonNames, roomNames })}
            </div>
          )}

          {r.diverNotes.length > 0 && (
            <div className="text-xs bg-rose-50 border border-rose-300 rounded p-2 space-y-1">
              <p className="font-semibold text-red-700 uppercase tracking-wider">{ed.diverNotesHeading}</p>
              {r.diverNotes.map(n => (
                <p key={n.id} className="text-brand-950 font-medium whitespace-pre-wrap">{n.content}</p>
              ))}
            </div>
          )}

          {r.booking.refund_requested_at && r.booking.status !== 'cancelled' && (
            <div className="flex items-center justify-between text-xs bg-red-50 border border-accent rounded p-2">
              <span className="text-red-600">
                🔄 {ed.refundRequested(format(new Date(r.booking.refund_requested_at), 'MMM d, HH:mm'))}
              </span>
              {!readOnly && (
                <button
                  onClick={() => onApproveRefund(r.booking.id)}
                  className="bg-brand-900 hover:bg-brand-950 text-white text-xs font-semibold px-2 py-1 rounded"
                >
                  {ed.approveRefund}
                </button>
              )}
            </div>
          )}

          {r.booking.notes && (
            <p className="text-xs text-brand-950 font-medium bg-surface-50 rounded p-2 select-text">
              <span aria-hidden="true" className="select-none">📝 </span>{r.booking.notes}
            </p>
          )}

          <BookingPaymentsBlock
            payments={r.payments}
            owed={adjusted}
            paid={totalPaid}
            credit={r.credit}
            charges={r.charges}
            amendments={r.amendments.map(a => ({ label: a.note, amount: a.amount }))}
            currency={currency}
            payerNote={coveredByLead ? ed.paidBy(r.payerName!) : (isLeadOwn ? ed.leadPayerForGroup : undefined)}
            pending={r.booking.status === 'pending'}
            cancelled={r.booking.status === 'cancelled'}
            readOnly={!!readOnly}
            onRecord={onRecordPayment}
            onVoid={onVoidPayment}
            onMarkDepositPaid={onMarkDepositPaid}
          />

          {!readOnly && coveredByLead && r.booking.status !== 'cancelled' && (
            <button
              type="button"
              onClick={onBillToDiver}
              className="w-full text-xs bg-violet-50 border border-violet-300 hover:bg-violet-100 text-violet-800 font-semibold px-3 py-1.5 rounded"
            >
              {ed.billToDiver}
            </button>
          )}

          {!readOnly && isLeadOwn && r.booking.status !== 'cancelled' && (
            <GroupPaymentInline currency={currency} onRecord={onRecordGroupPayment} />
          )}

          {!readOnly && r.booking.status !== 'cancelled' && r.spendable > 0 && bal.state === 'due' && (
            <ApplyCreditInline
              cap={Math.min(bal.amount, r.spendable)}
              spendable={r.spendable}
              currency={currency}
              onApply={onApplyCredit}
            />
          )}

          <AmendmentsSection
            readOnly={!!readOnly}
            onAdd={(sign, amount, note) => onAddAmendment(r.booking.id, sign, amount, note)}
          />

          {!readOnly && (
            <div className="flex justify-end pt-1">
              <button
                onClick={onEdit}
                className="text-xs bg-surface-100 hover:bg-surface-700 text-brand-900 font-semibold px-3 py-1 rounded"
              >
                {ed.editRegistration}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Admin-only control for adding a balance amendment (discount / surcharge).
// The amendments themselves are listed inside the Charges breakdown above, so
// this section is purely the "add" affordance — hidden entirely for read-only
// (staff) viewers.
function AmendmentsSection({ readOnly, onAdd }: {
  readOnly: boolean
  onAdd: (sign: '+' | '-', amount: number, note: string) => Promise<void>
}) {
  const [sign, setSign] = useState<'+' | '-'>('+')
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = parseInt(amountStr, 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t.admin.bookingPayments.amountMustBePositive)
      return
    }
    if (!note.trim()) {
      setError(ed.noteRequired)
      return
    }
    setSubmitting(true)
    try {
      await onAdd(sign, amount, note.trim())
      setAmountStr('')
      setNote('')
      setSign('+')
    } finally {
      setSubmitting(false)
    }
  }

  if (readOnly) return null

  return (
    <div className="text-xs bg-surface-50 rounded p-2 space-y-2">
      <p className="font-semibold text-brand-900">{ed.addBalanceAmendment}</p>
      <form onSubmit={handleSubmit} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <select
              value={sign}
              onChange={e => setSign(e.target.value as '+' | '-')}
              className="bg-white border border-surface-300 rounded px-1.5 py-0.5 text-xs font-semibold text-brand-900"
            >
              <option value="+">{ed.owesMore}</option>
              <option value="-">{ed.owesLess}</option>
            </select>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              placeholder={us.amountPlaceholder}
              className="flex-1 bg-white border border-surface-300 rounded px-2 py-0.5 text-xs text-brand-900"
            />
          </div>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={ed.reasonRequiredPh}
            maxLength={1000}
            className="w-full bg-white border border-surface-300 rounded px-2 py-0.5 text-xs text-brand-900"
          />
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="text-xs bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded"
            >
              {submitting ? ed.adding : ed.addAmendment}
            </button>
          </div>
      </form>
    </div>
  )
}

function renderDetails(d: BookingDetails, names: { addonNames: AddonNameMap; roomNames: RoomNameMap }) {
  const bits: React.ReactNode[] = []
  if (d.gear?.assistance_note) {
    bits.push(<p key="gear">🧰 {ed.detailGearHelp(d.gear.assistance_note)}</p>)
  } else if (d.gear?.rent) {
    const items = d.gear.items?.length ? `: ${d.gear.items.join(', ')}` : ''
    bits.push(<p key="gear">🧰 {ed.detailGear(items)}</p>)
  }
  if (d.room?.option_id) {
    const roomLabel = names.roomNames.get(d.room.option_id) ?? d.room.option_id
    bits.push(<p key="room">🛏️ {ed.detailRoom(roomLabel, d.room.notes ? ` · ${d.room.notes}` : '')}</p>)
  }
  if (d.add_ons?.length) {
    const labels = d.add_ons.map(id => names.addonNames.get(id) ?? id)
    bits.push(<p key="addons">➕ {ed.detailAddons(labels.join(', '))}</p>)
  }
  if (d.transportation) bits.push(<p key="transport">🚐 {ed.detailNeedsRide}</p>)
  if (d.nitrox_course_addon) bits.push(<p key="nitrox">🟢 {ed.detailNitrox}</p>)
  if (d.payment_method) bits.push(<p key="pay">💳 {d.payment_method.replace('_', ' ')}</p>)
  return bits.length ? bits : null
}

function methodEmoji(m: NonNullable<Profile['contact_method']>) {
  return m === 'whatsapp' ? '🟢' : m === 'line' ? '🟩' : m === 'phone' ? '📞' : '✉️'
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm transition-colors ${
        active
          ? 'bg-white text-brand-950 font-semibold'
          : 'text-white/80 hover:text-white hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

/** Per-event money summary: every active diver and what they still owe, with
 *  the event's outstanding total. Read-only — settle payments on a diver's
 *  card under the Registrants tab. */
function BalancesView({ registrants, currency }: { registrants: Registrant[]; currency: string }) {
  const lines = registrants.map(r => ({ r, ...registrantBalance(r) }))
  const totalDue = lines.reduce((s, l) => s + (l.bal.state === 'due' ? l.bal.amount : 0), 0)
  const totalPaid = lines.reduce((s, l) => s + l.paid, 0)
  const everyoneSettled = lines.every(l => l.bal.state !== 'due')

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-brand-900">{ed.tabAmountOwed}</h2>
        <span className={`text-xs font-semibold ${totalDue > 0 ? 'text-red-600' : 'text-brand-900'}`}>
          {totalDue > 0 ? ed.outstanding(currency, totalDue.toLocaleString()) : ed.allSettled}
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-brand-950/70 font-medium italic">{t.admin.transport.noActiveRegistrants}</p>
      ) : (
        <ul className="divide-y divide-surface-200">
          {lines.map(({ r, bal }) => (
            <li key={r.booking.id} className="py-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm text-brand-900 font-medium min-w-0">
                {r.profile?.name ?? t.admin.transport.noProfile}
                {r.profile?.nickname && r.profile.nickname !== r.profile.name && (
                  <span className="text-brand-900/80 font-medium"> ({r.profile.nickname})</span>
                )}
                {r.payerName && (
                  <span className="text-xs text-violet-700 font-semibold">{ed.paidByInline(r.payerName)}</span>
                )}
              </span>
              <span className="shrink-0 text-xs font-semibold">
                {bal.state === 'due' && <span className="text-red-600">{ed.dueLine(currency, bal.amount.toLocaleString())}</span>}
                {bal.state === 'settled' && <span className="text-brand-900">{t.bookings.settled}</span>}
                {bal.state === 'credit' && <span className="text-emerald-700">{ed.creditLine(currency, bal.amount.toLocaleString())}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-baseline justify-between gap-3 pt-1 border-t border-surface-200 text-sm font-semibold text-brand-900">
        <span>{t.payments.totalPaid}</span>
        <span>{currency} {totalPaid.toLocaleString()}</span>
      </div>
      {!everyoneSettled && (
        <p className="text-xs text-brand-950/70 font-medium italic">{ed.recordOnCards}</p>
      )}
    </section>
  )
}
