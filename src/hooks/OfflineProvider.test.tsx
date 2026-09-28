import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OfflineProvider } from './OfflineProvider'
import { useOffline } from './useOffline'
import { SNAPSHOT_VERSION, type OfflineSnapshot } from '../lib/offline-snapshot'
import { todayIso } from '../lib/dates'

const {
  useAuthMock, readStoredSnapshotMock, writeStoredSnapshotMock, buildSnapshotMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  readStoredSnapshotMock: vi.fn(),
  writeStoredSnapshotMock: vi.fn(),
  buildSnapshotMock: vi.fn(),
}))

vi.mock('./useAuth', () => ({ useAuth: () => useAuthMock() }))
vi.mock('../lib/offline-db', () => ({
  readStoredSnapshot: (...a: unknown[]) => readStoredSnapshotMock(...a),
  writeStoredSnapshot: (...a: unknown[]) => writeStoredSnapshotMock(...a),
  clearStoredSnapshot: vi.fn(),
}))
vi.mock('../lib/offline-snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/offline-snapshot')>()),
  buildSnapshot: (...a: unknown[]) => buildSnapshotMock(...a),
}))
// The capture's own reads; the provider only wires them into buildSnapshot.
vi.mock('../lib/day-board', () => ({ fetchDayBoard: vi.fn(), fetchDayTransport: vi.fn() }))
vi.mock('../lib/events', () => ({ fetchUpcomingEventDays: vi.fn() }))
vi.mock('../lib/vehicles', () => ({ fetchVehicles: vi.fn() }))
vi.mock('../lib/gear-models', () => ({ fetchGearModelsWithSizes: vi.fn() }))

const snapshot = (over: Partial<OfflineSnapshot> = {}): OfflineSnapshot => ({
  version: SNAPSHOT_VERSION,
  userId: 'u1',
  capturedAt: '2026-08-15T07:14:00Z',
  days: ['2026-08-15'],
  upcomingDays: [],
  vehicles: [],
  gearModels: [],
  boards: {},
  transport: {},
  ...over,
})

function Probe() {
  const offline = useOffline()
  return (
    <div>
      <span data-testid="status">{offline?.status}</span>
      <span data-testid="captured">{offline?.snapshot?.capturedAt ?? 'none'}</span>
      <span data-testid="online">{String(offline?.online)}</span>
      <button onClick={() => { void offline?.refresh() }}>refresh</button>
    </div>
  )
}

const renderProvider = () =>
  render(<OfflineProvider><Probe /></OfflineProvider>)

// The background capture waits ten seconds after sign-in so the page the user
// landed on loads first.
const pastFirstCaptureDelay = () => act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  useAuthMock.mockReturnValue({ user: { id: 'u1' }, profile: { id: 'u1', role: 'admin' } })
  readStoredSnapshotMock.mockResolvedValue(null)
  writeStoredSnapshotMock.mockResolvedValue(undefined)
  buildSnapshotMock.mockResolvedValue(snapshot())
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  setOnline(true)
})

