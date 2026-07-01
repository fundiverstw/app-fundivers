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
import { wipeCachesAndClaim } from './sw-activation-reset'
import { isSupabaseCacheable, SUPABASE_CACHE_NAME } from './sw-cache-policy'
import { safeNotificationTarget } from './sw-notification-target'
import { siteConfig } from './config/site'

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

// Wipe stale caches + claim open tabs. See sw-activation-reset.ts for the
// stale-shell rationale and why the order is load-bearing.
self.addEventListener('activate', (event) => {
  event.waitUntil(wipeCachesAndClaim(self))
})

interface PushPayload {
  title: string
  body?: string
  tag?: string
  url?: string
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = { title: siteConfig.identity.shortName }
  if (event.data) {
    try {
      payload = event.data.json() as PushPayload
    } catch {
      payload = { title: siteConfig.identity.shortName, body: event.data.text() }
    }
  }

  const options: NotificationOptions = {
    body: payload.body,
    tag:  payload.tag,
    icon: siteConfig.assets.icon192,
    badge: siteConfig.assets.icon192,
    // Keep the banner on screen until the diver acts on it instead of
    // auto-dismissing after a few seconds.
    requireInteraction: true,
    data: { url: payload.url ?? '/' },
  }
  // renotify re-alerts (re-surface + sound/vibration) when a notification
  // reuses a tag — it requires a tag, so only set it when one is present.
  // Not yet in this TS lib's NotificationOptions; browsers honor it.
  if (payload.tag) (options as { renotify?: boolean }).renotify = true

  event.waitUntil(self.registration.showNotification(payload.title, options))
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
