import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AddToGoogleCalendarButton } from './AddToGoogleCalendarButton'
import type { CalendarLinkEvent } from '../lib/google-calendar'

vi.mock('../lib/google-calendar', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/google-calendar')>()),
  googleCalendarUrl: () => 'https://calendar.google.com/calendar/render?action=TEMPLATE',
}))

const event: CalendarLinkEvent = {
  id: 'evt-1',
  type: 'dive',
  title: 'Longdong shore dive',
  start_time: '2026-08-08T23:00:00.000Z',
  end_time: null,
  start_time_hhmm: '07:00',
  details: null,
}

describe('AddToGoogleCalendarButton', () => {
  it('links to the event template in a new tab', () => {
    render(<AddToGoogleCalendarButton event={event} />)

    const link = screen.getByRole('link', { name: /google calendar/i })
    expect(link).toHaveAttribute('href', 'https://calendar.google.com/calendar/render?action=TEMPLATE')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('accepts a caller-supplied label and class', () => {
    render(<AddToGoogleCalendarButton event={event} label="Save the date" className="w-full" />)

    const link = screen.getByRole('link', { name: 'Save the date' })
    expect(link).toHaveClass('w-full')
  })
})
