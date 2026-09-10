import type { ReactNode } from 'react'

// The banner at the top of a package or a scheduled trip, on the board and on
// its own page.
//
// A hero image is optional — a shop listing a trip often has the dates and the
// price before it has a photograph worth showing, and blocking the listing on
// artwork would keep a bookable trip off the board. What stood in for a missing
// one was an empty gradient, which reads as an image that failed to load rather
// than as a listing with no photo yet. The mark its own section uses in the nav
// says what it is instead.
//
// Decorative either way: the title is right beneath it, so the banner carries
// no information of its own and the icon is aria-hidden.

export function ListingHero({
  src,
  heightClass,
  icon,
}: {
  /** `hero_image_url`, or null when the shop has not set one. */
  src: string | null
  /** Tailwind height for the surface this appears on — a board card is shorter
   *  than a detail page's banner. */
  heightClass: string
  /** The section's own glyph, sized by the caller. Shown only in place of a
   *  missing image, so a package reads as a package and a trip as a trip. */
  icon: ReactNode
}) {
  if (src) {
    return <img src={src} alt="" className={`w-full ${heightClass} object-cover`} />
  }
  return (
    <div
      className={`w-full ${heightClass} bg-gradient-to-br from-surface-200 to-brand-300 grid place-items-center`}
      data-testid="listing-hero-placeholder"
    >
      {/* Tokens, not raw colors: both ends of the gradient and this tint remap
          together under the dark theme, so the contrast holds in either. */}
      <span className="text-brand-900/40">{icon}</span>
    </div>
  )
}
