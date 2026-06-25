import { Link } from 'react-router-dom'
import type { FleetPlan } from '../../lib/vehicle-planning'

const plural = (n: number) => (n === 1 ? '' : 's')

/**
 * The day's ride plan: which vehicles carry everyone who travels in the fleet
 * — the divers who need a ride plus all on-duty staff, one of whom drives each
 * vehicle taken. Read-only; the fleet is edited under Manage → Vehicles. The
 * caller guards on at least one diver needing a ride.
 */
export function TransportFleetPlan({
  plan, fleetSize,
}: {
  plan: FleetPlan
  fleetSize: number
}) {
  if (fleetSize === 0) {
    return (
      <p className="text-sm font-medium text-amber-800">
        No vehicles in the fleet yet — add them under{' '}
        <Link to="/admin/vehicles" className="underline">Manage → Vehicles</Link> to plan rides.
      </p>
    )
  }

  if (plan.reason === 'no-drivers') {
    return (
      <p className="text-sm font-semibold text-red-600">
        No on-duty staff to drive — assign staff to the day before planning rides
        ({plan.divers} diver{plural(plan.divers)} need a ride).
      </p>
    )
  }

  if (!plan.fits) {
    const tail = plan.reason === 'driver-limited'
      ? `only ${plan.staff} on-duty staff to drive ${plan.staff} car${plural(plan.staff)} (one each). Add staff or run a second trip.`
      : 'fleet maxed out. Add a vehicle or run a second trip.'
    return (
      <p className="text-sm font-semibold text-red-600">
        Fleet short by {plan.shortfall} seat{plural(plan.shortfall)} — {plan.seats} seat{plural(plan.seats)} across{' '}
        {plan.driversNeeded} vehicle{plural(plan.driversNeeded)} for {plan.passengers} rider{plural(plan.passengers)}{' '}
        ({plan.divers} diver{plural(plan.divers)} + {plan.ridingStaff} riding staff) — {tail}
      </p>
    )
  }

  const fleetLabel = plan.used.map(v => `${v.name} (${v.passenger_seats})`).join(' + ')
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium text-blue-900">
        Take {plan.driversNeeded} vehicle{plural(plan.driversNeeded)}: {fleetLabel}
        {' '}— {plan.seats} seat{plural(plan.seats)} for {plan.passengers} rider{plural(plan.passengers)}.
      </p>
      <p className="text-xs font-medium text-blue-900/80">
        {plan.divers} diver{plural(plan.divers)} ride · {plan.driversNeeded} of {plan.staff} on-duty staff driving
        {plan.ridingStaff > 0 ? `, ${plan.ridingStaff} riding` : ''}.
      </p>
    </div>
  )
}
