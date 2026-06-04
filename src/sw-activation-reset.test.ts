import { describe, it, expect, vi } from 'vitest'
import { wipeCachesAndClaim } from './sw-activation-reset'

// Minimal stand-ins for CacheStorage and ServiceWorkerGlobalScope.clients —
// just the surface wipeCachesAndClaim touches. The recorded-order test below
// is the load-bearing one: if delete and claim ever run in parallel (or in
// the wrong order), the page-side reload races the wipe and we're back in
// the stale-shell trap.
function makeStorage(initial: string[]) {
  return {
    keys: vi.fn(async () => initial),
    delete: vi.fn(async () => true),
  }
}

function makeScope() {
  return { clients: { claim: vi.fn().mockResolvedValue(undefined) } }
}

describe('wipeCachesAndClaim', () => {
  it('deletes every cache the SW currently owns', async () => {
    const storage = makeStorage([
      'workbox-precache-v2-https://app.fundiverstw.com/',
      'supabase-api',
      'random-leftover',
    ])
    const scope = makeScope()

    await wipeCachesAndClaim(scope as unknown as ServiceWorkerGlobalScope, storage)

    expect(storage.delete).toHaveBeenCalledTimes(3)
    expect(storage.delete.mock.calls.map(c => c[0])).toEqual(
      expect.arrayContaining([
        'workbox-precache-v2-https://app.fundiverstw.com/',
        'supabase-api',
        'random-leftover',
      ]),
    )
  })

  it('claims open tabs AFTER wiping caches — order matters for the stale-shell trap', async () => {
    const events: string[] = []
    const storage = {
      keys: vi.fn(async () => ['workbox-precache']),
      delete: vi.fn(async () => { events.push('delete'); return true }),
    }
    const scope = {
      clients: { claim: vi.fn(async () => { events.push('claim') }) },
    }

    await wipeCachesAndClaim(scope as unknown as ServiceWorkerGlobalScope, storage)

    expect(events).toEqual(['delete', 'claim'])
  })

  it('still claims when there is nothing to wipe (first install)', async () => {
    const storage = makeStorage([])
    const scope = makeScope()

    await wipeCachesAndClaim(scope as unknown as ServiceWorkerGlobalScope, storage)

    expect(storage.delete).not.toHaveBeenCalled()
    expect(scope.clients.claim).toHaveBeenCalledOnce()
  })
})
