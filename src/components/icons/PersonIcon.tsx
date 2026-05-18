// Standard "user" head-and-shoulders glyph for the diver-shell Profile
// tab. Stroke-only (currentColor) so the parent decides the tint,
// matching the other bottom-nav icons.
export function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M 4 20 v -1.5 a 5 5 0 0 1 5 -5 h 6 a 5 5 0 0 1 5 5 v 1.5" />
    </svg>
  )
}
