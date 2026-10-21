import { siteConfig } from '../config/site'

// Uses the deployment's language rather than the browser's, so every viewer
// sees the same order.
const collator = new Intl.Collator(siteConfig.locale.language, { sensitivity: 'base', numeric: true })

// A–Z by location (case-insensitive), then name; partners with no location last.
export function sortByLocation<T extends { name: string | null }>(
  partners: T[], locationOf: (p: T) => string | null | undefined,
): T[] {
  return [...partners].sort((a, b) => {
    const ra = locationOf(a)?.trim() ?? ''
    const rb = locationOf(b)?.trim() ?? ''
    if (!ra !== !rb) return ra ? -1 : 1
    return collator.compare(ra, rb) || collator.compare(a.name ?? '', b.name ?? '')
  })
}
