// Wildlife icon — a fish in profile. Marks the taxon catalog: the almanac's
// compass-and-thermometer says "conditions", and this says "what was in the
// water", which is the other half of an observation.

export function FishIcon() {
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
      <path d="M3 12c3-4 7-6 11-6 3 0 5 2 6 4-1 2-3 4-6 4-4 0-8-2-11-6z" />
      <path d="M14 6c1-1.5 2-2.5 3-3v6" />
      <path d="M3 12l-1 4 4-2" />
      <circle cx="8" cy="11" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}
