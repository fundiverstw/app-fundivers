import { Link } from 'react-router-dom'
import type { SeatingPlan, CarSeating } from '../../lib/vehicle-planning'

const plural = (n: number) => (n === 1 ? '' : 's')

/**
 * The day's ride plan: the divers who need a ride plus all on-duty staff,
 * bucketed seat by seat into the vehicles that carry them — who drives each,
 * who rides where, which vehicles still need a driver, and who is left without
 * a seat. Read-only; the fleet is edited under Manage → Vehicles. The caller
 * guards on at least one diver needing a ride.
 */
export function TransportFleetPlan({
  plan, fleetSize,
}: {
  plan: SeatingPlan
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

  return (
    <div className="space-y-1.5">
      <Headline plan={plan} />
      {plan.cars.length > 0 && (
        <ul className="space-y-1">
          {plan.cars.map((c, i) => <CarRow key={i} car={c} />)}
        </ul>
      )}
      {plan.unseated.length > 0 && (
        <p className="text-sm font-semibold text-red-600">
          No seat ({plan.unseated.length}):{' '}
          <span className="font-medium">{plan.unseated.map(r => r.name).join(' · ')}</span>
        </p>
      )}
    </div>
  )
}

// The summary line above the per-car breakdown — red on a genuine seat
// shortfall, amber when seats exist but a vehicle still has no driver, blue
// when everyone's seated and every vehicle has someone to drive it.
function Headline({ plan }: { plan: SeatingPlan }) {
  if (!plan.fits) {
    return (
      <p className="text-sm font-semibold text-red-600">
        Fleet short by {plan.shortfall} seat{plural(plan.shortfall)} — {plan.seats} seat{plural(plan.seats)} across{' '}
        {plan.driversNeeded} vehicle{plural(plan.driversNeeded)} for {plan.riders} rider{plural(plan.riders)}{' '}
        ({plan.divers} diver{plural(plan.divers)} + {plan.staff} staff). Add a vehicle or run a second trip.
      </p>
    )
  }

  if (plan.driversShort > 0) {
    return (
      <p className="text-sm font-semibold text-amber-700">
        {plan.driversNeeded} vehicle{plural(plan.driversNeeded)} seat{plan.driversNeeded === 1 ? 's' : ''} all{' '}
        {plan.riders} rider{plural(plan.riders)}, but {plan.driversShort} still need{plan.driversShort === 1 ? 's' : ''} a driver
        {' '}— assign on-duty staff to the day.
      </p>
    )
  }

  const ridingStaff = plan.staff - plan.driversNeeded
  return (
    <p className="text-sm font-medium text-brand-900">
      Take {plan.driversNeeded} vehicle{plural(plan.driversNeeded)} — {plan.seats} seat{plural(plan.seats)} for{' '}
      {plan.riders} rider{plural(plan.riders)} ({plan.divers} diver{plural(plan.divers)} ride · {plan.driversNeeded} of{' '}
      {plan.staff} on-duty staff driving{ridingStaff > 0 ? `, ${ridingStaff} riding` : ''}).
    </p>
  )
}

// One vehicle with its driver and the people aboard it.
function CarRow({ car }: { car: CarSeating }) {
  return (
    <li className="text-sm text-brand-900">
      <span className="font-semibold">{car.vehicle.name}</span>
      <span className="text-xs text-brand-950/70 font-medium"> ({car.passengers.length}/{car.vehicle.passenger_seats})</span>
      {car.driver
        ? <> — <span className="font-medium">{car.driver.name}</span> driving</>
        : <> — <span className="font-semibold text-amber-700">needs a driver</span></>}
      {car.passengers.length > 0 && (
        <div className="pl-3 text-brand-900/90 font-medium">
          {car.passengers.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' · '}
              {p.name}{p.kind === 'staff' && <span className="text-xs text-brand-950/60"> (staff)</span>}
            </span>
          ))}
        </div>
      )}
    </li>
  )
}
