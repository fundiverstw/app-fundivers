import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageLoading } from '../../components/ui/Spinner'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { siteConfig } from '../../config/site'
import { fetchEventsInRange, fetchUpcomingEventDays, formatEventSpan } from '../../lib/events'
import { gearTotals, splitByTransport, transportHeadcount, dayKeyOffset, careTotals, isCareGearItem, addonTotals, partitionByWaitlist, gearSizeBreakdown, isSizedGearItem, gearDayDiff } from '../../lib/logistics'
import { gearPieceKey, loadPackedGear, savePackedGear, togglePackedGear } from '../../lib/gear-packed'
import { bookingBalance, type BookingBalance } from '../../lib/booking-balance'
import { openCreditForBooking } from '../../lib/credits'
import { fetchAmendmentsForBookings, amendmentsDelta } from '../../lib/booking-amendments'
import { netPaidByBooking } from '../../lib/payments'
import { personName } from '../../lib/names'
import { DiverGearCard, type DiverGearRow } from '../../components/admin/DiverGearCard'
import { TransportGroup } from '../../components/admin/TransportGroup'
import { StaffDutyGroup, type StaffDutyRow } from '../../components/admin/StaffDutyGroup'
import { CareGearGroup } from '../../components/admin/CareGearGroup'
import { AddonSummaryGroup } from '../../components/admin/AddonSummaryGroup'
import { PaymentsDueGroup } from '../../components/admin/PaymentsDueGroup'
import { TransportFleetPlan } from '../../components/admin/TransportFleetPlan'
import { EventVehicleGroup } from '../../components/admin/EventVehicleGroup'
import { SharedTransportPicker } from '../../components/admin/SharedTransportPicker'
import { NextDayGearDiff } from '../../components/admin/NextDayGearDiff'
import { fetchDayGearRows } from '../../lib/logistics-day'
import { fetchVehicles } from '../../lib/vehicles'
import { fetchGearModelsWithSizes } from '../../lib/gear-models'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import { TEXT_HEADING, TEXT_MUTED, BTN_XS_GHOST } from '../../styles/tokens'
import { fetchVehiclesForEvents, availableVehicles, allocationEventId } from '../../lib/event-vehicles'
import { planRuns, type Rider, type RunInput, type RunPlan, type FleetVehicle } from '../../lib/vehicle-planning'
import { fetchRideGroups, groupIdByEvent, buildRuns, shareRideWith, rideAlone } from '../../lib/ride-groups'
import { useAuth } from '../../hooks/useAuth'
import type { AppEvent, Booking, BookingDetails, Credit, Duty, EventRideGroup, EventVehicle, Payment, Profile, Vehicle } from '../../types/database'
import { t } from '../../i18n'

const lg = t.admin.logistics
const gr = t.admin.groups
const tp = t.admin.transport

// Per-booking outstanding balance + the lead responsible for it (if covered).
interface BookingBalanceRow { bal: BookingBalance; payerName: string | null }

// One look for every chip on the Overall board. A faint white hairline on the
// glass — NOT `border-brand-900`, which the dark retrofit (index.css) leaves as
// navy while flipping the text to near-white, rendering the pill's outline
// invisible and the chips as loose floating text.
const SUMMARY_CHIP =
  'text-xs px-2 py-0.5 rounded-full border border-white/20 bg-white/5 text-brand-50 font-medium'

/**
 * The eyebrow label above each Overall block. Small, dim and letter-spaced by
 * design: it must sit clearly *below* the section's <h2> in the hierarchy, so
 * it deliberately shares none of the heading's size, colour or case. `care`
 * carries the amber warning tone — light amber, since the label sits on the
 * dark glass rather than on the amber chips' light fill.
 */
