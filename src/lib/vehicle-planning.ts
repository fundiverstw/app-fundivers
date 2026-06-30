// Stateless transport planner for the logistics day view. Everyone on the trip
// rides in the shop fleet: the divers who need a ride PLUS all on-duty staff.
// One staff member drives each vehicle taken; the rest of the staff are
// passengers alongside the divers. So a vehicle's `passenger_seats` (which
// excludes its driver) must cover divers + non-driving staff.
//
// Seating is driver-agnostic: riders are bucketed into the fewest largest
// vehicles that hold them, whether or not enough staff are on duty to drive. A
// vehicle with no on-duty staff to drive it still shows its riders, flagged so
// the admin knows to assign a driver. Only a genuine seat shortfall — more
// riders than the whole fleet can hold — leaves anyone ride-less. Pure +
// side-effect-free so it unit-tests without any mocks.

export interface FleetVehicle {
  name: string
  /** Passenger seats EXCLUDING the driver. */
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
  /** The on-duty staff member driving, or null when none is left to drive it. */
  driver: Rider | null
  passengers: Rider[]
}

export interface SeatingPlan {
  /** Vehicles taken, largest-first, each with its driver + passengers. */
  cars: CarSeating[]
  /** Riders with no seat — the ride-less. Empty unless the fleet is too small. */
  unseated: Rider[]
  /** Divers who need a ride. */
  divers: number
  /** On-duty staff (all travel in the fleet). */
  staff: number
  /** Bodies travelling = divers + staff. */
  riders: number
  /** Passenger seats across the chosen vehicles. */
  seats: number
  /** Vehicles taken = cars.length. */
  driversNeeded: number
  /** Vehicles with no on-duty staff to drive them (= max(0, cars − staff)). */
  driversShort: number
  /** True when every rider has a seat. */
  fits: boolean
  /** Riders left without a seat (0 when it fits). */
  shortfall: number
}

/**
 * Greedy largest-first: take vehicles (biggest first) until their passenger
 * seats cover everyone who isn't driving. Each vehicle taken turns one more
 * staff member into a driver — until staff run out, after which extra vehicles
 * carry passengers but have no driver yet — so the seat demand shrinks by one
 * per vehicle while staff last. We recompute it each step. Then names go in:
 * one staff drives each vehicle (as far as staff go), and the non-driving staff
 * (they run the trip, can't be left behind) fill seats ahead of the divers.
 * Whoever overflows the whole fleet is unseated.
 */
export function planFleet(fleet: FleetVehicle[], divers: Rider[], staff: Rider[]): SeatingPlan {
  const sorted = [...fleet].sort((a, b) => b.passenger_seats - a.passenger_seats)

  // Passengers needing a seat once `cars` vehicles are taken: divers plus the
  // staff not yet behind a wheel (each car claims one staff driver, while staff
  // last).
  const passengersFor = (cars: number) => divers.length + Math.max(0, staff.length - cars)

  const used: FleetVehicle[] = []
  let seats = 0
  while (used.length < sorted.length && seats < passengersFor(used.length)) {
    const next = sorted[used.length]
    used.push(next)
    seats += next.passenger_seats
  }

  const drivers = staff.slice(0, used.length)
  const pool = [...staff.slice(used.length), ...divers]
  let filled = 0
  const cars = used.map((vehicle, idx) => {
    const passengers = pool.slice(filled, filled + vehicle.passenger_seats)
    filled += passengers.length
    return { vehicle, driver: drivers[idx] ?? null, passengers }
  })
  const unseated = pool.slice(filled)

  const riders = divers.length + staff.length
  return {
    cars,
    unseated,
    divers: divers.length,
    staff: staff.length,
    riders,
    seats,
    driversNeeded: used.length,
    driversShort: Math.max(0, used.length - staff.length),
    fits: unseated.length === 0,
    shortfall: unseated.length,
  }
}
