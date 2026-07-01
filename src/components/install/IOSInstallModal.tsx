import { MODAL_BACKDROP, MODAL_PANEL, BTN_PRIMARY, TEXT_HEADING, TEXT_BODY } from '../../styles/tokens'
import { siteConfig } from '../../config/site'

// iOS Safari can't trigger an install programmatically — the user has
// to tap the Share button in Safari's toolbar and pick "Add to Home
// Screen". This modal walks them through that.
function ShareGlyph() {
  // Apple's share glyph: an upward arrow rising out of an open box.
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block align-text-bottom"
    >
      <path d="M12 3 L12 15" />
      <path d="M8 7 L12 3 L16 7" />
      <path d="M5 12 L5 20 L19 20 L19 12" />
    </svg>
  )
}

function PlusBoxGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block align-text-bottom"
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

export function IOSInstallModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className={`${MODAL_BACKDROP} flex items-center justify-center p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-install-title"
      onClick={onDismiss}
    >
      <div
        className={`${MODAL_PANEL} max-w-md w-full p-6 space-y-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="ios-install-title" className={`text-xl text-center ${TEXT_HEADING}`}>
          Install {siteConfig.identity.shortName} on iPhone
        </h2>
        <ol className={`text-sm space-y-3 ${TEXT_BODY}`}>
          <li>
            Tap the Share button <ShareGlyph /> at the bottom of Safari.
          </li>
          <li>
            Scroll and choose <strong>Add to Home Screen</strong> <PlusBoxGlyph />.
          </li>
          <li>
            Tap <strong>Add</strong> in the top-right corner.
          </li>
        </ol>
        <p className="text-xs text-brand-900/80">
          This only works in Safari — Chrome, Firefox, and in-app browsers
          on iOS can't add to the home screen.
        </p>
        <button onClick={onDismiss} className={`w-full ${BTN_PRIMARY}`}>
          Got it
        </button>
      </div>
    </div>
  )
}
