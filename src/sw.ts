/// <reference lib="webworker" />
/// <reference types="vite/client" />

// Custom service worker (injectManifest mode). We keep the same precache +
// Supabase runtime caching that the previous generateSW config had, and
// layer on push + notificationclick for reminders.

import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import { enableFastActivation } from './sw-fast-activation'
import { isSupabaseCacheable, SUPABASE_CACHE_NAME } from './sw-cache-policy'
import { safeNotificationTarget } from './sw-notification-target'

declare const self: ServiceWorkerGlobalScope

enableFastActivation(self)

precacheAndRoute(self.__WB_MANIFEST)

// Audit H4 — only cache GETs that aren't /auth/v1/* and don't carry an
// Authorization header. See sw-cache-policy.ts for the rule and the
// privacy reasons behind it.
registerRoute(
  ({ url, request }) => isSupabaseCacheable(url, request),
  new NetworkFirst({
    cacheName:             SUPABASE_CACHE_NAME,
    networkTimeoutSeconds: 10,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds:  60 * 5,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

// useAuth.signOut posts CLEAR_SUPABASE_CACHE after a successful
// signOut so the next user on this device starts from a clean cache.
self.addEventListener('message', (event) => {
  const msg = event.data as { type?: string } | null
  if (msg?.type === 'CLEAR_SUPABASE_CACHE') {
    event.waitUntil(caches.delete(SUPABASE_CACHE_NAME))
  }
})

// On every SW activation, wipe every cache the previous worker owned
// (workbox precache, supabase-api, all of it) and force-reload every
// open tab. Belt-and-suspenders against the stale-shell trap, where a
// precached index.html points at a long-deleted bundle hash and users
// are stuck without a path forward except manually unregistering the
// SW. Costs a brief "no offline cache" window after each update;
// buys a guarantee no user ever lands on a half-applied deploy.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.map(n => caches.delete(n)))
    await self.clients.claim()
    const tabs = await self.clients.matchAll({ type: 'window' })
    await Promise.all(tabs.map(t => (t as WindowClient).navigate(t.url)))
  })())
})

interface PushPayload {
  title: string
  body?: string
  tag?: string
  url?: string
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = { title: 'FunDivers' }
  if (event.data) {
    try {
      payload = event.data.json() as PushPayload
    } catch {
      payload = { title: 'FunDivers', body: event.data.text() }
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag:  payload.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url ?? '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = safeNotificationTarget(
    (event.notification.data as { url?: unknown } | null)?.url,
  )

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if ('focus' in client) {
        await (client as WindowClient).focus()
        if ('navigate' in client) {
          try { await (client as WindowClient).navigate(target) } catch { /* cross-origin guard */ }
        }
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
