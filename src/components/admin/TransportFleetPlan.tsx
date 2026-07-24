import { Link } from 'react-router-dom'
import type { CarSeating, DayRidePlan, RideConflict, RunPlan } from '../../lib/vehicle-planning'
import { t } from '../../i18n'

const tp = t.admin.transport

/**
 * The day's ride plan, one block per RUN — the set of events travelling
 * together. Each run seats its own riders (divers who asked for a ride plus all
 * on-duty staff) in the cars assigned to its events, and nothing is pooled
 * across runs: two runs heading for different sites can't lend each other a
 * seat. Read-only; the fleet is edited under Manage → Vehicles and the grouping
 * by the picker beneath this.
 */
export function TransportFleetPlan({
  plan, fleetSize,
}: {
  plan: DayRidePlan
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

  // A run with nobody aboard needs no plan — an event where every diver drives
  // themselves and no staff are on duty.
  const runs = plan.runs.filter(r => r.riders > 0)
  const multi = runs.length > 1
  const labels = new Map(plan.runs.map(r => [r.key, runLabel(r)]))

  return (
    <div className="space-y-2">
      {multi && (
        <p className="text-sm font-semibold text-brand-900">
          {tp.dayRuns(runs.length, plan.riders, plan.divers, plan.staff)}
        </p>
      )}
      {runs.map(run => <RunBlock key={run.key} run={run} showLabel={multi} />)}
      {plan.conflicts.length > 0 && (
        <ul className="space-y-0.5">
          {plan.conflicts.map((c, i) => (
            <li key={i} className="text-sm font-semibold text-red-600">
              {conflictText(c, c.runKeys.map(k => labels.get(k) ?? k).join(' / '))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Every event travelling on the run, so a shared run says whose it is. */
function runLabel(run: RunPlan): string {
  return run.events.map(e => e.title).join(tp.runJoin)
}

function conflictText(c: RideConflict, runs: string): string {
  if (c.kind === 'car') return tp.conflictCar(c.name, runs)
  if (c.kind === 'staff') return tp.conflictStaff(c.name, runs)
  return tp.conflictDiver(c.name, runs)
}

function RunBlock({ run, showLabel }: { run: RunPlan; showLabel: boolean }) {
  return (
    <div className="space-y-1">
      {showLabel && (
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-900/80">{runLabel(run)}</p>
      )}
      <Headline run={run} />
      {run.cars.length > 0 && (
        <ul className="space-y-1">
          {run.cars.map(c => <CarRow key={c.vehicle.id} car={c} />)}
        </ul>
      )}
      {/* With no car at all the headline already says nobody has a ride;
          repeating every name here would just double the red text. */}
      {run.unseated.length > 0 && run.seats > 0 && (
        <p className="text-sm font-semibold text-red-600">
          {tp.noSeat(run.unseated.length, run.unseated.map(r => r.name).join(' · '))}
        </p>
      )}
      {run.spare.length > 0 && (
        <p className="text-xs text-brand-950/70 font-medium">
          {tp.spareCars(run.spare.map(v => v.name).join(' · '))}
        </p>
      )}
    </div>
  )
}

// The summary line above the per-car breakdown — red when riders are left
// standing, blue when everyone's seated.
function Headline({ run }: { run: RunPlan }) {
  if (run.seats === 0) {
    return (
      <p className="text-sm font-semibold text-red-600">
        {tp.runNoCar(run.riders, run.divers, run.staff)}
      </p>
    )
  }
  if (!run.fits) {
    return (
      <p className="text-sm font-semibold text-red-600">
        {tp.fleetShort(run.shortfall, run.seats, run.vehiclesNeeded, run.riders, run.divers, run.staff)}
      </p>
    )
  }
  return (
    <p className="text-sm font-medium text-brand-900">
      {tp.fleetFits(run.vehiclesNeeded, run.seats, run.riders, run.divers, run.staff)}
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
