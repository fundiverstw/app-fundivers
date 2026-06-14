// Every FunDivers travel-destination page lives under this path on the Wix
// marketing site, so a dive site only needs to store its slug (see
// dive_sites.wix_slug). Returns null when the site has no Wix page.
const WIX_TRAVEL_BASE = 'https://www.fundiverstw.com/traveldestinations/'

export function wixSiteUrl(slug: string | null | undefined): string | null {
  const s = (slug ?? '').trim()
  return s ? `${WIX_TRAVEL_BASE}${s}` : null
}
