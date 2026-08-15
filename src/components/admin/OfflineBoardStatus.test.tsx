import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format } from 'date-fns'
import { OfflineBoardStatus } from './OfflineBoardStatus'
import type { OfflineContextValue } from '../../hooks/offline-context'
import { SNAPSHOT_VERSION, OFFLINE_DAYS, type OfflineSnapshot } from '../../lib/offline-snapshot'
import { t } from '../../i18n'

const lo = t.admin.logistics.offline

const snapshot = (capturedAt: string): OfflineSnapshot => ({
  version: SNAPSHOT_VERSION,
  userId: 'u1',
  capturedAt,
  days: [],
  upcomingDays: [],
  vehicles: [],
  gearModels: [],
  boards: {},
  transport: {},
})

const ctx = (over: Partial<OfflineContextValue> = {}): OfflineContextValue => ({
  snapshot: null,
  status: 'synced',
  online: true,
  refresh: vi.fn(),
  ...over,
})

describe('OfflineBoardStatus', () => {
  it('renders nothing on a diver page, where there is no provider', () => {
    const { container } = render(<OfflineBoardStatus offline={null} source="live" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays quiet on a live board — one dim line and a save button', () => {
    render(<OfflineBoardStatus offline={ctx({ snapshot: snapshot('2026-08-15T07:14:00Z') })} source="live" />)
    expect(screen.getByRole('button', { name: lo.saveNow })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // A board read hours ago and one read just now are otherwise identical on
  // screen, and staff act on the difference.
  it('announces a board served off the device, with when it was captured', () => {
    render(<OfflineBoardStatus offline={ctx({ snapshot: snapshot('2026-08-15T07:14:00Z'), online: false })} source="snapshot" />)
    const panel = screen.getByRole('status')
    expect(panel).toHaveTextContent(/no connection/i)
    // Rendered in the reader's own time, not UTC — the stamp is for someone
    // standing on a dock deciding whether to trust the roster in front of them.
    expect(panel).toHaveTextContent(format(new Date('2026-08-15T07:14:00Z'), 'HH:mm'))
  })

  // "Saved at 07:14" on a board last online yesterday reads as this morning.
  it('carries the date as well as the time', () => {
    render(<OfflineBoardStatus offline={ctx({ snapshot: snapshot('2026-08-15T07:14:00Z'), online: false })} source="snapshot" />)
    expect(screen.getByRole('status')).toHaveTextContent(/Aug 15/)
  })

  it('shows the raw value rather than "Invalid Date" if the stamp is corrupt', () => {
    render(<OfflineBoardStatus offline={ctx({ snapshot: snapshot('not-a-date'), online: false })} source="snapshot" />)
    expect(screen.getByRole('status')).toHaveTextContent('not-a-date')
  })

  it('says which fields were deliberately left off the device', () => {
    render(<OfflineBoardStatus offline={ctx({ snapshot: snapshot('2026-08-15T07:14:00Z'), online: false })} source="snapshot" />)
    expect(screen.getByRole('status')).toHaveTextContent(lo.redacted)
  })

  it('says so when the day was never captured, rather than showing a time', () => {
    render(<OfflineBoardStatus offline={ctx({ online: false })} source="unavailable" />)
    expect(screen.getByRole('status')).toHaveTextContent(lo.unavailable)
  })

  it('says the device holds nothing yet', () => {
    render(<OfflineBoardStatus offline={ctx()} source="live" />)
    expect(screen.getByText(new RegExp(lo.neverSaved, 'i'))).toBeInTheDocument()
  })

  it('names the window it keeps', () => {
    render(<OfflineBoardStatus offline={ctx({ snapshot: snapshot('2026-08-15T07:14:00Z') })} source="live" />)
    expect(screen.getByText(new RegExp(lo.savedDays(OFFLINE_DAYS)))).toBeInTheDocument()
  })

  it('saves on demand', async () => {
    const refresh = vi.fn()
    render(<OfflineBoardStatus offline={ctx({ refresh })} source="live" />)
    await userEvent.setup().click(screen.getByRole('button', { name: lo.saveNow }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('disables the button while a save is running', () => {
    render(<OfflineBoardStatus offline={ctx({ status: 'syncing' })} source="live" />)
    expect(screen.getByRole('button', { name: lo.saving })).toBeDisabled()
  })

  // Offering "save now" with no connection is a button that can only fail.
  it('disables the button when there is no connection', () => {
    render(<OfflineBoardStatus offline={ctx({ online: false })} source="live" />)
    expect(screen.getByRole('button', { name: lo.saveNow })).toBeDisabled()
  })

  it('warns that the copy is older than its stamp when the last save failed', () => {
    render(<OfflineBoardStatus offline={ctx({ status: 'failed', snapshot: snapshot('2026-08-15T07:14:00Z') })} source="live" />)
    expect(screen.getByText(lo.saveFailed)).toBeInTheDocument()
  })

  it('renders nothing at all while the day is still loading', () => {
    const { container } = render(<OfflineBoardStatus offline={ctx()} source={null} />)
    // The live branch: a status line, but no panel claiming anything about the
    // day that has not resolved yet.
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
