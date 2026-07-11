import { siteConfig } from '../config/site'

// Public event-page link for the share button. Optional feature: it yields a
// link only when the shop has turned on features.eventSharing AND set a
// urls.eventPage template (whose `{id}` is replaced with the event id). Either
// unset means the shop has no shareable event page, so we return null and
// callers hide the affordance.
export function eventShareUrl(id: string): string | null {
  if (!siteConfig.features.eventSharing) return null
  const template = siteConfig.urls.eventPage
  return template ? template.replace('{id}', encodeURIComponent(id)) : null
}
