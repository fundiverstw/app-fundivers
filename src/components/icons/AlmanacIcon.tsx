// Almanac icon — a thermometer inside a compass rose outline. Signals
// "environmental conditions" at a glance, distinct from the MapIcon (site map)
// and the weather widget already on the calendar.

export function AlmanacIcon() {
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
      {/* Compass rose outline */}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      {/* Inner diamond */}
      <path d="M12 6l2 6-2 2-2-2z" fill="currentColor" stroke="none" opacity="0.3" />
      {/* Thermometer in center */}
      <path d="M12 9v6" />
      <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
