import { googleCalendarUrl, type CalendarLinkEvent } from '../lib/google-calendar'
import { t } from '../i18n'

interface Props {
  event: CalendarLinkEvent
  className?: string
  label?: string
}

const DEFAULT_CLASS = 'inline-flex items-center justify-center text-xs font-semibold bg-surface-700 hover:bg-surface-800 text-white px-3 py-1 rounded-lg transition-colors'

// An anchor rather than a button because it navigates off-site — but styled as
// an action control, since that's what it is to the diver.
export function AddToGoogleCalendarButton({ event, className = DEFAULT_CLASS, label = t.calendar.addToGoogleCalendar }: Props) {
  return (
    <a
      href={googleCalendarUrl(event)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {label}
    </a>
  )
}
