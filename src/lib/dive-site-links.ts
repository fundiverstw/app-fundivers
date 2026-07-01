import { siteConfig } from '../config/site'

// Every travel-destination page lives under this path on the shop's marketing
// site, so a dive site only needs to store its slug (see dive_sites.wix_slug).
// Returns null when the site has no Wix page.
const WIX_TRAVEL_BASE = siteConfig.urls.travelDestinationsBase

export function wixSiteUrl(slug: string | null | undefined): string | null {
  const s = (slug ?? '').trim()
  return s ? `${WIX_TRAVEL_BASE}${s}` : null
}
