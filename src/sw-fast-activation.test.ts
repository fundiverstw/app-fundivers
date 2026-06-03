import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { enableFastActivation } from './sw-fast-activation'

// A minimal stand-in for ServiceWorkerGlobalScope — just the surface
// enableFastActivation actually touches. We capture the listeners so
// the test can fire synthetic install/activate/message events.
function makeFakeScope(opts: { hasActive?: boolean } = {}) {
  const listeners = new Map<string, (event: unknown) => void>()
  return {
    listeners,
    scope: {
      addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
        listeners.set(type, cb)
      }),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      registration: { active: opts.hasActive ? {} : null },
    },
  }
}

describe('PWA reload UX', () => {
  describe('enableFastActivation', () => {
    it('skipWaiting on FIRST install (no prior active SW) so the page that registered the SW becomes controlled', () => {
      const { listeners, scope } = makeFakeScope({ hasActive: false })
      enableFastActivation(scope as unknown as ServiceWorkerGlobalScope)

      const installHandler = listeners.get('install')
      expect(installHandler, 'install listener registered').toBeTypeOf('function')
      installHandler!({} as Event)

      expect(scope.skipWaiting).toHaveBeenCalledOnce()
    })

    it('does NOT skipWaiting on UPDATE install — the new SW must wait until the user clicks Update', () => {
      // The whole point of the in-app update banner is that the user clicks
      // it on their schedule. If skipWaiting fired automatically here, every
      // deploy would silently swap the app out from under an in-progress
      // form, which is exactly what the banner is meant to prevent.
      const { listeners, scope } = makeFakeScope({ hasActive: true })
      enableFastActivation(scope as unknown as ServiceWorkerGlobalScope)

      const installHandler = listeners.get('install')
      installHandler!({} as Event)

      expect(scope.skipWaiting).not.toHaveBeenCalled()
    })

    it('skipWaiting when the page sends a SKIP_WAITING message — that is the banner click path', () => {
      const { listeners, scope } = makeFakeScope({ hasActive: true })
      enableFastActivation(scope as unknown as ServiceWorkerGlobalScope)

      const messageHandler = listeners.get('message')
      expect(messageHandler, 'message listener registered').toBeTypeOf('function')
      messageHandler!({ data: { type: 'SKIP_WAITING' } } as unknown as Event)

      expect(scope.skipWaiting).toHaveBeenCalledOnce()
    })

    it('ignores unrelated postMessage payloads', () => {
      const { listeners, scope } = makeFakeScope({ hasActive: true })
      enableFastActivation(scope as unknown as ServiceWorkerGlobalScope)

      const messageHandler = listeners.get('message')
      messageHandler!({ data: { type: 'SOMETHING_ELSE' } } as unknown as Event)
      messageHandler!({ data: null } as unknown as Event)
      messageHandler!({} as unknown as Event)

      expect(scope.skipWaiting).not.toHaveBeenCalled()
    })

    it('does NOT register an activate listener — activate is owned by sw.ts (via wipeCachesAndClaim) so wipe and claim share one waitUntil', () => {
      const { listeners, scope } = makeFakeScope()
      enableFastActivation(scope as unknown as ServiceWorkerGlobalScope)

      expect(listeners.get('activate')).toBeUndefined()
      expect(scope.clients.claim).not.toHaveBeenCalled()
    })
  })

  describe('wrangler.toml SPA fallback', () => {
    it('configures Cloudflare to serve index.html for unknown paths', () => {
      // Without this, reloading a client-side route like /calendar hits
      // Cloudflare's asset handler directly and returns 404 because
      // /dist/calendar does not exist on disk.
      const toml = readFileSync(resolve(__dirname, '..', 'wrangler.toml'), 'utf-8')
      expect(toml).toMatch(/not_found_handling\s*=\s*"single-page-application"/)
    })
  })
})
