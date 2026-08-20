import { linkify } from '../lib/linkify'

// Renders plain text with its URLs as real anchors. No HTML string is built
// and no `dangerouslySetInnerHTML` is involved — linkify hands back runs, and
// each run becomes a text node or an <a>.
//
// Long URLs break mid-word rather than widening their container: a Drive
// folder link is one unbreakable token and would otherwise push the page into
// a horizontal scroll on a phone.
//
// brand-800 rather than the lighter brand-700 a link usually gets: on the pale
// card the notification body sits on, brand-700 measures 3.05:1 — over the
// suite's floor but washed out beside body copy at 16:1. brand-800 reads at
// 11.7:1 and still looks like a link next to the text.
export function Linkified({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className}>
      {linkify(text).map((seg, i) => seg.kind === 'link' ? (
        <a
          key={i}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-brand-800/50 hover:decoration-brand-800 text-brand-800 break-all"
        >
          {seg.value}
        </a>
      ) : seg.value)}
    </p>
  )
}
