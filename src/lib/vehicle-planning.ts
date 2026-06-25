// Stateless transport-capacity planner for the logistics day view. Everyone on
// the trip rides in the shop fleet: the divers who need a ride PLUS all on-duty
// staff. One staff member drives each vehicle taken; the rest of the staff are
// passengers alongside the divers. So a vehicle's `passenger_seats` (which
// excludes its driver) must cover divers + non-driving staff. Pure +
// side-effect-free so it unit-tests without any mocks.

export interface FleetVehicle {
  name: string
  /** Passenger seats EXCLUDING the driver. */
  passenger_seats: number
}

/** Why the fleet can't seat everyone, when it can't. */
export type FleetShortReason = 'no-drivers' | 'driver-limited' | 'fleet-limited'

export interface FleetPlan {
  /** Divers who need a ride. */
  divers: number
  /** On-duty staff — all travel in the fleet (one drives each vehicle used). */
  staff: number
  /** Vehicles chosen (largest-first). */
  used: FleetVehicle[]
  /** Sum of passenger seats across the chosen vehicles. */
  seats: number
  /** One staff driver per chosen vehicle. */
  driversNeeded: number
  /** Staff not driving — they need a passenger seat too. */
  ridingStaff: number
  /** Bodies needing a passenger seat = divers + ridingStaff. */
  passengers: number
  /** True when the chosen vehicles seat every passenger. */
  fits: boolean
  /** Passengers left without a seat (0 when it fits). */
  shortfall: number
  /** Why it doesn't fit, or null when it does. */
  reason: FleetShortReason | null
}

/**
 * Greedy largest-first: add vehicles (biggest first) until their passenger
 * seats cover everyone who isn't driving. Each vehicle added turns one more
 * staff member into a driver, so the seat demand — divers + the staff still
 * riding — shrinks by one as the fleet grows; we recompute it each step. The
 * fleet can't field more vehicles than there are staff to drive them, so when
 * the driver cap (or the fleet) runs out before everyone's seated, the
 * shortfall is surfaced with the reason it's blocked.
 */
export function planFleet(divers: number, staff: number, fleet: FleetVehicle[]): FleetPlan {
  const sorted = [...fleet].sort((a, b) => b.passenger_seats - a.passenger_seats)
  const maxDrivers = Math.min(staff, sorted.length)

  // Passengers needing a seat once `drivers` staff are behind the wheel.
  const passengersFor = (drivers: number) => divers + (staff - drivers)

  const used: FleetVehicle[] = []
  let seats = 0
  while (used.length < maxDrivers && seats < passengersFor(used.length)) {
    const next = sorted[used.length]
    used.push(next)
    seats += next.passenger_seats
  }

  const driversNeeded = used.length
  const ridingStaff = Math.max(0, staff - driversNeeded)
  const passengers = divers + ridingStaff
  const fits = seats >= passengers
  const shortfall = fits ? 0 : passengers - seats

  // no-drivers: nobody to drive. driver-limited: every staff is already driving
  // but vehicles sit spare. fleet-limited: out of vehicles.
  let reason: FleetShortReason | null = null
  if (!fits) {
    if (staff === 0) reason = 'no-drivers'
    else if (driversNeeded === staff && driversNeeded < sorted.length) reason = 'driver-limited'
    else reason = 'fleet-limited'
  }

  return { divers, staff, used, seats, driversNeeded, ridingStaff, passengers, fits, shortfall, reason }
}
