import { Link } from 'react-router-dom'
import type { FleetPlan } from '../../lib/vehicle-planning'

/**
 * The day's ride plan: which vehicles seat the divers who need a ride, and
 * whether there are enough on-duty staff to drive them. Read-only — the fleet
 * itself is edited under Manage → Vehicles. Renders nothing of substance when
 * nobody needs a ride (the caller guards on that).
 */
export function TransportFleetPlan({
  plan, fleetSize, availableDrivers,
}: {
  plan: FleetPlan
  fleetSize: number
  availableDrivers: number
}) {
  if (fleetSize === 0) {
    return (
      <p className="text-sm font-medium text-amber-800">
        No vehicles in the fleet yet — add them under{' '}
        <Link to="/admin/vehicles" className="underline">Manage → Vehicles</Link> to plan rides.
      </p>
    )
  }

  const fleetLabel = plan.used.map(v => `${v.name} (${v.passenger_seats})`).join(' + ')

  if (!plan.fits) {
    return (
      <p className="text-sm font-semibold text-red-600">
        Fleet short by {plan.shortfall} seat{plan.shortfall === 1 ? '' : 's'} — {plan.seats} seat
        {plan.seats === 1 ? '' : 's'} across {fleetSize} vehicle{fleetSize === 1 ? '' : 's'} for {plan.riders} rider
        {plan.riders === 1 ? '' : 's'}. Add a vehicle or run a second trip.
      </p>
    )
  }

  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium text-blue-900">
        Take {plan.driversNeeded} vehicle{plan.driversNeeded === 1 ? '' : 's'}: {fleetLabel}
        {' '}— {plan.seats} seat{plan.seats === 1 ? '' : 's'} for {plan.riders} rider{plan.riders === 1 ? '' : 's'}.
      </p>
      {plan.enoughDrivers ? (
        <p className="text-xs font-medium text-blue-900/80">
          Needs {plan.driversNeeded} driver{plan.driversNeeded === 1 ? '' : 's'} · {availableDrivers} on-duty staff available.
        </p>
      ) : (
        <p className="text-xs font-semibold text-red-600">
          Needs {plan.driversNeeded} drivers but only {availableDrivers} on-duty staff to drive.
        </p>
      )}
    </div>
  )
}
