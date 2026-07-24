import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TransportFleetPlan } from './TransportFleetPlan'
import { planRuns, type RunInput } from '../../lib/vehicle-planning'

const run = (over: Partial<RunInput> & { key: string }): RunInput => ({
  events: [{ id: over.key, title: over.key }],
  divers: [],
  staff: [],
  fleet: [],
  ...over,
})

const diver = (name: string) => ({ id: name, name, kind: 'diver' as const })
const staff = (name: string) => ({ id: name, name, kind: 'staff' as const })

function show(inputs: RunInput[], fleetSize = 2) {
  return render(
    <MemoryRouter>
      <TransportFleetPlan plan={planRuns(inputs)} fleetSize={fleetSize} />
    </MemoryRouter>,
  )
}

describe('TransportFleetPlan', () => {
  it('points at the fleet page when the shop has no vehicles', () => {
    show([], 0)
    expect(screen.getByText(/No vehicles in the fleet yet/i)).toBeInTheDocument()
  })

  it('shows one plan with no run label when the day has a single run', () => {
    show([run({
      key: 'event:e1',
      events: [{ id: 'e1', title: 'Bat Cave' }],
      divers: [diver('Ada')],
      staff: [staff('Billy')],
      fleet: [{ id: 'v1', name: 'Delica', passenger_seats: 8 }],
    })])
    expect(screen.getByText(/Take 1 vehicle — 8 seats for 2 riders/i)).toBeInTheDocument()
    expect(screen.queryByText('Bat Cave')).not.toBeInTheDocument()
    expect(screen.queryByText(/separate run/i)).not.toBeInTheDocument()
  })

  it('labels each run by the events aboard it once there is more than one', () => {
    show([
      run({
        key: 'group:g1',
        events: [{ id: 'e1', title: 'Bat Cave' }, { id: 'e2', title: 'Refresher' }],
        divers: [diver('Ada')],
        fleet: [{ id: 'v1', name: 'Delica', passenger_seats: 8 }],
      }),
      run({
        key: 'event:e3',
        events: [{ id: 'e3', title: 'Green Island' }],
        divers: [diver('Bo')],
        fleet: [{ id: 'v2', name: 'Bus', passenger_seats: 12 }],
      }),
    ])
    expect(screen.getByText('2 separate runs · 2 riders (2 divers)')).toBeInTheDocument()
    expect(screen.getByText('Bat Cave + Refresher')).toBeInTheDocument()
    expect(screen.getByText('Green Island')).toBeInTheDocument()
  })

  it('skips runs where nobody needs moving', () => {
    show([
      run({ key: 'event:e1', events: [{ id: 'e1', title: 'Bat Cave' }], divers: [diver('Ada')], fleet: [{ id: 'v1', name: 'Delica', passenger_seats: 8 }] }),
      run({ key: 'event:e2', events: [{ id: 'e2', title: 'Pool session' }] }),
    ])
    // One run has riders, so no run labels and no day line.
    expect(screen.queryByText(/separate run/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Pool session')).not.toBeInTheDocument()
  })

  it('names the cars a run does not need', () => {
    show([run({
      key: 'event:e1',
      divers: [diver('Ada')],
      fleet: [
        { id: 'v1', name: 'Delica', passenger_seats: 8 },
        { id: 'v2', name: "Mike's van", passenger_seats: 5 },
      ],
    })])
    expect(screen.getByText(/Not needed: Mike's van/)).toBeInTheDocument()
  })

  it('says nobody has a ride when a run has riders but no car', () => {
    show([run({ key: 'event:e1', divers: [diver('Ada'), diver('Bo')] })])
    expect(screen.getByText(/No car assigned — 2 riders \(2 divers\) with no ride/i)).toBeInTheDocument()
    // The per-name list is suppressed — the headline already covers everyone.
    expect(screen.queryByText(/No seat/i)).not.toBeInTheDocument()
  })

  it('names who is left standing when the run has a car but too few seats', () => {
    show([run({
      key: 'event:e1',
      divers: [diver('Ada'), diver('Bo'), diver('Cy')],
      fleet: [{ id: 'v1', name: 'Veryca', passenger_seats: 1 }],
    })])
    expect(screen.getByText(/Fleet short by 2 seats/i)).toBeInTheDocument()
    expect(screen.getByText(/No seat \(2\): Bo · Cy/)).toBeInTheDocument()
  })

  it('flags a car and a person claimed by two runs, naming the runs', () => {
    const shared = { id: 'v1', name: 'Delica', passenger_seats: 8 }
    show([
      run({ key: 'event:e1', events: [{ id: 'e1', title: 'Bat Cave' }], divers: [diver('Ada')], staff: [staff('Billy')], fleet: [shared] }),
      run({ key: 'event:e2', events: [{ id: 'e2', title: 'Refresher' }], divers: [diver('Ada')], staff: [staff('Billy')], fleet: [shared] }),
    ])
    expect(screen.getByText(/Delica is taken by two separate runs \(Bat Cave \/ Refresher\)/)).toBeInTheDocument()
    expect(screen.getByText(/Billy is on duty on two separate runs/)).toBeInTheDocument()
    expect(screen.getByText(/Ada needs a ride on two separate runs/)).toBeInTheDocument()
  })
})
