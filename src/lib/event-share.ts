import { siteConfig } from '../config/site'

// Public event-page link for the share button. The shop owns the URL shape via
// urls.eventPage — a template whose `{id}` is replaced with the event id. A
// null template means the shop has no shareable event page, so we return null
// and callers hide the affordance.
export function eventShareUrl(id: string): string | null {
  const template = siteConfig.urls.eventPage
  return template ? template.replace('{id}', encodeURIComponent(id)) : null
}
