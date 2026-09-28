import { vi } from 'vitest'

// An in-memory stand-in for src/lib/packed-sync.ts: one shared pack list per
// day, plus the live channel, so a test can play the part of a colleague's
// phone. Swap it in with
//   vi.mock('<path>/lib/packed-sync', async () => (await import('<path>/tests/fake-packed-sync')).packedSyncModule)
// and call resetFakePackedServer() in beforeEach.

type Listener = (key: string, packed: boolean) => void

const state = {
  lists: new Map<string, Set<string>>(),
  listeners: new Map<string, Set<Listener>>(),
  /** When true every read and write fails, as with no connection. */
  unreachable: false,
}

function list(day: string): Set<string> {
  let s = state.lists.get(day)
  if (!s) { s = new Set(); state.lists.set(day, s) }
  return s
}

export const packedSyncModule = {
  fetchPackedKeys: vi.fn(async (day: string) => {
    if (state.unreachable) throw new Error('unreachable')
    return new Set(list(day))
  }),
  writePacked: vi.fn(async (day: string, keys: string[], packed: boolean) => {
    if (state.unreachable) throw new Error('unreachable')
    for (const k of keys) {
      if (packed) list(day).add(k)
      else list(day).delete(k)
    }
  }),
  subscribePacked: vi.fn((day: string, onChange: Listener) => {
    const set = state.listeners.get(day) ?? new Set()
    set.add(onChange)
    state.listeners.set(day, set)
    return () => { set.delete(onChange) }
  }),
}

export const fakePackedServer = {
  /** What the shared list holds for a day. */
  list: (day: string) => new Set(list(day)),
  /** A colleague's phone ticks (or unticks) a piece. */
  remote(day: string, key: string, packed: boolean) {
    if (packed) list(day).add(key)
    else list(day).delete(key)
    for (const l of state.listeners.get(day) ?? []) l(key, packed)
  },
  setUnreachable(value: boolean) { state.unreachable = value },
}

export function resetFakePackedServer() {
  state.lists.clear()
  state.listeners.clear()
  state.unreachable = false
  packedSyncModule.fetchPackedKeys.mockClear()
  packedSyncModule.writePacked.mockClear()
  packedSyncModule.subscribePacked.mockClear()
}
