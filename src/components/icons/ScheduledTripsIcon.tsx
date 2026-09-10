// Lucide "parasol" glyph for the Scheduled Trips header shortcut. currentColor
// so the parent picks the tint — red on the diver header — matching the
// outline icons beside it.
//
// `className` overrides the 24px default, so the same mark can stand in for a
// trip's missing hero image at a size that reads as artwork rather than as a
// stray glyph. See ListingHero.
export function ScheduledTripsIcon({ className = '' }: { className?: string } = {}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 11.134 18.196 21" />
      <path d="M20.425 5.299a10 10 0 0 0-16.941 9.78c.183.563.843.774 1.355.478L20.16 6.711c.512-.296.66-.973.264-1.413" />
      <path d="M21 21H3" />
    </svg>
  )
}
