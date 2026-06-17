import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EventDetails } from './EventDetails'
import type { EventDetails as EventDetailsData } from '../../types/database'

const empty: EventDetailsData = {
  description: null, included: null, not_included: null, schedule: null,
  transportation: null, prerequisites: null, required_cert: null, required_dives: null,
}

describe('EventDetails', () => {
  it('renders only the sections that have content', () => {
    render(<EventDetails details={{
      ...empty,
      description: 'A relaxed shore dive.',
      included: 'Tanks and weights',
    }} />)
    expect(screen.getByText('About this event')).toBeInTheDocument()
    expect(screen.getByText('A relaxed shore dive.')).toBeInTheDocument()
    expect(screen.getByText("What's included")).toBeInTheDocument()
    expect(screen.getByText('Tanks and weights')).toBeInTheDocument()
    expect(screen.queryByText('Schedule / itinerary')).not.toBeInTheDocument()
    expect(screen.queryByText('Prerequisites')).not.toBeInTheDocument()
  })

  it('folds cert, logged dives, and free-text prereqs into one Prerequisites block', () => {
    render(<EventDetails details={{
      ...empty,
      required_cert: 'AOW',
      required_dives: 20,
      prerequisites: 'Comfortable in current.',
    }} />)
    expect(screen.getByText('Prerequisites')).toBeInTheDocument()
    expect(screen.getByText('Minimum certification: AOW')).toBeInTheDocument()
    expect(screen.getByText('Logged dives: 20+')).toBeInTheDocument()
    expect(screen.getByText('Comfortable in current.')).toBeInTheDocument()
  })

  it('shows the prerequisites block when only a cert requirement is set', () => {
    render(<EventDetails details={{ ...empty, required_cert: 'OW' }} />)
    expect(screen.getByText('Prerequisites')).toBeInTheDocument()
    expect(screen.getByText('Minimum certification: OW')).toBeInTheDocument()
    expect(screen.queryByText(/Logged dives/)).not.toBeInTheDocument()
  })
})
