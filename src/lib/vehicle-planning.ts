// Stateless transport planner for the logistics day view.
//
// The unit of planning is a RUN: the set of events that travel together, which
// an admin curates per day (see event_ride_groups / src/lib/ride-groups.ts). An
// event that shares transport with nobody is a run of one. Everyone on a run
// rides in the cars assigned to that run's events — the divers who asked for a
// ride PLUS all on-duty staff, since the shop has no driver concept and staff
// occupy ordinary seats.
//
// Everything a run counts is counted once, which is the whole point:
//   - a car serving two events of the run contributes its seats once,
//   - a diver booked on two events of the run is one body,
//   - a staff member on duty for two events of the run is one body.
//
// Across runs, nothing is pooled. Two runs that can't share a van must not have
// their slack added together, so the day summary reports each run's own plan and
// flags the impossibilities: one car used by two runs, or one person expected on
// two runs at once. Pure + side-effect-free so it unit-tests without any mocks.

export interface FleetVehicle {
  /** vehicles.id — the identity used to count a shared car once. */
  id: string
  name: string
  /** Physical seats — all available for riders. */
  passenger_seats: number
}

/** A named body travelling in the fleet — a ride-needing diver or on-duty staff. */
export interface Rider {
  /** Stable key (profile id, falling back to a row id) for React + dedup. */
  id: string
  name: string
  kind: 'diver' | 'staff'
}

/** One chosen vehicle with the people aboard it. */
export interface CarSeating {
  vehicle: FleetVehicle
  passengers: Rider[]
}

export interface SeatingPlan {
  /** Vehicles taken, largest-first, each with its passengers. */
  cars: CarSeating[]
  /** Riders with no seat — the ride-less. Empty unless the fleet is too small. */
  unseated: Rider[]
  /** Divers who need a ride. */
  divers: number
  /** On-duty staff (all travel in the fleet). */
  staff: number
  /** Bodies travelling = divers + staff. */
  riders: number
  /** Seats across the chosen vehicles. */
  seats: number
  /** Vehicles taken = cars.length. */
  vehiclesNeeded: number
  /** True when every rider has a seat. */
  fits: boolean
  /** Riders left without a seat (0 when it fits). */
  shortfall: number
}

/**
 * Greedy largest-first: take vehicles (biggest first) until their seats cover
 * everyone travelling. Then names go in — on-duty staff (they run the trip,
 * can't be left behind) fill seats ahead of the divers, and whoever overflows
 * the whole fleet is unseated.
 */
export function planFleet(fleet: FleetVehicle[], divers: Rider[], staff: Rider[]): SeatingPlan {
  const sorted = [...fleet].sort((a, b) => b.passenger_seats - a.passenger_seats)
  const pool = [...staff, ...divers]

  const used: FleetVehicle[] = []
  let seats = 0
  while (used.length < sorted.length && seats < pool.length) {
    const next = sorted[used.length]
    used.push(next)
    seats += next.passenger_seats
  }

  let filled = 0
  const cars = used.map((vehicle) => {
    const passengers = pool.slice(filled, filled + vehicle.passenger_seats)
    filled += passengers.length
    return { vehicle, passengers }
  })
  const unseated = pool.slice(filled)

  return {
    cars,
    unseated,
    divers: divers.length,
    staff: staff.length,
    riders: pool.length,
    seats,
    vehiclesNeeded: used.length,
    fits: unseated.length === 0,
    shortfall: unseated.length,
  }
}

/** An event travelling on a run, for labelling the run in the UI. */
export interface RunEventRef {
  id: string
  title: string
}

/** One run's raw inputs. Duplicates are expected and removed by planRuns. */
export interface RunInput {
  /** Stable key — the ride group's id, or `event:<id>` for a lone event. */
  key: string
  events: RunEventRef[]
  /** Ride-needing divers across the run's events. */
  divers: Rider[]
  /** On-duty staff across the run's events. */
  staff: Rider[]
  /** Cars assigned to any of the run's events. */
  fleet: FleetVehicle[]
}

export interface RunPlan extends SeatingPlan {
  key: string
  events: RunEventRef[]
  /** True when more than one event travels on this run. */
  shared: boolean
  /** Cars assigned to the run that the bodies travelling don't need. */
  spare: FleetVehicle[]
  /** Seats across every car assigned to the run, needed or not (`seats` counts
   *  only the cars the plan actually takes). A car on two of the run's events
   *  is counted once. */
  fleetSeats: number
}

