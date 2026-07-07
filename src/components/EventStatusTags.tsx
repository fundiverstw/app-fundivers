import type { AppEvent } from '../types/database'

// Inline markers appended after an event title on the duty views. A duty tied
// to a cancelled or private event should read as such at a glance, rather than
// looking like an ordinary event or (previously) collapsing to a misleading
// "outside visible range" note.
export function EventStatusTags({ event }: { event: AppEvent }) {
  return (
    <>
      {event.cancelled_at && <span className="text-red-600 font-normal"> · cancelled</span>}
      {event.is_private && <span className="text-brand-900/60 font-normal"> · private</span>}
    </>
  )
}
