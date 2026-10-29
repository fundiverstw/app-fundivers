// Event / destination photos are self-hosted under public/imgs/media/, so
// there's no CDN dependency at runtime and nothing to add to the CSP img-src
// beyond 'self'. The catalog stores either a site path (`/imgs/media/<file>.webp`)
// or a plain http(s) URL (e.g. a Supabase-hosted image).

/**
 * Resolve a stored image reference to a displayable URL, or null when there's
 * nothing usable. Accepts the two shapes the catalog stores:
 *   • a site path such as `/imgs/media/<file>.webp`  → used as-is
 *   • an https URL                                   → used as-is
 * Anything else is rejected, including plain http (mixed content), a
 * protocol-relative `//host/…`, and backslashes or whitespace inside the ref,
 * which browsers can normalise into an off-site `//host` address.
 */
export function resolveImageUrl(ref: string | null | undefined): string | null {
  if (!ref) return null
  const trimmed = ref.trim()
  if (!trimmed || /[\s\\]/.test(trimmed)) return null
  if (/^\/(?!\/)/.test(trimmed)) return trimmed
  if (/^https:\/\//.test(trimmed)) return trimmed
  return null
}