function SummaryLabel({ children, tone }: { children: ReactNode; tone?: 'care' | 'tentative' }) {
  return (
    <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${
      tone === 'care' ? 'text-amber-300' : tone === 'tentative' ? 'text-violet-300' : 'text-brand-100/70'
    }`}>
      {children}
    </h3>
  )
}

/**
 * The gear-to-pack chips, where the sized items open into what they mean on the
 * rack. "BCD ×3" tells a packer how many to carry but not which ones to pull,
 * and that detail otherwise lives one card per diver further down the page —
 * so BCD, wetsuit, fins and boots are buttons that expand to their size split.
 * Items the shop keeps in one size (regulator, mask) stay plain spans: nothing
 * to open, so nothing that looks like it opens.
 *
 * One panel at a time. The sizes are a short list read in passing, and stacking
 * several open panels would push the rest of the board off a phone screen.
 *
 * Inside the panel every diver's piece is a toggle, so the person loading the
 * van ticks each one off as it goes in — see `packedGear` on the page.
 */
function GearChips({ totals, rows, packed, onTogglePiece }: {
  totals: Array<{ item: string; count: number }>
  rows: DiverGearRow[]
  packed: Set<string>
  onTogglePiece: (bookingId: string, item: string) => void
}) {
  const [openItem, setOpenItem] = useState<string | null>(null)
  const breakdown = openItem ? gearSizeBreakdown(rows, openItem) : []
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {totals.map(({ item, count }) => {
          const label = `${item} ×${count}`
          if (!isSizedGearItem(item)) return <span key={item} className={SUMMARY_CHIP}>{label}</span>
          const open = openItem === item
          return (
            <button
              key={item}
              type="button"
              onClick={() => setOpenItem(o => (o === item ? null : item))}
              aria-expanded={open}
              aria-label={open ? lg.hideSizesFor(item) : lg.showSizesFor(item)}
              className={`${SUMMARY_CHIP} transition-colors ${
                open ? 'border-white/50 bg-white/15' : 'hover:border-white/40 hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      {openItem && (
        <div className="rounded-lg border border-white/15 bg-white/5 p-2 space-y-1.5">
          <SummaryLabel>{lg.sizesFor(openItem)}</SummaryLabel>
          <ul className="space-y-1.5">
            {breakdown.map(g => {
              const done = g.divers.filter(d => packed.has(gearPieceKey(d.bookingId, openItem))).length
              return (
                <li key={g.size ?? 'unknown'} className="space-y-1">
                  <p className="text-xs text-brand-50">
                    {/* An unrecorded size is the one line worth chasing before
                        the van leaves, so it carries the warning tone rather
                        than reading as just another rack slot. */}
                    <span className={`font-semibold ${g.size ? '' : 'text-amber-300'}`}>
                      {g.size ? lg.sizeCount(g.size, g.divers.length) : lg.sizeCount(lg.sizeUnknown, g.divers.length)}
                    </span>
                    {done > 0 && (
                      <span className={done === g.divers.length ? 'text-emerald-300 font-semibold' : 'text-brand-100/70'}>
                        {' · '}{done === g.divers.length ? lg.allPacked : lg.packedProgress(done, g.divers.length)}
                      </span>
                    )}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {g.divers.map(d => {
                      const isPacked = packed.has(gearPieceKey(d.bookingId, openItem))
                      return (
                        <li key={d.bookingId}>
                          <button
                            type="button"
                            onClick={() => onTogglePiece(d.bookingId, openItem)}
                            aria-pressed={isPacked}
                            aria-label={isPacked ? lg.unmarkPacked(d.name, openItem) : lg.markPacked(d.name, openItem)}
                            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                              isPacked
                                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100 font-semibold'
                                : 'border-white/25 text-brand-100 font-medium hover:border-white/50 hover:bg-white/10'
                            }`}
                          >
                            {isPacked ? lg.packedName(d.name) : d.name}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
          {/* Says both what the chips do and how far the state travels — a tick
              list that silently lives on one phone would mislead a second
              packer into thinking their colleague hadn't started. */}
          <p className="text-[11px] text-brand-100/60 font-medium">{lg.packedHint}</p>
        </div>
      )}
    </>
  )
}

interface EventGroup {
  event: AppEvent
  rows: DiverGearRow[]
  staff: StaffDutyRow[]
}

// How far ahead the "Other day" picker looks for days that have events.
const LOOKAHEAD_DAYS = 30

type Tab = 'today' | 'tomorrow' | 'other'

export function AdminLogisticsPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [tab, setTab] = useState<Tab>('today')
  const [otherDay, setOtherDay] = useState('')
  // The shop's gear sizing charts, loaded once for the rental fit lookup.
  const [gearModels, setGearModels] = useState<GearModelWithSizes[]>([])
  useEffect(() => {
    fetchGearModelsWithSizes().then(setGearModels).catch(() => { /* charts are optional */ })
  }, [])
  // null = not loaded yet; [] = loaded, no event-days in range.
  const [upcomingDays, setUpcomingDays] = useState<string[] | null>(null)
  // null = loading; [] = loaded, no events that day.
  const [groups, setGroups] = useState<EventGroup[] | null>(null)
  // add-on _id → catalog title, for classifying "handle with care" rentals
  // (dive lights, cameras) that have no category column.
  const [addonTitles, setAddonTitles] = useState<Map<string, string>>(new Map())
  // booking id → outstanding balance, for the day's "who still owes" view.
  const [balances, setBalances] = useState<Map<string, BookingBalanceRow>>(new Map())
  // The whole transport fleet — loaded once. Active vehicles plan rides; the
  // full list (incl. retired) names cars in existing allocations.
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  // Car-to-event allocations for the day's events (one row per car per event).
  const [allocations, setAllocations] = useState<EventVehicle[]>([])
  // Bumped after an assign/unassign to refetch the allocations.
  const [allocReload, setAllocReload] = useState(0)
  // Which of the day's events travel together (event_ride_groups). Rides are
  // planned per group, so this drives every seat count on the page.
  const [rideGroups, setRideGroups] = useState<EventRideGroup[]>([])
  const [ridesBusy, setRidesBusy] = useState(false)
  const [rideError, setRideError] = useState<string | null>(null)
  // The next-day gear diff is opt-in — it costs an extra round trip and most
  // days aren't back-to-back. null = open but the next day is still loading.
  const [diffOpen, setDiffOpen] = useState(false)
  const [nextDayRows, setNextDayRows] = useState<DiverGearRow[] | null>(null)
  const [nextDayFailed, setNextDayFailed] = useState(false)
  // Pieces already loaded onto the van, ticked off behind the size chips. Held
  // here rather than inside GearChips because the seated and waitlist chip sets
  // share one day's list — two owners would clobber each other's writes.
  const [packedGear, setPackedGear] = useState<Set<string>>(new Set())

  const todayKey = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone }),
    [],
  )
  const tomorrowKey = useMemo(() => dayKeyOffset(todayKey, 1), [todayKey])

  const dayKey =
    tab === 'today' ? todayKey
      : tab === 'tomorrow' ? tomorrowKey
        : otherDay

  // Load the transport fleet once — it's the same across every day.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await fetchVehicles()
        if (!cancelled) setVehicles(v)
      } catch { /* fleet just won't be planned; logistics still works */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Car allocations for the day's events — refetched when the events change or
  // after an assign/unassign (allocReload). Allocations are keyed by event now,
  // so we ask for exactly the events shown.
  useEffect(() => {
    if (!groups || groups.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAllocations([])
      setRideGroups([])
      return
    }
    const eventIds = groups.map(g => g.event.id)
    let cancelled = false
    ;(async () => {
      const [alloc, rides] = await Promise.all([
        fetchVehiclesForEvents(eventIds).catch(() => [] as EventVehicle[]),
        fetchRideGroups(dayKey, eventIds).catch(() => [] as EventRideGroup[]),
      ])
      if (cancelled) return
      setAllocations(alloc)
      setRideGroups(rides)
    })()
    return () => { cancelled = true }
  }, [groups, allocReload, dayKey])

  // Populate the "Other day" dropdown with upcoming days that actually have
  // events, so the admin never picks a dead day.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const days = await fetchUpcomingEventDays(todayKey, dayKeyOffset(todayKey, LOOKAHEAD_DAYS))
      if (!cancelled) setUpcomingDays(days)
    })()
    return () => { cancelled = true }
  }, [todayKey])

  // Entering "Other day" with nothing chosen yet → default to the first
  // upcoming day beyond tomorrow (those two have their own tabs).
  useEffect(() => {
    if (tab !== 'other' || otherDay || !upcomingDays?.length) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOtherDay(upcomingDays.find(d => d > tomorrowKey) ?? upcomingDays[0])
  }, [tab, otherDay, upcomingDays, tomorrowKey])

  // The next day *with events* after the one on screen — the jump button skips
  // dead days instead of stepping one calendar day at a time. null when the day
  // shown is the last one with events inside the LOOKAHEAD_DAYS window, which is
  // also the only case where the button is hidden.
  const nextEventDay = useMemo(
    () => (upcomingDays ?? []).find(d => d > dayKey) ?? null,
    [upcomingDays, dayKey],
  )

  // Carrying gear over only makes sense on consecutive days: put a gap between
  // them and the kit is dried and racked anyway, so the diff would be advice
  // nobody can act on. The button is offered on back-to-back days only.
  const nextDayKey = dayKey ? dayKeyOffset(dayKey, 1) : ''
  const backToBack = !!nextDayKey && nextEventDay === nextDayKey

  useEffect(() => {
    if (!diffOpen || !backToBack) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNextDayRows(null)
    setNextDayFailed(false)
    ;(async () => {
      try {
        const rows = await fetchDayGearRows(nextDayKey)
        if (!cancelled) setNextDayRows(rows)
      } catch {
        // Say the read failed rather than diffing against an empty next day,
        // which would look like a real answer: everything back to the shop.
        if (!cancelled) setNextDayFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [diffOpen, backToBack, nextDayKey])

  // Land on whichever control owns that day, so the tabs keep matching what's
  // displayed: today/tomorrow have their own tabs, anything else is "Other day".
  function goToDay(day: string) {
    if (day === todayKey) { setTab('today'); return }
    if (day === tomorrowKey) { setTab('tomorrow'); return }
    setOtherDay(day)
    setTab('other')
  }

  useEffect(() => {
    if (!dayKey) return
    let cancelled = false
    // Reset to the loading spinner whenever the selected day changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups(null)
    ;(async () => {
      // fetchEventsInRange(day, day) returns dives starting that day and
      // courses running that day. A rare multi-day dive that started earlier
      // won't appear — acceptable for a day-of view.
      const events = await fetchEventsInRange(dayKey, dayKey, { includePrivate: true })
      if (cancelled) return
      // Dedupe by id (a course could yield more than one segment); first wins.
      const seen = new Set<string>()
      const uniqueEvents = events.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
      if (!uniqueEvents.length) { setGroups([]); return }

      const eventIds = uniqueEvents.map(e => e.id)
      // Duties whose date range covers this day, for the day's events. Staff
      // have no transport preference, so each on-duty assignment is surfaced
      // in the ride planning below. A null end_date is a single-day duty.
      const dayCovered = `end_date.gte.${dayKey},end_date.is.null`
      const [bookingsB, dutiesB] = await Promise.all([
        eventIds.length
          ? supabase.from('bookings').select('*').in('event_id', eventIds).neq('status', 'cancelled')
          : Promise.resolve({ data: [] as Booking[] }),
        eventIds.length
          ? supabase.from('duties').select('*').in('event_id', eventIds).lte('start_date', dayKey).or(dayCovered)
          : Promise.resolve({ data: [] as Duty[] }),
      ])
      const bookings = (bookingsB.data ?? []) as Booking[]
      const duties = (dutiesB.data ?? []) as Duty[]

      // Resolve catalog titles for the day's add-ons so we can pick out the
      // delicate ones (lights, cameras) for the care inventory.
      const addonIds = [...new Set(
        bookings.flatMap(b => (b.details as BookingDetails | undefined)?.add_ons ?? []),
      )]
      const addonsRes = addonIds.length
        ? await supabase.from('addons').select('id, display_title, admin_title').in('id', addonIds)
        : { data: [] as Array<{ id: string; display_title: string | null; admin_title: string | null }> }
      if (cancelled) return
      setAddonTitles(new Map(
        (addonsRes.data ?? []).map(a => [a.id, a.display_title || a.admin_title || a.id]),
      ))

      const userIds = [...new Set([
        ...bookings.map(b => b.user_id),
        // Lead payers may not themselves be booked that day, but we still need
        // their name for "paid by …" on a covered diver's balance.
        ...bookings.map(b => b.payer_id).filter((x): x is string => !!x),
        ...duties.map(d => d.assignee_id),
      ])]
      const bookingIds = bookings.map(b => b.id)
      const [profsRes, paymentsRes, creditsRes, amendmentsByBooking] = await Promise.all([
        userIds.length
          ? supabase.from('profiles').select('*').in('id', userIds)
          : Promise.resolve({ data: [] as Profile[] }),
        bookingIds.length
          ? supabase.from('payments').select('*').in('booking_id', bookingIds)
          : Promise.resolve({ data: [] as Payment[] }),
        userIds.length
          ? supabase.from('credits').select('*').in('user_id', userIds).eq('status', 'open')
          : Promise.resolve({ data: [] as Credit[] }),
        fetchAmendmentsForBookings(bookingIds),
      ])
      if (cancelled) return
      const profMap = new Map((profsRes.data ?? []).map(p => [p.id, p]))

      // Per-booking "what's still owed" — the adjusted total (frozen snapshot +
      // the signed amendment ledger, where discounts and surcharges live) minus
      // paid payments and any open credit, mirroring the event page's
      // Amount-owed math so the two never disagree. Amendments are not optional
      // here: apply_credit_to_booking clamps what it draws down to the *amended*
      // balance, so a discounted booking settled with credit would otherwise
      // show a phantom "due" forever. A covered booking keeps its own balance
      // but notes the lead who's responsible for it.
      const paidByBooking = netPaidByBooking((paymentsRes.data ?? []) as Payment[])
      const credits = (creditsRes.data ?? []) as Credit[]
      const balByBooking = new Map<string, BookingBalanceRow>()
      for (const b of bookings) {
        const owed = Number((b.details as BookingDetails | undefined)?.total ?? 0)
          + amendmentsDelta(amendmentsByBooking.get(b.id) ?? [])
        const paid = paidByBooking.get(b.id) ?? 0
        const payerName = (b.payer_id && b.payer_id !== b.user_id)
          ? (personName(profMap.get(b.payer_id)?.name, profMap.get(b.payer_id)?.nickname) || lg.leadBooker)
          : null
        balByBooking.set(b.id, { bal: bookingBalance(owed, paid, openCreditForBooking(credits, b.id), { cancelled: b.status === 'cancelled' }), payerName })
      }
      if (cancelled) return
      setBalances(balByBooking)

      const byEvent = new Map<string, DiverGearRow[]>()
      for (const b of bookings) {
        const eid = b.event_id
        if (!eid) continue
        const arr = byEvent.get(eid) ?? []
        arr.push({ booking: b, profile: profMap.get(b.user_id) ?? null })
        byEvent.set(eid, arr)
      }

      const staffByEvent = new Map<string, StaffDutyRow[]>()
      for (const d of duties) {
        const eid = d.event_id
        if (!eid) continue
        const arr = staffByEvent.get(eid) ?? []
        arr.push({ dutyId: d.id, role: d.role, profile: profMap.get(d.assignee_id) ?? null })
        staffByEvent.set(eid, arr)
      }

      if (cancelled) return
      setGroups(uniqueEvents.map(ev => ({
        event: ev,
        rows: byEvent.get(ev.id) ?? [],
        staff: staffByEvent.get(ev.id) ?? [],
      })))
    })()
    return () => { cancelled = true }
  }, [dayKey])

  useEffect(() => {
    if (!dayKey) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPackedGear(loadPackedGear(dayKey))
  }, [dayKey])

  function togglePackedPiece(bookingId: string, item: string) {
    const next = togglePackedGear(packedGear, gearPieceKey(bookingId, item))
    setPackedGear(next)
    savePackedGear(dayKey, next)
  }

  // Keep a diver's displayed sizes in sync after an inline save, across every
  // event group they appear in that day.
  function patchProfile(diverId: string, patch: Partial<Profile>) {
    setGroups(prev => prev?.map(g => ({
      ...g,
      rows: g.rows.map(r =>
        r.profile && r.profile.id === diverId
          ? { ...r, profile: { ...r.profile, ...patch } as Profile }
          : r),
    })) ?? prev)
  }

  const allRows = (groups ?? []).flatMap(g => g.rows)
  // Waitlisted divers have no confirmed seat, so their gear/rides are tentative:
  // every prep total below is computed from `seatedRows`, and the waitlist load
  // is surfaced on its own "Tentative" block so the shop packs for the boat it
  // actually has, then knows the extra if the waitlist clears.
  const { seated: seatedRows, waitlisted: waitlistRows } = partitionByWaitlist(allRows)
  // Care items (dive computers, lights, cameras) are issued and tracked
  // separately, so drop them from the dive-bag "Gear to pack" chips.
  const overallGear = gearTotals(seatedRows).filter(g => !isCareGearItem(g.item))
  const overallCare = careTotals(seatedRows, addonTitles)
  // Whole-day add-on tally (SMBs, nitrox tanks, course upgrades, lights, …) so
  // the shop's prep list sits next to gear + handle-with-care in the summary.
  const overallAddons = addonTotals(seatedRows, addonTitles)
  // Headcounts, not booking rows: a diver on two of the day's events is one
  // body to seat, and their most demanding answer wins.
  const transport = transportHeadcount(seatedRows)
  // The tentative load — one combined heads-up list (all pack items, incl. care,
  // plus add-ons) of what the waitlisted divers would add if they get a seat.
  const waitlistGear = gearTotals(waitlistRows)
  const waitlistAddons = addonTotals(waitlistRows, addonTitles)
  // Seated rows on both sides, matching every other prep total: a waitlisted
  // diver's gear isn't packed today, so it can't be kept out for tomorrow.
  const nextDayDiff = nextDayRows
    ? gearDayDiff(seatedRows, partitionByWaitlist(nextDayRows).seated)
    : null
  // Day-wide on-duty staff for the overall board — one entry per person even
  // when they cover several of the day's events, with all the roles they hold.
  const dayStaff: { key: string; name: string; roles: string[] }[] = []
  const staffIndex = new Map<string, number>()
  for (const s of (groups ?? []).flatMap(g => g.staff)) {
    const key = s.profile?.id ?? s.dutyId
    let i = staffIndex.get(key)
    if (i === undefined) {
      i = dayStaff.length
      staffIndex.set(key, i)
      dayStaff.push({ key, name: personName(s.profile?.name, s.profile?.nickname) || lg.staffFallback, roles: [] })
    }
    if (!dayStaff[i].roles.includes(s.role)) dayStaff[i].roles.push(s.role)
  }
  const onDutyStaffCount = dayStaff.length
  // The day's roster — every diver booked across the day's events, one entry per
  // person (someone diving two of the day's events is still one diver to brief,
  // count heads for, and check off). Sorted so the list reads the same on every
  // reload. Keyed by booking when a row has no profile, since those can't merge.
  const dayDivers: { key: string; name: string }[] = []
  const diverKeys = new Set<string>()
  for (const r of seatedRows) {
    const key = r.profile?.id ?? r.booking.id
    if (diverKeys.has(key)) continue
    diverKeys.add(key)
    dayDivers.push({ key, name: personName(r.profile?.name, r.profile?.nickname) || tp.noProfile })
  }
  dayDivers.sort((a, b) => a.name.localeCompare(b.name))
  // The waitlisted roster — same dedupe, for the Tentative block. A person
  // already seated (on another of the day's events) is not re-listed as waiting.
  const waitlistDivers: { key: string; name: string }[] = []
  for (const r of waitlistRows) {
    const key = r.profile?.id ?? r.booking.id
    if (diverKeys.has(key)) continue
    diverKeys.add(key)
    waitlistDivers.push({ key, name: personName(r.profile?.name, r.profile?.nickname) || tp.noProfile })
  }
  waitlistDivers.sort((a, b) => a.name.localeCompare(b.name))
  // Divers who still owe — for the whole-day summary and each event's list.
  const currency = (groups ?? [])[0]?.event.currency ?? siteConfig.locale.currency
  const dueRowsFor = (rows: DiverGearRow[]) => rows.flatMap(r => {
    const e = balances.get(r.booking.id)
    if (!e || e.bal.state !== 'due') return []
    return [{
      bookingId: r.booking.id,
      name: personName(r.profile?.name, r.profile?.nickname) || tp.noProfile,
      amount: e.bal.amount,
      payerName: e.payerName,
    }]
  })
  const dayDue = dueRowsFor(allRows)
  const dayOutstanding = dayDue.reduce((s, x) => s + x.amount, 0)
  // Active fleet plans rides and fills the assign pickers; retired cars stay in
  // `vehicles` only to name existing allocations.
  const activeVehicles = vehicles.filter(v => v.active)
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
  // Allocations grouped by the event they're on, for the per-event car block.
  const allocByEvent = new Map<string, EventVehicle[]>()
  for (const a of allocations) {
    const eid = allocationEventId(a)
    if (!eid) continue
    const arr = allocByEvent.get(eid) ?? []
    arr.push(a)
    allocByEvent.set(eid, arr)
  }
  // Ride planning is per RUN — the events that travel together, as stated in
  // event_ride_groups. A run pools its events' ride-needing divers, on-duty
  // staff and cars, counting each person and each physical car exactly once;
  // separate runs are planned separately, because two runs heading for
  // different sites can't lend each other a seat. Assigning a car or changing
  // who travels with whom reshuffles this immediately.
  const groupByEventId = new Map((groups ?? []).map(g => [g.event.id, g]))
  const eventTitle = (ev: AppEvent) => ev.calendar_title || ev.title
  const runInputs: RunInput[] = buildRuns(
    (groups ?? []).map(g => g.event.id),
    groupIdByEvent(rideGroups),
  ).map(run => {
    const members = run.eventIds.map(id => groupByEventId.get(id)).filter((g): g is EventGroup => !!g)
    return {
      key: run.key,
      events: members.map(g => ({ id: g.event.id, title: eventTitle(g.event) })),
      // Only seated divers hold a seat, so only they get planned into a car —
      // a waitlisted diver isn't given van space they may never use.
      divers: members.flatMap(g => splitByTransport(partitionByWaitlist(g.rows).seated).needsRide.map((r): Rider => ({
        id: r.profile?.id ?? r.booking.id,
        name: personName(r.profile?.name, r.profile?.nickname) || tp.noProfile,
        kind: 'diver',
      }))),
      staff: members.flatMap(g => g.staff.map((s): Rider => ({
        id: s.profile?.id ?? s.dutyId,
        name: personName(s.profile?.name, s.profile?.nickname) || lg.staffFallback,
        kind: 'staff',
      }))),
      fleet: members.flatMap(g => (allocByEvent.get(g.event.id) ?? [])
        .map(a => vehicleMap.get(a.vehicle_id))
        .filter((v): v is Vehicle => !!v)
        .map((v): FleetVehicle => ({ id: v.id, name: v.name, passenger_seats: v.passenger_seats }))),
    }
  })
  const fleetPlan = planRuns(runInputs)
  // Each event's run, so its own Cars block reports the run's seats and riders
  // rather than a per-event slice that would contradict the board above.
  const runByEventId = new Map<string, RunPlan>()
  for (const run of fleetPlan.runs) {
    for (const ev of run.events) runByEventId.set(ev.id, run)
  }

  async function changeRideGroup(action: () => Promise<void>) {
    setRidesBusy(true); setRideError(null)
    try {
      await action()
      setAllocReload(k => k + 1)
    } catch {
      setRideError(tp.shareFailed)
    } finally {
      setRidesBusy(false)
    }
  }

  const promptForDay = tab === 'other' && !otherDay

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-bold text-brand-900">{t.nav.logistics}</h1>
          {dayKey && <span className="text-xs text-brand-900 font-medium">{dayKey}</span>}
        </div>
        <div role="tablist" aria-label={lg.dayTablistAria} className="flex flex-wrap gap-2 items-center">
          <DayTab label={lg.today}    active={tab === 'today'}    onClick={() => setTab('today')} />
          <DayTab label={lg.tomorrow} active={tab === 'tomorrow'} onClick={() => setTab('tomorrow')} />
          <DayTab label={lg.otherDay} active={tab === 'other'}    onClick={() => setTab('other')} />
          {tab === 'other' && (
            upcomingDays && upcomingDays.length === 0 ? (
              <span className="text-xs text-brand-950 font-medium italic">{lg.noEventsInDays(LOOKAHEAD_DAYS)}</span>
            ) : (
              <select
                aria-label={lg.selectADayAria}
                value={otherDay}
                onChange={e => setOtherDay(e.target.value)}
                className="px-3 py-1 rounded-full text-sm bg-surface-100 text-brand-900 border border-surface-200"
              >
                <option value="">{lg.selectADay}</option>
                {(upcomingDays ?? []).map(d => (
                  <option key={d} value={d}>{format(parseISO(d), 'EEE, MMM d')}</option>
                ))}
              </select>
            )
          )}
        </div>
      </header>

      {promptForDay ? (
        <p className="text-brand-950 font-medium text-sm">{lg.pickADay}</p>
      ) : groups === null ? (
        <PageLoading />
      ) : groups.length === 0 ? (
        <p className="text-brand-950 font-medium text-sm">{lg.noEventsOn(dayKey)}</p>
      ) : (
        <>
          <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4">
            {/* The section header owns the identity: large, white, sentence-case,
                with a rule beneath it. Every block label below is deliberately
                its opposite — tiny, dim, uppercase — so the two tiers can never
                be mistaken for each other. They used to differ only by one step
                of size and weight, which is why the hierarchy read as flat. */}
            <header className="border-b border-surface-300 pb-2 mb-3 space-y-2 sm:space-y-0 sm:flex sm:items-start sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <h2 className={`${TEXT_HEADING} text-lg`}>{lg.overall(dayKey)}</h2>
                {/* Headcount, not bookings: someone diving two of the day's events
                    is one diver. Counting rows here would disagree with the roster
                    below, which lists that person once. */}
                <p className={`${TEXT_MUTED} text-sm font-medium`}>{lg.eventsDivers(groups.length, dayDivers.length)}</p>
              </div>
              <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                {/* Open the overlap with tomorrow without leaving the day being
                    packed — the whole point is reading both at once. */}
                {backToBack && (
                  <button
                    type="button"
                    onClick={() => setDiffOpen(o => !o)}
                    aria-expanded={diffOpen}
                    aria-label={diffOpen ? lg.hideNextDayDiff : lg.showNextDayDiff}
                    className={BTN_XS_GHOST}
                  >
                    {lg.nextDayDiff}
                  </button>
                )}
                {/* Jump to the next day that has events. Labelled with the
                    destination — "Tomorrow" when that's where it lands, the date
                    otherwise — so it says where it goes rather than just "next". */}
                {nextEventDay && (
                  <button
                    type="button"
                    onClick={() => goToDay(nextEventDay)}
                    className={BTN_XS_GHOST}
                  >
                    {lg.nextEventDay(nextEventDay === tomorrowKey ? lg.tomorrow : nextEventDay)}
                  </button>
                )}
              </div>
            </header>
            {/* Opens directly under the button that asks for it. Anywhere further
                down and a phone would show no visible response to the tap. */}
            {backToBack && diffOpen && (
              <div className="mb-4">
                <NextDayGearDiff day={nextDayKey} diff={nextDayDiff} failed={nextDayFailed} />
              </div>
            )}
            {/* Two columns from sm up — the blocks are short, so one column left
                half the board empty on anything wider than a phone. items-start
                keeps a tall block (the fleet plan) from stretching its neighbour. */}
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 items-start">
              {allRows.length > 0 && (
                <div className="space-y-1">
                  <SummaryLabel>{t.payments.title}</SummaryLabel>
                  {dayOutstanding > 0 ? (
                    <p className="text-sm font-semibold text-red-300">
                      {lg.stillOwe(dayDue.length, currency, dayOutstanding.toLocaleString())}
                    </p>
                  ) : (
                    <p className="text-sm text-brand-900 font-medium">{lg.allSettled}</p>
                  )}
                </div>
              )}
              {dayStaff.length > 0 && (
                <div className="space-y-1">
                  <SummaryLabel>{gr.onDutyStaff}</SummaryLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {dayStaff.map(s => (
                      <span key={s.key} className={`${SUMMARY_CHIP} select-text`}>
                        {s.name}
                        {s.roles.length > 0 && <span className="font-normal text-brand-100/70"> · {s.roles.join(', ')}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {dayDivers.length > 0 && (
                <div className="space-y-1">
                  <SummaryLabel>{lg.diversOnDay}</SummaryLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {dayDivers.map(d => (
                      // Selectable so a name can be copied straight off the board.
                      <span key={d.key} className={`${SUMMARY_CHIP} select-text`}>{d.name}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <SummaryLabel>{t.bookings.breakdown.transportation}</SummaryLabel>
                <p className="text-sm text-brand-900 font-medium">
                  <span className="text-red-300 font-semibold">{transport.needsRide}</span>{lg.needARide}
                  {onDutyStaffCount > 0 && (
                    <> · <span className="text-brand-900 font-semibold">{onDutyStaffCount}</span>{lg.onDutyStaffSuffix}</>
                  )}
                  {' · '}{lg.selfTransportCount(transport.selfTransport)}
                  {transport.unspecified > 0 && <> · {lg.unspecifiedCount(transport.unspecified)}</>}
                </p>
                {fleetPlan.riders > 0 && (
                  <TransportFleetPlan plan={fleetPlan} fleetSize={activeVehicles.length} />
                )}
                <SharedTransportPicker
                  events={groups.map(g => ({ id: g.event.id, title: eventTitle(g.event) }))}
                  groupOf={groupIdByEvent(rideGroups)}
                  isAdmin={isAdmin}
                  busy={ridesBusy}
                  onShareWith={(eventId, withEventId) => changeRideGroup(() => shareRideWith({
                    day: dayKey, eventId, withEventId, rows: rideGroups, createdBy: profile?.id ?? null,
                  }))}
                  onRideAlone={eventId => changeRideGroup(() => rideAlone({
                    day: dayKey, eventId, rows: rideGroups,
                  }))}
                />
                {rideError && <p className="text-sm font-semibold text-red-600">{rideError}</p>}
              </div>
              <div className="space-y-1">
                <SummaryLabel>{lg.gearToPack}</SummaryLabel>
                {overallGear.length === 0 ? (
                  <p className="text-sm text-brand-950/70 font-medium italic">{lg.nothingToPack}</p>
                ) : (
                  <GearChips totals={overallGear} rows={seatedRows} packed={packedGear} onTogglePiece={togglePackedPiece} />
                )}
              </div>
              {overallCare.length > 0 && (
                <div className="space-y-1">
                  <SummaryLabel tone="care">{gr.handleWithCare}</SummaryLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {overallCare.map(({ item, divers }) => (
                      // Amber keeps a real light fill, so its dark ink is correct here.
                      <span key={item} className="text-xs px-2 py-0.5 rounded-full border border-amber-500 bg-amber-50 text-amber-900 font-semibold">
                        {item} ×{divers.length}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {overallAddons.length > 0 && (
                <div className="space-y-1">
                  <SummaryLabel>{gr.addons}</SummaryLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {overallAddons.map(({ title, count }) => (
                      <span key={title} className={SUMMARY_CHIP}>{title} ×{count}</span>
                    ))}
                  </div>
                </div>
              )}
              {waitlistRows.length > 0 && (
                // Full-width so the "if the waitlist clears" load reads as a
                // block apart from the confirmed prep lists above it.
                <div className="space-y-1.5 sm:col-span-2 border-t border-violet-400/30 pt-3">
                  <SummaryLabel tone="tentative">{lg.tentativeWaitlist(waitlistRows.length)}</SummaryLabel>
                  <p className="text-xs text-brand-100/70 font-medium">{lg.tentativeHint}</p>
                  {waitlistDivers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {waitlistDivers.map(d => (
                        <span key={d.key} className="text-xs px-2 py-0.5 rounded-full border border-violet-400/40 bg-violet-500/10 text-violet-100 font-medium select-text">
                          {d.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {waitlistGear.length > 0 && <GearChips totals={waitlistGear} rows={waitlistRows} packed={packedGear} onTogglePiece={togglePackedPiece} />}
                  {waitlistAddons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {waitlistAddons.map(({ title, count }) => (
                        <span key={`a-${title}`} className={SUMMARY_CHIP}>{title} ×{count}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {groups.map(g => {
          // Seated divers pack/plan for real; waitlisted ones are grouped last
          // and kept out of this event's gear/care/add-on/transport tallies so
          // they agree with the seated-only Overall board above.
          const { seated: eventSeated, waitlisted: eventWaitlist } = partitionByWaitlist(g.rows)
          return (
            <section key={g.event.id} className="space-y-2 pt-2">
              {/* Bold banner per event so the sections are obvious when
                  scrolling a tall phone screen. */}
              <div className="bg-brand-900 text-white rounded-xl px-4 py-2.5 space-y-0.5">
                <div className="flex items-start justify-between gap-3">
                  {/* The title goes to the event itself; the Edit button beside
                      it goes to the editor. Staff get the link too — unlike the
                      editor, /admin/events/:id is theirs to read (App.tsx), and
                      the old isAdmin gate here existed only because the title
                      used to point at the admin-only edit page. */}
                  <h2 className="text-base font-semibold break-words">
                    <Link
                      to={`/admin/events/${g.event.id}`}
                      className="hover:underline"
                    >
                      {g.event.title}
                    </Link>
                  </h2>
                  {isAdmin && (
                    <Link
                      to={`/admin/events/${g.event.id}/edit`}
                      className="shrink-0 text-xs bg-white/15 hover:bg-white/25 text-white px-2.5 py-1 rounded-lg font-medium"
                    >
                      {t.admin.catalog.edit}
                    </Link>
                  )}
                </div>
                <span className="block text-xs text-white/80">
                  {formatEventSpan(g.event, { style: 'compact' })} · {lg.diverCount(g.rows.length)}
                </span>
              </div>
              <EventTransport rows={eventSeated} />
              <StaffDutyGroup rows={g.staff} />
              <EventVehicleGroup
                event={g.event}
                allocations={allocByEvent.get(g.event.id) ?? []}
                available={availableVehicles(
                  activeVehicles,
                  new Set((allocByEvent.get(g.event.id) ?? []).map(a => a.vehicle_id)),
                )}
                vehicleMap={vehicleMap}
                riders={runByEventId.get(g.event.id)?.riders ?? 0}
                runSeats={runByEventId.get(g.event.id)?.fleetSeats ?? 0}
                sharedWith={(runByEventId.get(g.event.id)?.events ?? [])
                  .filter(e => e.id !== g.event.id)
                  .map(e => e.title)}
                isAdmin={isAdmin}
                createdBy={profile?.id ?? null}
                onChanged={() => setAllocReload(k => k + 1)}
              />
              <CareGearGroup rows={careTotals(eventSeated, addonTitles)} />
              <AddonSummaryGroup rows={addonTotals(eventSeated, addonTitles)} />
              {/* Payments are money owed regardless of seat, so this stays on
                  the full roster — a waitlisted diver who owes still shows. */}
              <PaymentsDueGroup rows={dueRowsFor(g.rows)} currency={currency} />
              {g.rows.length === 0 ? (
                <p className="text-xs text-brand-950/70 font-medium italic pl-1">{tp.noActiveRegistrants}</p>
              ) : (
                eventSeated.map(r => (
                  <DiverGearCard key={r.booking.id} row={r} onProfilePatched={patchProfile} linkToProfile={isAdmin} gearModels={gearModels} />
                ))
              )}
              {eventWaitlist.length > 0 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-violet-300 pt-1 pl-1">
                    {lg.waitlistHeading(eventWaitlist.length)}
                  </p>
                  {eventWaitlist.map(r => (
                    <DiverGearCard key={r.booking.id} row={r} onProfilePatched={patchProfile} linkToProfile={isAdmin} gearModels={gearModels} />
                  ))}
                </>
              )}
            </section>
          )})}
        </>
      )}
    </div>
  )
}

function DayTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm transition-colors ${
        active
          ? 'bg-brand-900 text-white font-semibold'
          : 'bg-surface-100 text-brand-900 hover:bg-surface-200'
      }`}
    >
      {label}
    </button>
  )
}

function EventTransport({ rows }: { rows: DiverGearRow[] }) {
  const { needsRide, unspecified } = splitByTransport(rows)
  // Self-transport divers need no van planning, so only surface the actionable
  // buckets here (the full split lives on the event's Transportation tab).
  if (needsRide.length === 0 && unspecified.length === 0) return null
  return (
    <>
      {needsRide.length > 0 && (
        <TransportGroup title={tp.needsRide} rows={needsRide} emptyHint="" />
      )}
      {unspecified.length > 0 && (
        <TransportGroup
          title={lg.transportNotSpecified}
          rows={unspecified}
          emptyHint=""
          note={tp.unspecifiedNote}
        />
      )}
    </>
  )
}
