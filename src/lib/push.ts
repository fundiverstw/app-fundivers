// Client-side Web Push helpers. The service worker (src/sw.ts) owns the
// push + notificationclick events; this module is just the enrollment
// flow: ask permission, subscribe with the server's VAPID key, and round
// trip the PushSubscription to public.push_subscriptions.

import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

// Web Push API surface isn't defined on iOS Safari unless the PWA has
// been installed to the Home Screen, so this boolean doubles as the
// "is the toggle usable right now" check.
export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

export async function subscribeToPush(): Promise<PushSubscription> {
  if (!pushSupported()) {
    throw new Error('Push notifications are not supported on this device.')
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('Server VAPID key is not configured.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) {
    await persistSubscription(existing)
    return existing
  }

  const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    // Cast via ArrayBuffer — PushManager accepts BufferSource but TS' libdom
    // narrows the Uint8Array generic in a way that doesn't line up here.
    applicationServerKey: keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
  })
  await persistSubscription(sub)
  return sub
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getPushSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

async function persistSubscription(sub: PushSubscription): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')

  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Push subscription is missing required keys.')
  }

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id:      user.id,
    endpoint:     json.endpoint,
    p256dh:       json.keys.p256dh,
    auth:         json.keys.auth,
    user_agent:   typeof navigator !== 'undefined' ? navigator.userAgent : null,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' })

  if (error) throw error
}

// Decode the URL-safe base64 VAPID key into the Uint8Array that
// PushManager.subscribe expects. Standard snippet from the Web Push spec.
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
