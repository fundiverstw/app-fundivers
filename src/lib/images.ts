// Event / destination photos are self-hosted under public/imgs/media/ (the same
// optimized copies the marketing site harvests from Wix — see
// site-fundivers/scripts/fetch-wix-images.mjs). The catalog stores only the
// original Wix image ref; we resolve it to our local copy here so there's no
// Wix CDN dependency at runtime (and nothing to add to the CSP img-src beyond
// 'self'). Plain http(s) URLs (e.g. a Supabase-hosted image) pass through.

/** Slugify a Wix media id segment (e.g. `b37fef_abc~mv2.jpg`) to a filename. */
function slug(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9]/g, '_')
}

/** Media id segment from a `wix:image://v1/<seg>/<filename>#…` ref. */
export function wixMediaId(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith('wix:image://')) return null
  const seg = ref.replace(/^wix:image:\/\/v1\//, '').split('#')[0].split('/')[0]
  return seg ? slug(seg) : null
}

/**
 * Resolve a stored image reference to a displayable URL, or null when there's
 * nothing usable. Handles the two shapes the catalog actually stores:
 *   • `wix:image://…` refs  → our local /imgs/media/<slug>.webp copy
 *   • plain http(s) URLs    → passed through as-is
 */
export function resolveImageUrl(ref: string | null | undefined): string | null {
  if (!ref) return null
  const trimmed = ref.trim()
  if (!trimmed) return null
  const id = wixMediaId(trimmed)
  if (id) return `/imgs/media/${id}.webp`
  if (/^https?:\/\//.test(trimmed)) return trimmed
  return null
}
