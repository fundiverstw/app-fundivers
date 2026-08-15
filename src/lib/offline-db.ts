// On-device storage for the offline day-board snapshot.
//
// IndexedDB rather than localStorage: a ten-day snapshot is hundreds of rows,
// well past the ~5 MB localStorage ceiling that a quota error would blow
// through silently, and localStorage is synchronous — writing it on the main
// thread would jank the board it is meant to serve.
//
// Deliberately NOT the service worker's HTTP cache. sw-cache-policy.ts refuses
// to cache anything carrying an Authorization header, because a cached
// RLS-scoped response would be served to whoever opens the app next on the same
// device (audit H4). That rule stays; this store answers the same objection a
// different way — the record carries the user id that captured it, readers
// refuse a mismatch, and sign-out deletes the database.
//
// Every function is best-effort: a browser with IndexedDB disabled (private
// mode, locked-down enterprise profile) gets `null` and no snapshot, never a
// thrown error that would take the online board down with it.

const DB_NAME = 'fundive-offline'
const DB_VERSION = 1
const STORE = 'snapshots'
const RECORD_KEY = 'day-board'

function idbFactory(): IDBFactory | null {
  try {
    return globalThis.indexedDB ?? null
  } catch {
    return null
  }
}

function openDb(): Promise<IDBDatabase | null> {
  const factory = idbFactory()
  if (!factory) return Promise.resolve(null)
  return new Promise(resolve => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    // A version change blocked by another tab would hang the promise, and a
    // hung read means a board that never renders. Give up instead.
    request.onblocked = () => resolve(null)
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> {
  return openDb().then(db => {
    if (!db) return fallback
    return new Promise<T>(resolve => {
      let request: IDBRequest
      try {
        request = run(db.transaction(STORE, mode).objectStore(STORE))
      } catch {
        db.close()
        resolve(fallback)
        return
      }
      request.onsuccess = () => { db.close(); resolve(request.result as T) }
      request.onerror = () => { db.close(); resolve(fallback) }
    })
  })
}

/** The stored snapshot, or null when there is none / storage is unavailable. */
export function readStoredSnapshot<T>(): Promise<T | null> {
  return withStore<T | null>('readonly', s => s.get(RECORD_KEY), null).then(v => v ?? null)
}

/** Replace the stored snapshot. Resolves either way — a failed write means the
 *  board stays online-only, which is not worth surfacing as an error. */
export function writeStoredSnapshot(snapshot: unknown): Promise<void> {
  return withStore<unknown>('readwrite', s => s.put(snapshot, RECORD_KEY), null).then(() => undefined)
}

/**
 * Delete everything this device holds. Called on sign-out beside the service
 * worker's CLEAR_SUPABASE_CACHE: the two stores are separate mechanisms, and
 * leaving one behind would hand the next person on the device a roster.
 */
export function clearStoredSnapshot(): Promise<void> {
  return withStore<unknown>('readwrite', s => s.delete(RECORD_KEY), null).then(() => undefined)
}
