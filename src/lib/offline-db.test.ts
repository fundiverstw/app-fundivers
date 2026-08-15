import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearStoredSnapshot, readStoredSnapshot, writeStoredSnapshot } from './offline-db'

// A stand-in for the browser's IndexedDB, small enough to be obviously correct:
// one store, one key, request objects whose handlers fire on a microtask the
// way the real ones fire on a task.
function fakeIndexedDb() {
  const data = new Map<string, unknown>()
  const store = {
    get: (key: string) => request(() => data.get(key)),
    put: (value: unknown, key: string) => request(() => { data.set(key, value); return undefined }),
    delete: (key: string) => request(() => { data.delete(key); return undefined }),
  }
  function request(run: () => unknown) {
    const req: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null }
    queueMicrotask(() => {
      req.result = run()
      ;(req.onsuccess as (() => void) | null)?.()
    })
    return req as unknown as IDBRequest
  }
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
    transaction: () => ({ objectStore: () => store }),
    close: vi.fn(),
  }
  return {
    data,
    db,
    factory: {
      open: () => {
        const req: Record<string, unknown> = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
        queueMicrotask(() => { (req.onsuccess as (() => void) | null)?.() })
        return req as unknown as IDBOpenDBRequest
      },
    } as unknown as IDBFactory,
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('with IndexedDB available', () => {
  let fake: ReturnType<typeof fakeIndexedDb>

  beforeEach(() => {
    fake = fakeIndexedDb()
    vi.stubGlobal('indexedDB', fake.factory)
  })

  it('round-trips a snapshot', async () => {
    await writeStoredSnapshot({ userId: 'u1', capturedAt: 'now' })
    expect(await readStoredSnapshot()).toEqual({ userId: 'u1', capturedAt: 'now' })
  })

  it('reads null when nothing has been stored', async () => {
    expect(await readStoredSnapshot()).toBeNull()
  })

  it('replaces rather than accumulating — one snapshot per device', async () => {
    await writeStoredSnapshot({ n: 1 })
    await writeStoredSnapshot({ n: 2 })
    expect(await readStoredSnapshot()).toEqual({ n: 2 })
    expect(fake.data.size).toBe(1)
  })

  // Sign-out has to actually empty it: this is the rows a staff phone holds.
  it('clears on demand', async () => {
    await writeStoredSnapshot({ n: 1 })
    await clearStoredSnapshot()
    expect(await readStoredSnapshot()).toBeNull()
  })

  it('closes the connection it opened, so a later version bump is not blocked', async () => {
    await writeStoredSnapshot({ n: 1 })
    expect(fake.db.close).toHaveBeenCalled()
  })
})

describe('when IndexedDB is unavailable', () => {
  // Private mode and locked-down enterprise profiles. The board must stay
  // online-only, never break.
  it('reads null instead of throwing', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(readStoredSnapshot()).resolves.toBeNull()
  })

  it('swallows writes and clears', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(writeStoredSnapshot({ n: 1 })).resolves.toBeUndefined()
    await expect(clearStoredSnapshot()).resolves.toBeUndefined()
  })

  it('survives an open() that throws outright', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('denied') } } as unknown as IDBFactory)
    await expect(readStoredSnapshot()).resolves.toBeNull()
  })

  it('survives an open() that errors asynchronously', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, unknown> = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
        queueMicrotask(() => { (req.onerror as (() => void) | null)?.() })
        return req as unknown as IDBOpenDBRequest
      },
    } as unknown as IDBFactory)
    await expect(readStoredSnapshot()).resolves.toBeNull()
  })

  // Another tab holding an old version would otherwise hang the promise, and a
  // hung read is a board that never renders.
  it('gives up rather than hanging when the upgrade is blocked', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, unknown> = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
        queueMicrotask(() => { (req.onblocked as (() => void) | null)?.() })
        return req as unknown as IDBOpenDBRequest
      },
    } as unknown as IDBFactory)
    await expect(readStoredSnapshot()).resolves.toBeNull()
  })
})
