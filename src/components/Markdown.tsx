import type { ReactNode } from 'react'

// A deliberately small Markdown subset, rendered straight to React nodes.
//
// The shop authors its own Terms of Use, so the body is untrusted-ish text that
// ends up on a public page. Rather than pull in a Markdown-to-HTML library plus
// a sanitiser — two dependencies and an XSS surface — we never build an HTML
// string at all. `dangerouslySetInnerHTML` appears nowhere in this codebase and
// this component does not change that.
//
// Supported, because it is what a Terms document needs:
//   # / ## / ###   headings
//   - or *         bullet list
//   1.             ordered list
//   blank line     paragraph break
//   **bold**  *italic*  `code`
//   [text](https://…)   links, http(s) only
//
// Anything else renders as literal text. That is the safe failure mode: a shop
// sees its raw syntax and fixes it, rather than silently shipping broken markup.

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

/** Split one line into bold / italic / code / link / plain React nodes. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  for (const part of text.split(INLINE)) {
    if (!part) continue
    const key = `${keyPrefix}-${i++}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push(<strong key={key}>{part.slice(2, -2)}</strong>)
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out.push(<code key={key} className="text-xs bg-surface-100 px-1 rounded">{part.slice(1, -1)}</code>)
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>)
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
      // Only http(s). A `javascript:` or `data:` href would be an injection.
      if (link && /^https?:\/\//i.test(link[2])) {
        out.push(
          <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline">
            {link[1]}
          </a>,
        )
      } else {
        out.push(<span key={key}>{part}</span>)
      }
    }
  }
  return out
}

const HEADING_CLASS: Record<number, string> = {
  1: 'text-xl font-bold text-brand-900',
  2: 'text-lg font-bold text-brand-900',
  3: 'text-base font-semibold text-brand-900',
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')

  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushPara = () => {
    if (!para.length) return
    blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    const cls = list.ordered ? 'list-decimal pl-5 space-y-1' : 'list-disc pl-5 space-y-1'
    blocks.push(
      <Tag key={`l${blocks.length}`} className={cls}>
        {list.items.map((it, n) => <li key={n}>{inline(it, `l${blocks.length}-${n}`)}</li>)}
      </Tag>,
    )
    list = null
  }
  const flush = () => { flushPara(); flushList() }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) { flush(); continue }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3'
      blocks.push(<Tag key={`h${blocks.length}`} className={HEADING_CLASS[level]}>{inline(heading[2], `h${blocks.length}`)}</Tag>)
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flushPara()
      const isOrdered = !!ordered
      const item = (bullet ?? ordered)![1]
      if (list && list.ordered !== isOrdered) flushList()
      list ??= { ordered: isOrdered, items: [] }
      list.items.push(item)
      continue
    }

    flushList()
    para.push(line.trim())
  }
  flush()

  return <div className="space-y-3">{blocks}</div>
}
