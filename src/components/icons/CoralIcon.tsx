// Coral icon — a branching colony over a base line. Distinct from the
// AlmanacIcon (compass rose and thermometer) and the MapIcon (site map): this
// one names the organism, because the page is about colonies rather than
// conditions.

export function CoralIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Seabed */}
      <path d="M3 21h18" />
      {/* Central stem */}
      <path d="M12 21v-7" />
      {/* Left branch, forking */}
      <path d="M12 16l-3-3" />
      <path d="M9 13V9" />
      <path d="M9 13l-2.5-2" />
      {/* Right branch, forking */}
      <path d="M12 15l3.5-3.5" />
      <path d="M15.5 11.5V7.5" />
      <path d="M15.5 11.5l2 1.5" />
      {/* Polyp tips */}
      <circle cx="9" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}
