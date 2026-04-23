import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { enableFastActivation } from './sw-fast-activation'

// A minimal stand-in for ServiceWorkerGlobalScope — just the surface
// enableFastActivation actually touches. We capture the listeners so
// the test can fire synthetic install/activate events.
function makeFakeScope() {
  const listeners = new Map<string, (event: unknown) => void>()
  return {
    listeners,
    scope: {
      addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
        listeners.set(type, cb)
      }),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
    },
  }
}

describe('PWA reload UX', () => {
  describe('enableFastActivation', () => {
    it('calls skipWaiting() on install so the new SW does not queue behind the old one', () => {
      const { listeners, scope } = makeFakeScope()
      enableFastActivation(scope as unknown as ServiceWorkerGlobalScope)

      const installHandler = listeners.get('install')
      expect(installHandler, 'install listener registered').toBeTypeOf('function')
      installHandler!({} as Event)

      expect(scope.skipWaiting).toHaveBeenCalledOnce()
    })

    it('claims existing clients on activate so the next reload is served by the new SW', () => {
      const { listeners, scope } = makeFakeScope()
      enableFastActivation(scope as unknown as ServiceWorkerGlobalScope)

      const activateHandler = listeners.get('activate')
      expect(activateHandler, 'activate listener registered').toBeTypeOf('function')

      const waitUntil = vi.fn()
      activateHandler!({ waitUntil } as unknown as Event)

      expect(scope.clients.claim).toHaveBeenCalledOnce()
      // waitUntil must receive the claim() promise so the SW stays in the
      // activating phase until claim resolves.
      expect(waitUntil).toHaveBeenCalledOnce()
      expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
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
