import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageLoading } from '../../components/ui/Spinner'
import { format, parseISO } from 'date-fns'
import { siteConfig } from '../../config/site'
import { fetchUpcomingEventDays, formatEventSpan } from '../../lib/events'
import { splitByTransport, transportHeadcount, dayKeyOffset, partitionByWaitlist } from '../../lib/logistics'
import { dayRoster, eventEntersWater } from '../../lib/participants'
import { guestPieces, packProgress, piecesByItem, type PackGuest, type PackPiece } from '../../lib/pack-list'
import { gearPackList } from '../../lib/gear'
import { bookingBalance, type BookingBalance } from '../../lib/booking-balance'
import { openCreditForBooking } from '../../lib/credits'
import { amendmentsDelta } from '../../lib/booking-amendments'
import { netPaidByBooking } from '../../lib/payments'
import { personName } from '../../lib/names'
import type { DiverGearRow } from '../../components/admin/DiverGearCard'
import { GuestPackCard } from '../../components/admin/GuestPackCard'
import { TransportGroup } from '../../components/admin/TransportGroup'
import { StaffDutyGroup, type StaffDutyRow } from '../../components/admin/StaffDutyGroup'
import { PaymentsDueGroup } from '../../components/admin/PaymentsDueGroup'
import { TransportFleetPlan } from '../../components/admin/TransportFleetPlan'
import { EventVehicleGroup } from '../../components/admin/EventVehicleGroup'
import { SharedTransportPicker } from '../../components/admin/SharedTransportPicker'
import { OfflineBoardStatus } from '../../components/admin/OfflineBoardStatus'
import { fetchVehicles } from '../../lib/vehicles'
import { fetchGearModelsWithSizes } from '../../lib/gear-models'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import { BTN_XS_GHOST } from '../../styles/tokens'
import { availableVehicles, allocationEventId } from '../../lib/event-vehicles'
import { planRuns, type Rider, type RunInput, type RunPlan, type FleetVehicle } from '../../lib/vehicle-planning'
import { groupIdByEvent, buildRuns, shareRideWith, rideAlone } from '../../lib/ride-groups'
import { amendmentsByBooking } from '../../lib/day-board'
import { liveOrStored, loadDayBoard, loadDayTransport, type DayBoardSource } from '../../lib/day-board-source'
import { useAuth } from '../../hooks/useAuth'
import { useOffline } from '../../hooks/useOffline'
import { usePackedGear } from '../../hooks/usePackedGear'
import type { AppEvent, BookingDetails, EventRideGroup, EventVehicle, Profile, Vehicle } from '../../types/database'
import { t } from '../../i18n'

const lg = t.admin.logistics
const pk = lg.pack
const gr = t.admin.groups
const gc = t.admin.gearCard
const tp = t.admin.transport

// Per-booking outstanding balance + the lead responsible for it (if covered).
interface BookingBalanceRow { bal: BookingBalance; payerName: string | null }

// A name on the People roster. A faint white hairline on the glass — NOT
// `border-brand-900`, which the dark retrofit (index.css) leaves as navy while
// flipping the text to near-white, so the outline would vanish.
const NAME_CHIP =
  'text-sm px-2.5 py-1 rounded-full border border-white/20 bg-white/5 text-brand-50 font-medium'
// Someone on a dry event — orange, so the people who never get in the water
// can be counted at a glance; that count is what the shop's insurer asks for.
const NON_DIVER_CHIP =
  'text-sm px-2.5 py-1 rounded-full border border-orange-400/40 bg-orange-500/10 text-orange-100 font-medium'
// No seat yet — violet, the waitlist tone everywhere on the board.
const WAITLIST_CHIP =
  'text-sm px-2.5 py-1 rounded-full border border-violet-400/40 bg-violet-500/10 text-violet-100 font-medium'

/**
 * A person's name on the People roster. Admins can follow it to the person's
 * directory card; staff get plain text because `/admin/users` is admin-only
 * (App.tsx) and the link would only bounce them. A row with no profile has
 * nothing to point at, so it stays plain for everyone.
 */
