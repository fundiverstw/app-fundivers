import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePackedGear } from './usePackedGear'
import { loadPendingPacks } from '../lib/gear-packed'
import { fakePackedServer, packedSyncModule, resetFakePackedServer } from '../../tests/fake-packed-sync'

vi.mock('../lib/packed-sync', async () => (await import('../../tests/fake-packed-sync')).packedSyncModule)

const DAY = '2026-08-15'

beforeEach(() => {
  localStorage.clear()
  resetFakePackedServer()
})

describe('usePackedGear', () => {
  it('reads the crew\'s list when it opens', async () => {
    fakePackedServer.remote(DAY, 'b1|BCD', true)
    const { result } = renderHook(() => usePackedGear(DAY, true))
    await waitFor(() => expect(result.current.packed).toEqual(new Set(['b1|BCD'])))
  })

  it('sends a tick to the shared list, and shows it before the server answers', async () => {
    const { result } = renderHook(() => usePackedGear(DAY, true))
    await waitFor(() => expect(packedSyncModule.fetchPackedKeys).toHaveBeenCalled())

    act(() => { result.current.toggle('b1|BCD') })
    expect(result.current.packed.has('b1|BCD')).toBe(true)
    await waitFor(() => expect(fakePackedServer.list(DAY)).toEqual(new Set(['b1|BCD'])))
    await waitFor(() => expect(result.current.pending).toBe(0))
  })

  it("shows a colleague's tick and untick as they happen", async () => {
    const { result } = renderHook(() => usePackedGear(DAY, true))
    await waitFor(() => expect(packedSyncModule.subscribePacked).toHaveBeenCalled())

    act(() => { fakePackedServer.remote(DAY, 'b2|Fins', true) })
    expect(result.current.packed.has('b2|Fins')).toBe(true)
    act(() => { fakePackedServer.remote(DAY, 'b2|Fins', false) })
    expect(result.current.packed.has('b2|Fins')).toBe(false)
  })

  it('keeps ticking with no connection, counts what is unsent, and sends it on reconnect', async () => {
    const { result, rerender } = renderHook(({ online }) => usePackedGear(DAY, online), {
      initialProps: { online: false },
    })
    act(() => { result.current.setPieces(['b1|BCD', 'b1|Fins'], true) })
    expect(result.current.packed).toEqual(new Set(['b1|BCD', 'b1|Fins']))
    expect(result.current.pending).toBe(2)
    expect(fakePackedServer.list(DAY).size).toBe(0)

    rerender({ online: true })
    await waitFor(() => expect(fakePackedServer.list(DAY)).toEqual(new Set(['b1|BCD', 'b1|Fins'])))
    await waitFor(() => expect(result.current.pending).toBe(0))
  })

  it('keeps a tick queued when the send fails, rather than losing it', async () => {
    const { result } = renderHook(() => usePackedGear(DAY, true))
    await waitFor(() => expect(packedSyncModule.fetchPackedKeys).toHaveBeenCalled())
    fakePackedServer.setUnreachable(true)

    act(() => { result.current.toggle('b1|BCD') })
    await waitFor(() => expect(packedSyncModule.writePacked).toHaveBeenCalled())
    expect(result.current.pending).toBe(1)
    expect(loadPendingPacks(DAY)).toEqual(new Map([['b1|BCD', true]]))
    expect(result.current.packed.has('b1|BCD')).toBe(true)
  })

  it("does not let a colleague's older state overwrite this phone's unsent tick", async () => {
    const { result, rerender } = renderHook(({ online }) => usePackedGear(DAY, online), {
      initialProps: { online: true },
    })
    await waitFor(() => expect(packedSyncModule.subscribePacked).toHaveBeenCalled())
    fakePackedServer.setUnreachable(true)
    act(() => { result.current.toggle('b1|BCD') })
    await waitFor(() => expect(result.current.pending).toBe(1))

    act(() => { fakePackedServer.remote(DAY, 'b1|BCD', false) })
    expect(result.current.packed.has('b1|BCD')).toBe(true)

    // And when the connection comes back, the tick lands on the shared list.
    fakePackedServer.setUnreachable(false)
    rerender({ online: false })
    rerender({ online: true })
    await waitFor(() => expect(fakePackedServer.list(DAY).has('b1|BCD')).toBe(true))
  })

  it('shows the device copy straight away, before the server answers', () => {
    localStorage.setItem('fd_gear_packed_v1:2026-08-15', JSON.stringify(['b1|BCD']))
    const { result } = renderHook(() => usePackedGear(DAY, false))
    expect(result.current.packed).toEqual(new Set(['b1|BCD']))
  })

  it('keeps each day to its own list', async () => {
    fakePackedServer.remote(DAY, 'b1|BCD', true)
    const { result, rerender } = renderHook(({ day }) => usePackedGear(day, true), {
      initialProps: { day: DAY },
    })
    await waitFor(() => expect(result.current.packed.size).toBe(1))
    rerender({ day: '2026-08-16' })
    await waitFor(() => expect(result.current.packed.size).toBe(0))
  })
})
