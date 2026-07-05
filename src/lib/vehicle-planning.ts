// Stateless transport planner for the logistics day view. Everyone on the trip
// rides in the shop fleet: the divers who need a ride PLUS all on-duty staff.
// Riders are bucketed into the fewest largest vehicles that hold them. Only a
// genuine seat shortfall — more riders than the whole fleet can hold — leaves
// anyone ride-less. Pure + side-effect-free so it unit-tests without any mocks.

export interface FleetVehicle {
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
