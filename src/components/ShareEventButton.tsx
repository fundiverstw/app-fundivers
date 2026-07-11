import { useToast } from '../hooks/useToast'
import { eventShareUrl } from '../lib/event-share'
import { t } from '../i18n'

interface Props {
  eventId: string
  className?: string
  label?: string
}

const DEFAULT_CLASS = 'text-xs bg-surface-700 hover:bg-surface-800 text-white px-3 py-1 rounded-lg'

export function ShareEventButton({ eventId, className = DEFAULT_CLASS, label = t.share.shareLink }: Props) {
  const toast = useToast()
  const url = eventShareUrl(eventId)
  if (!url) return null
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          toast.success(t.share.copied)
        } catch {
          toast.error(t.share.copyFailed)
        }
      }}
      className={className}
    >
      {label}
    </button>
  )
}
