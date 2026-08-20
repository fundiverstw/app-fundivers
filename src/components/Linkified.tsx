import { linkify } from '../lib/linkify'

// Renders plain text with its URLs as real anchors. No HTML string is built
// and no `dangerouslySetInnerHTML` is involved — linkify hands back runs, and
// each run becomes a text node or an <a>.
//
// Long URLs break mid-word rather than widening their container: a Drive
// folder link is one unbreakable token and would otherwise push the page into
// a horizontal scroll on a phone.
export function Linkified({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className}>
      {linkify(text).map((seg, i) => seg.kind === 'link' ? (
        <a
          key={i}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-brand-700/50 hover:decoration-brand-700 text-brand-700 break-all"
        >
          {seg.value}
        </a>
      ) : seg.value)}
    </p>
  )
}
