/// <reference lib="webworker" />

// On every SW activation we drop every cache the previous worker owned
// (workbox precache, supabase-api, all of it) and *then* claim every open
// tab. Both halves matter and the order is load-bearing:
//
// - Wipe first: a previous SW's precache may hold an index.html pointing at
//   a long-deleted bundle hash. If we claim before wiping, controllerchange
//   fires, the page reloads, workbox serves the stale index from its still-
//   populated precache, and we're right back in the stale-shell trap.
// - Claim second: clients.claim() fires controllerchange in each tab, which
//   vite-plugin-pwa's updateServiceWorker(true) listens for to trigger the
//   page-side window.location.reload(). That's how the user actually lands
//   on the new bundle.
//
// We deliberately do NOT call client.navigate() here. It races with
// vite-plugin-pwa's own controllerchange → reload listener and locks the
// tab in mid-transition.
export async function wipeCachesAndClaim(
  scope: Pick<ServiceWorkerGlobalScope, 'clients'>,
  storage: Pick<CacheStorage, 'keys' | 'delete'> = caches,
): Promise<void> {
  const names = await storage.keys()
  await Promise.all(names.map(n => storage.delete(n)))
  await scope.clients.claim()
}
