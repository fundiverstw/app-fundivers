import type { AppEvent } from '../types/database'
import { siteConfig } from '../config/site'

// Wix uses inconsistent URL segments — plural for dives, singular for
// courses — so we can't just lowercase the type. Mirror the public site
// exactly or the link 404s.
const SEGMENT: Record<AppEvent['type'], string> = {
  dive: 'dives',
  course: 'course',
}

export function wixEventUrl(event: Pick<AppEvent, 'id' | 'type'>): string {
  return `${siteConfig.urls.site}/${SEGMENT[event.type]}/${event.id}`
}
