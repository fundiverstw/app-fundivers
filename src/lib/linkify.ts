// Splits plain text into runs of text and the URLs inside it, so a body the
// shop typed by hand can be rendered with real anchors.
//
// Notification bodies are plain text, not Markdown: an admin pastes a Google
// Drive folder link after a trip and every diver on the event needs to be able
// to tap it. Running the bodies through the Markdown component instead would
// reflow the whitespace and eat any stray asterisk, so this stays a splitter —
// it never builds HTML, and the caller decides what an anchor looks like.
//
// Recognized: http:// and https:// URLs, plus a bare www. host (rendered with
// https:// prepended). Nothing else — a `javascript:` or `data:` run is text,
// which is the safe failure mode.

export type LinkifySegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string }

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi

// A URL that ends a sentence swallows the punctuation unless we hand it back.
// Closing brackets only count as part of the URL when the URL opened them,
// which is what keeps "(see https://x.test/a)" from linking the paren.
const TRAILING = /[.,;:!?]+$/
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

function trimTrailing(url: string): { url: string; rest: string } {
  let end = url.length
  for (;;) {
    const slice = url.slice(0, end)
    const punct = TRAILING.exec(slice)
    if (punct) { end -= punct[0].length; continue }
    const last = slice.slice(-1)
    const opener = CLOSERS[last]
    if (opener) {
      const inner = slice.slice(0, -1)
      const opens = inner.split(opener).length - 1
      const closes = inner.split(last).length - 1
      if (opens <= closes) { end -= 1; continue }
    }
    break
  }
  return { url: url.slice(0, end), rest: url.slice(end) }
}

export function linkify(text: string): LinkifySegment[] {
  const out: LinkifySegment[] = []
  let last = 0
  const push = (kind: 'text', value: string) => {
    if (!value) return
    const prev = out[out.length - 1]
    if (prev?.kind === kind) prev.value += value
    else out.push({ kind, value })
  }

  URL_RE.lastIndex = 0
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    const { url, rest } = trimTrailing(m[0])
    // Nothing survived the trim (a bare "www." say) — leave it as text.
    if (!/^https?:\/\/\S/i.test(url) && !/^www\.\S/i.test(url)) {
      push('text', text.slice(last, m.index + m[0].length))
      last = m.index + m[0].length
      continue
    }
    push('text', text.slice(last, m.index))
    out.push({
      kind: 'link',
      value: url,
      href: /^www\./i.test(url) ? `https://${url}` : url,
    })
    push('text', rest)
    last = m.index + m[0].length
  }
  push('text', text.slice(last))
  return out
}

/** True when the text carries at least one link — cheaper than rendering. */
export function hasLink(text: string): boolean {
  return linkify(text).some(s => s.kind === 'link')
}