describe('OfflineProvider', () => {
  it('captures for an admin once the page has had its turn, and publishes the result', async () => {
    renderProvider()
    await pastFirstCaptureDelay()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('synced'))
    expect(screen.getByTestId('captured')).toHaveTextContent('2026-08-15T07:14:00Z')
    expect(writeStoredSnapshotMock).toHaveBeenCalled()
  })

  it('captures for staff too — they are the ones on the boat', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u2' }, profile: { id: 'u2', role: 'staff' } })
    buildSnapshotMock.mockResolvedValue(snapshot({ userId: 'u2' }))
    renderProvider()
    await pastFirstCaptureDelay()
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalled())
  })

  // A diver's phone has no business holding other divers' rosters.
  it('never captures for a diver', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'd1' }, profile: { id: 'd1', role: 'diver' } })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'))
    expect(buildSnapshotMock).not.toHaveBeenCalled()
    expect(readStoredSnapshotMock).not.toHaveBeenCalled()
  })

  it('does nothing before a session exists', async () => {
    useAuthMock.mockReturnValue({ user: null, profile: null })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'))
    expect(buildSnapshotMock).not.toHaveBeenCalled()
  })

  // Opening the app with no signal is the whole point: the stored board has to
  // be on screen without waiting on a capture that cannot happen.
  it('publishes what the device already holds, offline, without capturing', async () => {
    setOnline(false)
    readStoredSnapshotMock.mockResolvedValue(snapshot({ capturedAt: 'yesterday' }))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('captured')).toHaveTextContent('yesterday'))
    expect(buildSnapshotMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('online')).toHaveTextContent('false')
  })

  it('discards a stored snapshot captured by somebody else on this device', async () => {
    readStoredSnapshotMock.mockResolvedValue(snapshot({ userId: 'someone-else' }))
    setOnline(false)
    renderProvider()
    await waitFor(() => expect(readStoredSnapshotMock).toHaveBeenCalled())
    expect(screen.getByTestId('captured')).toHaveTextContent('none')
  })

  it('keeps the previous snapshot when a capture fails, and says the save failed', async () => {
    readStoredSnapshotMock.mockResolvedValue(snapshot({ capturedAt: 'yesterday' }))
    buildSnapshotMock.mockRejectedValue(new Error('network'))
    renderProvider()
    await pastFirstCaptureDelay()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('failed'))
    // Stale beats nothing, and the board labels it.
    expect(screen.getByTestId('captured')).toHaveTextContent('yesterday')
  })

  it('captures again when the connection comes back', async () => {
    setOnline(false)
    renderProvider()
    await waitFor(() => expect(readStoredSnapshotMock).toHaveBeenCalled())
    expect(buildSnapshotMock).not.toHaveBeenCalled()

    setOnline(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    await pastFirstCaptureDelay()
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalled())
  })

  it('re-captures on demand', async () => {
    renderProvider()
    await pastFirstCaptureDelay()
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalledTimes(1))
    await user().click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalledTimes(2))
  })

  it('will not run two captures at once', async () => {
    let release!: (v: OfflineSnapshot) => void
    buildSnapshotMock.mockImplementation(() => new Promise(res => { release = res }))
    renderProvider()
    await pastFirstCaptureDelay()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('syncing'))
    await user().click(screen.getByRole('button', { name: 'refresh' }))
    expect(buildSnapshotMock).toHaveBeenCalledTimes(1)
    await act(async () => { release(snapshot()) })
  })

  it('leaves the network alone while the page it opened on loads', async () => {
    renderProvider()
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
    expect(buildSnapshotMock).not.toHaveBeenCalled()
    await pastFirstCaptureDelay()
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalledOnce())
  })

  // The background capture used to run on every staff page every fifteen
  // minutes whatever the device held. A copy of today under half an hour old
  // answers it without a single request.
  it('skips the background capture while today\'s copy is fresh', async () => {
    readStoredSnapshotMock.mockResolvedValue(snapshot({
      days: [todayIso()], capturedAt: new Date().toISOString(),
    }))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('captured')).not.toHaveTextContent('none'))
    await pastFirstCaptureDelay()
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60 * 1000) })
    expect(buildSnapshotMock).not.toHaveBeenCalled()

    // Save now still saves.
    await user().click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalledOnce())
  })

  it('replaces a copy saved on an earlier day', async () => {
    readStoredSnapshotMock.mockResolvedValue(snapshot({
      days: ['2020-01-01'], capturedAt: new Date().toISOString(),
    }))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('captured')).not.toHaveTextContent('none'))
    await pastFirstCaptureDelay()
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalledOnce())
  })

  it('replaces a copy of today once it is half an hour old', async () => {
    readStoredSnapshotMock.mockResolvedValue(snapshot({
      days: [todayIso()], capturedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    }))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('captured')).not.toHaveTextContent('none'))
    await pastFirstCaptureDelay()
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalledOnce())
  })

  it('passes the signed-in user id into the capture, so the record names its owner', async () => {
    renderProvider()
    await pastFirstCaptureDelay()
    await waitFor(() => expect(buildSnapshotMock).toHaveBeenCalled())
    expect(buildSnapshotMock.mock.calls[0][0]).toBe('u1')
  })
})

describe('useOffline outside the provider', () => {
  // Unlike useAuth, this returns null rather than throwing: shared components
  // render on diver pages too, where no snapshot exists.
  it('returns null instead of throwing', () => {
    render(<Probe />)
    expect(screen.getByTestId('captured')).toHaveTextContent('none')
    expect(screen.getByTestId('status')).toBeEmptyDOMElement()
  })
})
