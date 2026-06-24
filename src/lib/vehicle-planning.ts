// Stateless transport-capacity planner for the logistics day view. Given the
// number of divers who need a ride and the shop's fleet, work out the fewest
// vehicles that seat everyone — and whether there are enough on-duty staff to
// drive them. Pure + side-effect-free so it unit-tests without any mocks.

export interface FleetVehicle {
  name: string
  /** Passenger seats EXCLUDING the driver. */
  passenger_seats: number
}

export interface FleetPlan {
  /** Riders to seat (divers who need a ride). */
  riders: number
  /** Vehicles chosen (largest-first) to seat the riders. */
  used: FleetVehicle[]
  /** Sum of passenger seats across the chosen vehicles. */
  seats: number
  /** True when the fleet can seat every rider. */
  fits: boolean
  /** Riders left without a seat (0 when it fits). */
  shortfall: number
  /** One staff driver per chosen vehicle. */
  driversNeeded: number
  /** True when on-duty staff cover every chosen vehicle's driver. */
  enoughDrivers: boolean
}

/**
 * Greedy largest-first: pack riders into the fewest vehicles, which also
 * minimises drivers needed. Each vehicle carries `passenger_seats` riders; the
 * driver (a staff member) sits separately and never counts as a seat. When the
 * whole fleet still can't seat everyone, every vehicle is in play and the
 * shortfall is surfaced for the admin to solve (extra trip, borrowed van, …).
 */
export function planFleet(riders: number, fleet: FleetVehicle[], availableDrivers: number): FleetPlan {
  const sorted = [...fleet].sort((a, b) => b.passenger_seats - a.passenger_seats)
  const fleetSeats = sorted.reduce((s, v) => s + v.passenger_seats, 0)

  const chosen: FleetVehicle[] = []
  let seats = 0
  for (const v of sorted) {
    if (seats >= riders) break
    chosen.push(v)
    seats += v.passenger_seats
  }

  const fits = seats >= riders
  const used = fits ? chosen : sorted
  const usedSeats = fits ? seats : fleetSeats
  const driversNeeded = used.length

  return {
    riders,
    used,
    seats: usedSeats,
    fits,
    shortfall: fits ? 0 : riders - fleetSeats,
    driversNeeded,
    enoughDrivers: driversNeeded <= availableDrivers,
  }
}
