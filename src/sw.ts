/// <reference lib="webworker" />
/// <reference types="vite/client" />

// Custom service worker (injectManifest mode). We keep the same precache +
// Supabase runtime caching that the previous generateSW config had, and
// layer on push + notificationclick for reminders.

import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { enableFastActivation } from './sw-fast-activation'

declare const self: ServiceWorkerGlobalScope

enableFastActivation(self)

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co'),
  new NetworkFirst({ cacheName: 'supabase-api', networkTimeoutSeconds: 10 })
)

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
  const target = (event.notification.data as { url?: string } | null)?.url ?? '/'

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Prefer focusing an already-open window — navigate it to the deep link.
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
