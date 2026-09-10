import { PackagesIcon } from './icons/PackagesIcon'

// The banner at the top of a package, on the board and on its own page.
//
// A hero image is optional — a shop adding a partner's package often has the
// details before it has a photograph worth showing, and blocking the listing on
// artwork would keep a bookable package off the board. What stood in for a
// missing one was an empty gradient, which reads as an image that failed to
// load rather than as a package with no photo yet. The same mark the Packages
// nav uses says what it is instead.
//
// Decorative either way: the package's title is right beneath it, so the image
// carries no information of its own and the icon is aria-hidden.

export function PackageHero({
  src,
  heightClass,
}: {
  /** `packages.hero_image_url`, or null when the shop has not set one. */
  src: string | null
  /** Tailwind height for the surface this appears on — the board's cards are
   *  shorter than the detail page's banner. */
  heightClass: string
}) {
  if (src) {
    return <img src={src} alt="" className={`w-full ${heightClass} object-cover`} />
  }
  return (
    <div
      className={`w-full ${heightClass} bg-gradient-to-br from-surface-200 to-brand-300 grid place-items-center`}
      data-testid="package-hero-placeholder"
    >
      {/* Tokens, not raw colors: both ends of the gradient and this tint remap
          together under the dark theme, so the contrast holds in either. */}
      <PackagesIcon className="w-10 h-10 text-brand-900/40" />
    </div>
  )
}
