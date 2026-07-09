import { useToast } from '../hooks/useToast'
import { wixEventUrl } from '../lib/event-share'
import type { AppEvent } from '../types/database'
import { t } from '../i18n'

interface Props {
  event: Pick<AppEvent, 'id' | 'type'>
  className?: string
  label?: string
}

const DEFAULT_CLASS = 'text-xs bg-surface-700 hover:bg-surface-800 text-white px-3 py-1 rounded-lg'

export function ShareEventButton({ event, className = DEFAULT_CLASS, label = t.share.shareLink }: Props) {
  const toast = useToast()
  return (
    <button
      type="button"
      onClick={async () => {
        const url = wixEventUrl(event)
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
