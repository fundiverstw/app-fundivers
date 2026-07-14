// "Add a person" glyph for the Manage-page Create-diver card: a single
// head-and-shoulders with a plus, distinguishing it from PeopleIcon (the
// diver directory). Stroke-only (currentColor) so the parent decides the
// tint, matching the other Manage-grid icons.
export function UserPlusIcon() {
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
      <circle cx="9" cy="8" r="3.5" />
      <path d="M 3 20 v -1.5 a 5 5 0 0 1 5 -5 h 2 a 5 5 0 0 1 3 1" />
      <path d="M 18 9 v 6" />
      <path d="M 15 12 h 6" />
    </svg>
  )
}
