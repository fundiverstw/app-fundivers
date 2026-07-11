import { siteConfig } from '../config/site'

// Every event — dive or course — now lives at the unified /events/<id>
// page on the public Wix site, so the link needs only the id.
export function wixEventUrl(id: string): string {
  return `${siteConfig.urls.site}/events/${id}`
}
