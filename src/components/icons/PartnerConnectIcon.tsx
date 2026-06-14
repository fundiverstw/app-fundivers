// "PX" monogram for the Partner Connect header shortcut. currentColor so
// the parent picks the tint — red on the diver header. Drawn as a rounded
// badge with the letters carved out, matching the icon-sized affordances
// (radio / map) on the other side of the bar.
export function PartnerConnectIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">
      <rect x="1" y="4" width="22" height="16" rx="4" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="#fff"
      >
        PX
      </text>
    </svg>
  )
}
