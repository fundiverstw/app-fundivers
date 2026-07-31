import type { ReactNode } from 'react'

/**
 * A collapsible section: a click-to-expand <details> with an enlarged,
 * easy-to-hit chevron and a comfortable full-width tap target. Collapsed by
 * default so a dense screen (an admin diver card, say) opens as a short list of
 * headers the reader expands only where they need to.
 *
 * `card` wraps it in the standard frosted panel chrome; without it the
 * disclosure is a bare inline group (a lighter sub-field inside a card).
 *
 * The chevron is a real glyph rather than the native <details> marker so it can
 * be sized up and rotated — the native marker is tiny and unstyleable, which is
 * exactly the "too small to click" problem this replaces.
 */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  card = false,
  titleClassName = 'text-xs font-semibold text-brand-700 uppercase tracking-wider',
  bodyClassName = 'pt-2 space-y-2',
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  card?: boolean
  titleClassName?: string
  bodyClassName?: string
}) {
  return (
    <details
      open={defaultOpen}
      className={`group ${card ? 'bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl px-4 py-1.5' : ''}`}
    >
      <summary className="flex items-center gap-2 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="text-reef-300 text-lg leading-none transition-transform group-open:rotate-90"
        >
          &#9656;
        </span>
        <span className={titleClassName}>{title}</span>
      </summary>
      <div className={bodyClassName}>{children}</div>
    </details>
  )
}
