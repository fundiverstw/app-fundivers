import { useToast } from '../hooks/useToast'
import { wixEventUrl } from '../lib/event-share'
import type { AppEvent } from '../types/database'

interface Props {
  event: Pick<AppEvent, 'id' | 'type'>
  className?: string
  label?: string
}

const DEFAULT_CLASS = 'text-xs bg-surface-700 hover:bg-surface-800 text-white px-3 py-1 rounded-lg'

export function ShareEventButton({ event, className = DEFAULT_CLASS, label = 'Share link' }: Props) {
  const toast = useToast()
  return (
    <button
      type="button"
      onClick={async () => {
        const url = wixEventUrl(event)
        try {
          await navigator.clipboard.writeText(url)
          toast.success('Link copied to clipboard')
        } catch {
          toast.error('Could not copy link — please copy manually')
        }
      }}
      className={className}
    >
      {label}
    </button>
  )
}
