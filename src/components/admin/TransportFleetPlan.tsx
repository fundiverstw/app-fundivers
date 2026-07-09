import { Link } from 'react-router-dom'
import type { SeatingPlan, CarSeating } from '../../lib/vehicle-planning'
import { t } from '../../i18n'

const tp = t.admin.transport

/**
 * The day's ride plan: the divers who need a ride plus all on-duty staff,
 * bucketed seat by seat into the vehicles that carry them — who rides where and
 * who is left without a seat. Read-only; the fleet is edited under Manage →
 * Vehicles. The caller guards on at least one diver needing a ride.
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
        {tp.noFleetPrefix}{' '}
        <Link to="/admin/vehicles" className="underline">{tp.manageVehiclesLink}</Link> {tp.noFleetSuffix}
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
          {tp.noSeat(plan.unseated.length, plan.unseated.map(r => r.name).join(' · '))}
        </p>
      )}
    </div>
  )
}

// The summary line above the per-car breakdown — red on a genuine seat
// shortfall, blue when everyone's seated.
function Headline({ plan }: { plan: SeatingPlan }) {
  if (!plan.fits) {
    return (
      <p className="text-sm font-semibold text-red-600">
        {tp.fleetShort(plan.shortfall, plan.seats, plan.vehiclesNeeded, plan.riders, plan.divers, plan.staff)}
      </p>
    )
  }

  return (
    <p className="text-sm font-medium text-brand-900">
      {tp.fleetFits(plan.vehiclesNeeded, plan.seats, plan.riders, plan.divers, plan.staff)}
    </p>
  )
}

// One vehicle with the people aboard it.
function CarRow({ car }: { car: CarSeating }) {
  return (
    <li className="text-sm text-brand-900">
      <span className="font-semibold">{car.vehicle.name}</span>
      <span className="text-xs text-brand-950/70 font-medium"> ({car.passengers.length}/{car.vehicle.passenger_seats})</span>
      {car.passengers.length > 0 && (
        <div className="pl-3 text-brand-900/90 font-medium">
          {car.passengers.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' · '}
              {p.name}{p.kind === 'staff' && <span className="text-xs text-brand-950/60">{tp.staffSuffix}</span>}
            </span>
          ))}
        </div>
      )}
    </li>
  )
}