function PersonChip({ name, profileId, linked, className, children }: {
  name: string
  profileId: string | null
  linked: boolean
  className: string
  children?: ReactNode
}) {
  const body = children ?? name
  if (!linked || !profileId) return <span className={`${className} select-text`}>{body}</span>
  return (
    <Link
      to={`/admin/users?diver=${profileId}`}
      aria-label={lg.viewProfile(name)}
      className={`${className} hover:underline select-text`}
    >
      {body}
    </Link>
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

// One thing on screen at a time. The board used to stack packing, rides,
// rosters and money on one long page, and the packing list — the part a crew
// works from with gear in their hands — was the easiest to lose track of in it.
type Section = 'gear' | 'rides' | 'people' | 'payments'

// Two ways into the same tick list: guest by guest (the default, and the check
// that nobody was missed) or item by item (pulling kit off the rack).
type PackView = 'guest' | 'item'

export function AdminLogisticsPage() {
  const { profile } = useAuth()
  const offline = useOffline()
  const isAdmin = profile?.role === 'admin'
  const online = offline?.online ?? true
  // The copy saved on this device, read through a ref. A background save lands
  // every half hour at most; if the board depended on it directly, each one
  // would throw a board that came off the network back to the spinner and
  // fetch it all again.
  const snapshotRef = useRef(offline?.snapshot ?? null)
  useEffect(() => { snapshotRef.current = offline?.snapshot ?? null }, [offline?.snapshot])
  // Bumped when a new saved copy should replace what is on screen: the board
  // is showing the old copy, or showing nothing because there was none.
  const [deviceReload, setDeviceReload] = useState(0)
  // The loads read the connection through a ref and reload only when it comes
  // back. Losing signal must not throw away a board already on screen: what
  // was loaded a moment ago is as good as any saved copy, and for any day but
  // today it is the only copy there is.
  const onlineRef = useRef(online)
  const [reconnects, setReconnects] = useState(0)
  useEffect(() => {
    const cameBack = online && !onlineRef.current
    onlineRef.current = online
    if (cameBack) setReconnects(k => k + 1)
  }, [online])
  const [tab, setTab] = useState<Tab>('today')
  const [otherDay, setOtherDay] = useState('')
  const [section, setSection] = useState<Section>('gear')
  const [packView, setPackView] = useState<PackView>('guest')
  // The shop's gear sizing charts, loaded once for the rental fit lookup.
  const [gearModels, setGearModels] = useState<GearModelWithSizes[]>([])
  useEffect(() => {
    void liveOrStored(
      onlineRef.current,
      fetchGearModelsWithSizes,
      () => snapshotRef.current?.gearModels ?? [],
    ).then(setGearModels)
  }, [reconnects, deviceReload])
  // null = not loaded yet; [] = loaded, no event-days in range.
  const [upcomingDays, setUpcomingDays] = useState<string[] | null>(null)
  // null = loading; [] = loaded, no events that day.
  const [groups, setGroups] = useState<EventGroup[] | null>(null)
  // add-on _id → catalog title, for naming each guest's add-ons and picking
  // out the delicate ones (lights, cameras), which have no category column.
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
  // Where the day on screen came from. null while loading; 'unavailable' means
  // no network AND nothing captured for this day, which is the one case the
  // board must not render as an empty day.
  const [boardSource, setBoardSource] = useState<DayBoardSource | 'unavailable' | null>(null)

  const todayKey = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone }),
    [],
  )
  const tomorrowKey = useMemo(() => dayKeyOffset(todayKey, 1), [todayKey])

  const dayKey =
    tab === 'today' ? todayKey
      : tab === 'tomorrow' ? tomorrowKey
        : otherDay

  // Pieces already on the van, shared with every crew phone. Held here rather
  // than in a card because the guest cards, the by-item view and the waitlist
  // all tick the same day's list.
  const { packed: packedGear, toggle: togglePiece, setPieces, pending: unsentTicks } = usePackedGear(dayKey, online)

  // Load the transport fleet once — it's the same across every day.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Off the device when the network can't answer; an empty fleet just
      // means rides aren't planned, and logistics still works without them.
      const v = await liveOrStored(
        onlineRef.current,
        fetchVehicles,
        () => snapshotRef.current?.vehicles ?? [],
      )
      if (!cancelled) setVehicles(v)
    })()
    return () => { cancelled = true }
  }, [reconnects, deviceReload])

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
      const { allocations: alloc, rideGroups: rides } = await loadDayTransport(
        dayKey, eventIds, snapshotRef.current, onlineRef.current,
      )
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
      // Without the picker there is no way to reach day three from a boat, so
      // it falls back to the captured list like everything else.
      const days = await liveOrStored(
        onlineRef.current,
        () => fetchUpcomingEventDays(todayKey, dayKeyOffset(todayKey, LOOKAHEAD_DAYS)),
        () => snapshotRef.current?.upcomingDays ?? [],
      )
      if (!cancelled) setUpcomingDays(days)
    })()
    return () => { cancelled = true }
  }, [todayKey, reconnects, deviceReload])

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
    setBoardSource(null)
    ;(async () => {
      // Live when the network can supply it, off this device when it can't.
      // See docs/offline.md — everything below is shape-identical either way.
      const result = await loadDayBoard(dayKey, snapshotRef.current, onlineRef.current)
      if (cancelled) return
      if (!result) { setGroups(null); setBoardSource('unavailable'); return }
      setBoardSource(result.source)
      const { events: uniqueEvents, bookings, duties } = result.data
      if (!uniqueEvents.length) { setGroups([]); return }

      setAddonTitles(new Map(
        result.data.addons.map(a => [a.id, a.display_title || a.admin_title || a.id]),
      ))

      const amendmentsByBookingId = amendmentsByBooking(result.data.amendments)
      const profMap = new Map(result.data.profiles.map(p => [p.id, p]))

      // Per-booking "what's still owed" — the adjusted total (frozen snapshot +
      // the signed amendment ledger, where discounts and surcharges live) minus
      // paid payments and any open credit, mirroring the event page's
      // Amount-owed math so the two never disagree. Amendments are not optional
      // here: apply_credit_to_booking clamps what it draws down to the *amended*
      // balance, so a discounted booking settled with credit would otherwise
      // show a phantom "due" forever. A covered booking keeps its own balance
      // but notes the lead who's responsible for it.
      const paidByBooking = netPaidByBooking(result.data.payments)
      const credits = result.data.credits
      const balByBooking = new Map<string, BookingBalanceRow>()
      for (const b of bookings) {
        const owed = Number((b.details as BookingDetails | undefined)?.total ?? 0)
          + amendmentsDelta(amendmentsByBookingId.get(b.id) ?? [])
        const paid = paidByBooking.get(b.id) ?? 0
        const payerName = (b.payer_id && b.payer_id !== b.user_id)
          ? (personName(profMap.get(b.payer_id)?.name) || lg.leadBooker)
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
      // Alphabetical, so a packer looking for one guest finds them where
      // they'd expect instead of in booking order.
      const byName = (a: DiverGearRow, b: DiverGearRow) =>
        (personName(a.profile?.name) || '').localeCompare(personName(b.profile?.name) || '')

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
        rows: (byEvent.get(ev.id) ?? []).sort(byName),
        staff: staffByEvent.get(ev.id) ?? [],
      })))
    })()
    return () => { cancelled = true }
  }, [dayKey, reconnects, deviceReload])

  // A new saved copy only matters to a board that is not live: one showing the
  // previous copy, one that found nothing, or one still loading with no
  // connection to load from.
  const savedStamp = offline?.snapshot?.capturedAt ?? null
  const lastSavedStamp = useRef(savedStamp)
  useEffect(() => {
    if (savedStamp === lastSavedStamp.current) return
    lastSavedStamp.current = savedStamp
    if (boardSource === 'snapshot' || boardSource === 'unavailable' || (boardSource === null && !online)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeviceReload(k => k + 1)
    }
  }, [savedStamp, boardSource, online])

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
  // Waitlisted divers have no confirmed seat, so their gear and rides are
  // tentative: every prep total is computed from the seated rows, and the
  // waitlist is listed on its own so the shop packs for the boat it has.
  const { seated: seatedRows } = partitionByWaitlist(allRows)
  const piecesFor = new Map<string, PackPiece[]>(
    allRows.map(r => [r.booking.id, guestPieces(r, addonTitles)]),
  )
  const pieces = (r: DiverGearRow) => piecesFor.get(r.booking.id) ?? []
  const dayPack = packProgress(seatedRows.flatMap(pieces), packedGear)
  const packingGuests = seatedRows.filter(r => pieces(r).length > 0)
  const guestsReady = packingGuests.filter(r => {
    const p = packProgress(pieces(r), packedGear)
    return p.packed === p.total
  }).length

  // Headcounts, not booking rows: a diver on two of the day's events is one
  // body to seat, and their most demanding answer wins.
  const transport = transportHeadcount(seatedRows)
  // Day-wide on-duty staff, one entry per person even across several events.
  const dayStaffIds = new Set((groups ?? []).flatMap(g => g.staff).map(s => s.profile?.id ?? s.dutyId))
  const onDutyStaffCount = dayStaffIds.size
  // The day's roster, one entry per person, split by whether they actually
  // get in the water. "How many of them were diving" is the question the
  // shop's insurer asks, so dry-event registrants are not called divers.
  const seatedRoster = dayRoster(
    (groups ?? []).map(g => ({ entersWater: eventEntersWater(g.event), rows: partitionByWaitlist(g.rows).seated })),
    tp.noProfile,
  )
  const dayDiverCount = seatedRoster.filter(p => p.inWater).length
  const dayNonDiverCount = seatedRoster.length - dayDiverCount
  // Divers who still owe — for the whole-day summary and each event's list.
  const currency = (groups ?? [])[0]?.event.currency ?? siteConfig.locale.currency
  const dueRowsFor = (rows: DiverGearRow[]) => rows.flatMap(r => {
    const e = balances.get(r.booking.id)
    if (!e || e.bal.state !== 'due') return []
    return [{
      bookingId: r.booking.id,
      name: personName(r.profile?.name) || tp.noProfile,
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
  // An event the shop drives nobody to (events.has_transport false — a dry
  // course held at the shop) is not part of anybody's run. Left in, its on-duty
  // instructor would count as a rider needing a seat in a car that was never
  // going anywhere, and the board would report the day short of vehicles.
  //
  // Compared against false rather than read as truthy: an offline snapshot
  // taken before this column existed carries no key at all, and treating
  // undefined as "no transport" would empty the rides board instead of
  // degrading to the behavior it had before.
  const runInputs: RunInput[] = buildRuns(
    (groups ?? []).filter(g => g.event.has_transport !== false).map(g => g.event.id),
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
        name: personName(r.profile?.name) || tp.noProfile,
        kind: 'diver',
      }))),
      staff: members.flatMap(g => g.staff.map((s): Rider => ({
        id: s.profile?.id ?? s.dutyId,
        name: personName(s.profile?.name) || lg.staffFallback,
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
  // rather than a per-event slice that would contradict the plan above it.
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
  const banner = (g: EventGroup) => <EventBanner event={g.event} headcount={g.rows.length} isAdmin={isAdmin} />

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
          {/* Jump to the next day that has events, labelled with where it
              lands — "Tomorrow" when that's it, the date otherwise. */}
          {nextEventDay && !promptForDay && (
            <button type="button" onClick={() => goToDay(nextEventDay)} className={`ml-auto ${BTN_XS_GHOST}`}>
              {lg.nextEventDay(nextEventDay === tomorrowKey ? lg.tomorrow : nextEventDay)}
            </button>
          )}
        </div>
        <OfflineBoardStatus offline={offline} source={boardSource} />
      </header>

      {promptForDay ? (
        <p className="text-brand-950 font-medium text-sm">{lg.pickADay}</p>
      ) : boardSource === 'unavailable' ? (
        // The banner above already says why. Rendering "no events scheduled"
        // here would be a confident answer we don't have.
        null
      ) : groups === null ? (
        <PageLoading />
      ) : groups.length === 0 ? (
        <p className="text-brand-950 font-medium text-sm">{lg.noEventsOn(dayKey)}</p>
      ) : (
        <>
          <div role="tablist" aria-label={pk.sectionsAria} className="grid grid-cols-4 gap-1 p-1 rounded-xl border border-white/15 bg-white/5">
            <SectionTab label={pk.gear}
              count={dayPack.total > 0 ? pk.fraction(dayPack.packed, dayPack.total) : null}
              countLabel={pk.dayProgress(dayPack.packed, dayPack.total)}
              done={dayPack.total > 0 && dayPack.packed === dayPack.total}
              active={section === 'gear'} onClick={() => setSection('gear')} />
            <SectionTab label={pk.rides}
              count={transport.needsRide > 0 ? String(transport.needsRide) : null}
              countLabel={pk.rideCount(transport.needsRide)}
              active={section === 'rides'} onClick={() => setSection('rides')} />
            <SectionTab label={pk.people}
              count={String(seatedRoster.length)}
              countLabel={pk.headCount(seatedRoster.length)}
              active={section === 'people'} onClick={() => setSection('people')} />
            <SectionTab label={pk.payments}
              count={dayDue.length > 0 ? String(dayDue.length) : null}
              countLabel={pk.dueCount(dayDue.length)}
              alert={dayDue.length > 0}
              active={section === 'payments'} onClick={() => setSection('payments')} />
          </div>

          {section === 'gear' && (
            <div role="tabpanel" aria-label={pk.gear} className="space-y-4">
              <PackSummary pack={dayPack} ready={guestsReady} guests={packingGuests.length} />
              {dayPack.total > 0 && (
                <div role="radiogroup" aria-label={pk.viewAria} className="flex gap-2">
                  <ViewToggle label={pk.byGuest} active={packView === 'guest'} onClick={() => setPackView('guest')} />
                  <ViewToggle label={pk.byItem}  active={packView === 'item'}  onClick={() => setPackView('item')} />
                </div>
              )}
              {packView === 'guest' || dayPack.total === 0 ? (
                groups.map(g => {
                  const { seated, waitlisted } = partitionByWaitlist(g.rows)
                  return (
                    <section key={g.event.id} className="space-y-2">
                      {banner(g)}
                      {g.rows.length === 0 ? (
                        <p className="text-xs text-brand-950/70 font-medium italic pl-1">{tp.noActiveRegistrants}</p>
                      ) : (
                        <GuestList
                          rows={seated} pieces={pieces} packed={packedGear}
                          onToggle={togglePiece} onSetAll={setPieces}
                          linkToProfile={isAdmin} gearModels={gearModels} onProfilePatched={patchProfile}
                        />
                      )}
                      {waitlisted.length > 0 && (
                        <div className="space-y-2 border-t border-violet-400/30 pt-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-300 pl-1">
                            {pk.waitlistHeading(waitlisted.length)}
                          </h3>
                          <GuestList
                            rows={waitlisted} pieces={pieces} packed={packedGear}
                            onToggle={togglePiece} onSetAll={setPieces}
                            linkToProfile={isAdmin} gearModels={gearModels} onProfilePatched={patchProfile}
                          />
                        </div>
                      )}
                    </section>
                  )
                })
              ) : (
                <ItemPackList
                  guests={seatedRows.map((r): PackGuest => ({
                    bookingId: r.booking.id,
                    name: personName(r.profile?.name) || tp.noProfile,
                    pieces: pieces(r),
                  }))}
                  packed={packedGear}
                  onToggle={togglePiece}
                />
              )}
              {unsentTicks > 0 ? (
                <p role="status" className="text-xs text-amber-300 font-semibold">{pk.unsentTicks(unsentTicks)}</p>
              ) : (
                <p className="text-xs text-brand-100/60 font-medium">{lg.packedHint}</p>
              )}
            </div>
          )}

          {section === 'rides' && (
            <div role="tabpanel" aria-label={pk.rides} className="space-y-4">
              <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
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
                {rideError && <p className="text-sm font-semibold text-red-300">{rideError}</p>}
              </div>
              {groups.map(g => (
                <section key={g.event.id} className="space-y-2">
                  {banner(g)}
                  <EventTransport rows={partitionByWaitlist(g.rows).seated} />
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
                </section>
              ))}
            </div>
          )}

          {section === 'people' && (
            <div role="tabpanel" aria-label={pk.people} className="space-y-4">
              <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-1">
                {/* Heads, not bookings: someone on two of the day's events is
                    one person to brief and count. */}
                <p className="text-sm text-brand-900 font-semibold">
                  {lg.eventsDivers(groups.length, dayDiverCount)}
                  {dayNonDiverCount > 0 && (
                    <> · <span className="text-orange-300">{lg.nonDiverCount(dayNonDiverCount)}</span></>
                  )}
                  {onDutyStaffCount > 0 && <> · {pk.staffCount(onDutyStaffCount)}</>}
                </p>
                {dayNonDiverCount > 0 && <p className="text-xs text-brand-100/70 font-medium">{lg.nonDiverHint}</p>}
              </div>
              {groups.map(g => {
                const { seated, waitlisted } = partitionByWaitlist(g.rows)
                const dry = !eventEntersWater(g.event)
                return (
                  <section key={g.event.id} className="space-y-2">
                    {banner(g)}
                    <StaffDutyGroup rows={g.staff} />
                    {seated.length > 0 && (
                      <div role="group" aria-label={dry ? lg.nonDiversOnDay : lg.diversOnDay} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
                        <h3 className={`text-sm font-bold ${dry ? 'text-orange-300' : 'text-brand-900'}`}>
                          {dry ? lg.nonDiversOnDay : lg.diversOnDay}
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {seated.map(r => (
                            <PersonChip
                              key={r.booking.id}
                              name={personName(r.profile?.name) || tp.noProfile}
                              profileId={r.profile?.id ?? null}
                              linked={isAdmin}
                              className={dry ? NON_DIVER_CHIP : NAME_CHIP}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {waitlisted.length > 0 && (
                      <div role="group" aria-label={pk.waitlist} className="bg-white/70 backdrop-blur-md border border-violet-400/40 rounded-xl p-4 space-y-2">
                        <h3 className="text-sm font-bold text-violet-300">{pk.waitlist}</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {waitlisted.map(r => (
                            <PersonChip
                              key={r.booking.id}
                              name={personName(r.profile?.name) || tp.noProfile}
                              profileId={r.profile?.id ?? null}
                              linked={isAdmin}
                              className={WAITLIST_CHIP}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}

          {section === 'payments' && (
            <div role="tabpanel" aria-label={pk.payments} className="space-y-4">
              <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4">
                {dayOutstanding > 0 ? (
                  <p className="text-sm font-semibold text-red-300">
                    {lg.stillOwe(dayDue.length, currency, dayOutstanding.toLocaleString())}
                  </p>
                ) : (
                  <p className="text-sm text-brand-900 font-medium">{lg.allSettled}</p>
                )}
              </div>
              {/* Money owed regardless of seat, so a waitlisted diver who owes
                  still shows. An event where everyone has settled is left out. */}
              {groups.filter(g => dueRowsFor(g.rows).length > 0).map(g => (
                <section key={g.event.id} className="space-y-2">
                  {banner(g)}
                  <PaymentsDueGroup rows={dueRowsFor(g.rows)} currency={currency} />
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The guests of one event on the pack list. Anyone with something to bring
 * gets a card; everyone else is still named, on one line underneath, so a
 * packer can see they were counted rather than wonder whether they were missed.
 */
function GuestList({ rows, pieces, packed, onToggle, onSetAll, linkToProfile, gearModels, onProfilePatched }: {
  rows: DiverGearRow[]
  pieces: (r: DiverGearRow) => PackPiece[]
  packed: Set<string>
  onToggle: (key: string) => void
  onSetAll: (keys: string[], value: boolean) => void
  linkToProfile: boolean
  gearModels: GearModelWithSizes[]
  onProfilePatched: (diverId: string, patch: Partial<Profile>) => void
}) {
  const withGear = rows.filter(r => pieces(r).length > 0 || gearPackList(r.booking).note)
  const without = rows.filter(r => !withGear.includes(r))
  return (
    <>
      {withGear.map(r => (
        <GuestPackCard
          key={r.booking.id}
          row={r}
          pieces={pieces(r)}
          packed={packed}
          onToggle={onToggle}
          onSetAll={onSetAll}
          linkToProfile={linkToProfile}
          gearModels={gearModels}
          onProfilePatched={onProfilePatched}
        />
      ))}
      {without.length > 0 && (
        <p className="text-sm text-brand-100/70 font-medium pl-1">
          <span className="font-semibold text-brand-100/80">{pk.noGearFor} </span>
          <span className="select-text">{without.map(r => personName(r.profile?.name) || tp.noProfile).join(', ')}</span>
        </p>
      )}
    </>
  )
}

/** The whole day's packing at a glance: pieces on the van, guests finished. */
function PackSummary({ pack, ready, guests }: { pack: { packed: number; total: number }; ready: number; guests: number }) {
  if (pack.total === 0) {
    return (
      <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4">
        <p className="text-sm text-brand-900 font-medium">{lg.nothingToPack}</p>
      </div>
    )
  }
  const done = pack.packed === pack.total
  const pct = Math.round((pack.packed / pack.total) * 100)
  return (
    <div className={`backdrop-blur-md rounded-xl p-4 space-y-2 border ${done ? 'bg-emerald-500/10 border-emerald-400/50' : 'bg-white/70 border-surface-200'}`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className={`text-lg font-bold ${done ? 'text-emerald-200' : 'text-brand-900'}`}>
          {done ? pk.everythingPacked : pk.dayProgress(pack.packed, pack.total)}
        </p>
        <p className="text-sm text-brand-100/70 font-medium">{pk.guestsReady(ready, guests)}</p>
      </div>
      <div
        role="progressbar"
        aria-label={pk.dayProgress(pack.packed, pack.total)}
        aria-valuemin={0}
        aria-valuemax={pack.total}
        aria-valuenow={pack.packed}
        className="h-2.5 rounded-full bg-white/10 overflow-hidden"
      >
        <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * The rack-side view: per item, per size, one toggle per guest. The same ticks
 * as the guest cards — a piece pulled here reads as packed on its guest's card.
 */
function ItemPackList({ guests, packed, onToggle }: {
  guests: PackGuest[]
  packed: Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <ul className="space-y-3">
      {piecesByItem(guests).map(group => {
        const entries = group.sizes.flatMap(s => s.entries)
        const done = entries.filter(e => packed.has(e.key)).length
        const sized = group.sizes.some(s => s.size || s.sizeMissing)
        const care = group.kind === 'care'
        return (
          <li
            key={group.item}
            aria-label={group.item}
            className={`rounded-xl border p-3 space-y-2 backdrop-blur-md ${
              care ? 'bg-amber-500/10 border-amber-400/50' : 'bg-white/70 border-surface-200'
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className={`text-base font-semibold ${care ? 'text-amber-100' : 'text-brand-900'}`}>
                {group.item}
                {care && <span className="text-xs font-medium text-amber-200"> · {gr.handleWithCare}</span>}
              </h3>
              <span className={`text-xs font-semibold ${done === entries.length ? 'text-emerald-300' : 'text-brand-100/70'}`}>
                {done === entries.length ? gc.packedAll : gc.packedSome(done, entries.length)}
              </span>
            </div>
            <ul className="space-y-1.5">
              {group.sizes.map(s => (
                <li key={`${s.size ?? ''}|${s.sizeMissing}`} className="flex items-start gap-2">
                  {sized && (
                    <span className={`w-16 shrink-0 pt-2 text-xs font-semibold break-words ${s.sizeMissing ? 'text-amber-300' : 'text-brand-100/80'}`}>
                      {s.size ?? pk.sizeMissing}
                    </span>
                  )}
                  <ul className="flex flex-wrap gap-1.5 min-w-0">
                    {s.entries.map(e => {
                      const on = packed.has(e.key)
                      const label = s.size ? `${group.item} ${s.size}` : group.item
                      return (
                        <li key={e.key}>
                          <button
                            type="button"
                            onClick={() => onToggle(e.key)}
                            aria-pressed={on}
                            aria-label={on ? gc.unmarkItemPacked(e.name, label) : gc.markItemPacked(e.name, label)}
                            className={`min-h-10 px-3 rounded-full border text-sm transition-colors ${
                              on
                                ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-50 font-semibold'
                                : 'border-white/25 bg-white/5 text-brand-50 font-medium hover:border-white/50'
                            }`}
                          >
                            {on && <span aria-hidden>✓ </span>}{e.name}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

/** One event's banner, the same in every section so a crew always knows which
 *  trip the list under it belongs to. */
function EventBanner({ event, headcount, isAdmin }: { event: AppEvent; headcount: number; isAdmin: boolean }) {
  const dry = !eventEntersWater(event)
  return (
    <div className="bg-brand-900 text-white rounded-xl px-4 py-2.5 space-y-0.5">
      <div className="flex items-start justify-between gap-3">
        {/* The title goes to the event itself, which staff can read too; the
            Edit button goes to the admin-only editor. */}
        <h2 className="text-base font-semibold break-words">
          <Link to={`/admin/events/${event.id}`} className="hover:underline">{event.title}</Link>
        </h2>
        {isAdmin && (
          <Link
            to={`/admin/events/${event.id}/edit`}
            className="shrink-0 text-xs bg-white/15 hover:bg-white/25 text-white px-2.5 py-1 rounded-lg font-medium"
          >
            {t.admin.catalog.edit}
          </Link>
        )}
      </div>
      <span className="block text-xs text-white/80">
        {formatEventSpan(event, { style: 'compact' })}
        {' · '}{dry ? lg.nonDiverCount(headcount) : lg.diverCount(headcount)}
      </span>
      {dry && (
        <span className="inline-block text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border border-orange-300/60 bg-orange-500/20 text-orange-100">
          {lg.dryEventBadge}
        </span>
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

// A phone gives each of the four tabs about 80px, so the tab shows a bare
// number under its label and says the whole phrase to a screen reader.
function SectionTab({ label, count, countLabel, active, done = false, alert = false, onClick }: {
  label: string
  count: string | null
  countLabel: string
  active: boolean
  done?: boolean
  alert?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={count ? `${label}, ${countLabel}` : label}
      onClick={onClick}
      className={`min-h-12 min-w-0 rounded-lg px-0.5 py-1.5 flex flex-col items-center justify-center transition-colors ${
        active ? 'bg-reef-500 text-slate-950' : 'text-brand-50 hover:bg-white/10'
      }`}
    >
      <span className="text-[11px] sm:text-sm font-semibold leading-tight tracking-tight truncate max-w-full">{label}</span>
      {count && (
        <span className={`text-xs font-bold leading-tight truncate max-w-full ${
          active ? 'text-slate-900' : done ? 'text-emerald-300' : alert ? 'text-red-300' : 'text-brand-100/70'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

function ViewToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
        active
          ? 'border-reef-400 bg-reef-500/20 text-reef-100 font-semibold'
          : 'border-white/20 text-brand-50 font-medium hover:bg-white/10'
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
