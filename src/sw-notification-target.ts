// Audit M10 — refuse any url that isn't a same-origin path before
// the SW navigates / opens a window for a notification click. Pulled
// out of sw.ts so it can be unit-tested without the webworker globals.
//
// Threat: a compromised push payload (or a future admin-broadcast bug)
// could land an attacker-controlled URL under the FunDivers SW
// context. The browser's NotificationOptions.data is opaque to the
// SW; whatever we hand to clients.openWindow / WindowClient.navigate
// runs in our origin's context. We must validate before navigating.
//
// Accept: bare "/foo/bar" paths. Reject everything else — fully
// qualified URLs ("https://..."), protocol-relative ("//evil.com"),
// non-strings, missing values. The "/" home page is the safe default.

export function safeNotificationTarget(raw: unknown): string {
  if (typeof raw !== 'string') return '/'
  if (!raw.startsWith('/'))    return '/'
  if (raw.startsWith('//'))    return '/'
  return raw
}
