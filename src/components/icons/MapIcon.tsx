// Folded-map glyph for the diver-shell shortcut to /map. Stroke-only
// (currentColor) so the parent decides the tint — typically red on the
// header.
export function MapIcon() {
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
      <path d="M9 4 L3 6 L3 20 L9 18 L15 20 L21 18 L21 4 L15 6 Z" />
      <line x1="9" y1="4" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="20" />
    </svg>
  )
}
