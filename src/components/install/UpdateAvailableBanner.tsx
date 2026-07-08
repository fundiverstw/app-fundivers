// Surfaces "a new version is available — tap to update" when the SW has
// a fresh build waiting. Shows on every platform (Android, iOS, desktop)
// because the update mechanism is the same: post SKIP_WAITING, listen for
// controllerchange, reload. The mobile case is the motivating one — a PWA
// added to the home screen on iOS may stay open across days, so without
// this prompt the user has no visual cue that a deploy has landed.
//
// Single action — Update. There is deliberately no Later/dismiss: an
// out-of-date PWA can hit a backend API the deploy already migrated past,
// so we want the banner to stay loud until the reload happens.

interface Props {
  onUpdate: () => void
}

export function UpdateAvailableBanner({ onUpdate }: Props) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[110] bg-brand-700 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm shadow-md"
    >
      <span className="font-semibold">A new version is available.</span>
      <button
        type="button"
        onClick={onUpdate}
        className="bg-reef-500 text-slate-950 font-semibold px-3 py-1 rounded-md hover:bg-reef-400 transition-colors"
      >
        Update
      </button>
    </div>
  )
}