/**
 * Something the plan can't physically do. `runKeys` are the RunPlan keys
 * involved, so the caller can name them however it labels runs.
 */
export interface RideConflict {
  kind: 'car' | 'staff' | 'diver'
  name: string
  runKeys: string[]
}

export interface DayRidePlan {
  runs: RunPlan[]
  /** Distinct ride-needing divers across the day — a diver on two events is one. */
  divers: number
  /** Distinct on-duty staff across the day. */
  staff: number
  /** Distinct bodies travelling = divers + staff. */
  riders: number
  /** Seats across the distinct cars taken (a car used by two runs counts once). */
  seats: number
  /** Distinct cars taken. */
  cars: number
  /** Riders left without a seat, summed over the runs. */
  shortfall: number
  /** True when every run seats everyone. */
  fits: boolean
  conflicts: RideConflict[]
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true)))
}

/**
 * Plan every run of a day and roll them up.
 *
 * Within a run, duplicate divers / staff / cars collapse to one, and anyone
 * on duty is counted as staff even if they're also booked as a diver — one
 * body, one seat. Across runs, counts stay separate but the day's totals
 * de-duplicate people and cars so the summary is a headcount rather than a
 * sum of rows.
 */
export function planRuns(inputs: RunInput[]): DayRidePlan {
  const runs: RunPlan[] = inputs.map(input => {
    const staff = dedupeById(input.staff)
    const staffIds = new Set(staff.map(s => s.id))
    // On duty wins: someone working the trip needs one seat, not two.
    const divers = dedupeById(input.divers).filter(d => !staffIds.has(d.id))
    const fleet = dedupeById(input.fleet)
    const plan = planFleet(fleet, divers, staff)
    const usedIds = new Set(plan.cars.map(c => c.vehicle.id))
    return {
      ...plan,
      key: input.key,
      events: input.events,
      shared: input.events.length > 1,
      spare: fleet.filter(v => !usedIds.has(v.id)),
      fleetSeats: fleet.reduce((s, v) => s + v.passenger_seats, 0),
    }
  })

  // Day totals count each person and each car once, however many runs or
  // events they appear on. Staff take precedence over a diver row for the
  // same person, matching the per-run rule above.
  const staffIds = new Set(runs.flatMap(r => r.cars.flatMap(c => c.passengers).concat(r.unseated))
    .filter(p => p.kind === 'staff').map(p => p.id))
  const diverIds = new Set<string>()
  for (const r of runs) {
    for (const p of [...r.cars.flatMap(c => c.passengers), ...r.unseated]) {
      if (p.kind === 'diver' && !staffIds.has(p.id)) diverIds.add(p.id)
    }
  }
  const carsTaken = dedupeById(runs.flatMap(r => r.cars.map(c => c.vehicle)))

  return {
    runs,
    divers: diverIds.size,
    staff: staffIds.size,
    riders: diverIds.size + staffIds.size,
    seats: carsTaken.reduce((s, v) => s + v.passenger_seats, 0),
    cars: carsTaken.length,
    shortfall: runs.reduce((s, r) => s + r.shortfall, 0),
    fits: runs.every(r => r.fits),
    conflicts: findConflicts(runs),
  }
}

/**
 * What the day's runs ask for that can't happen. A car is only in conflict when
 * two runs actually *take* it — a car sitting spare on one run and driven on
 * another is fine, and flagging that would bury the real errors in noise.
 */
function findConflicts(runs: RunPlan[]): RideConflict[] {
  const out: RideConflict[] = []

  const collect = (
    kind: RideConflict['kind'],
    per: (r: RunPlan) => Array<{ id: string; name: string }>,
  ) => {
    const byId = new Map<string, { name: string; runKeys: string[] }>()
    for (const r of runs) {
      for (const item of dedupeById(per(r))) {
        const hit = byId.get(item.id)
        if (hit) hit.runKeys.push(r.key)
        else byId.set(item.id, { name: item.name, runKeys: [r.key] })
      }
    }
    for (const { name, runKeys } of byId.values()) {
      if (runKeys.length > 1) out.push({ kind, name, runKeys })
    }
  }

  collect('car', r => r.cars.map(c => c.vehicle))
  collect('staff', r => [...r.cars.flatMap(c => c.passengers), ...r.unseated].filter(p => p.kind === 'staff'))
  collect('diver', r => [...r.cars.flatMap(c => c.passengers), ...r.unseated].filter(p => p.kind === 'diver'))

  return out
}
