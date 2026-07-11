import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from './Markdown'

// This renderer exists so the shop's Terms of Use never become an HTML string.
// The security property is the point of the component; the formatting is the
// convenience. Both are pinned here.

describe('Markdown', () => {
  it('renders headings, paragraphs and lists', () => {
    const { container } = render(<Markdown source={'# Title\n\nHello there.\n\n- one\n- two'} />)
    expect(container.querySelector('h1')!.textContent).toBe('Title')
    expect(screen.getByText('Hello there.')).toBeInTheDocument()
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
  })

  it('keeps ordered and unordered lists apart', () => {
    const { container } = render(<Markdown source={'- a\n\n1. b\n2. c'} />)
    expect(container.querySelectorAll('ul li')).toHaveLength(1)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
  })

  it('joins wrapped lines into one paragraph', () => {
    render(<Markdown source={'we collect\nyour email'} />)
    expect(screen.getByText('we collect your email')).toBeInTheDocument()
  })

  it('renders bold, italic and code inline', () => {
    const { container } = render(<Markdown source={'a **b** c *d* e `f`'} />)
    expect(container.querySelector('strong')!.textContent).toBe('b')
    expect(container.querySelector('em')!.textContent).toBe('d')
    expect(container.querySelector('code')!.textContent).toBe('f')
  })

  it('renders http(s) links, opened safely', () => {
    const { container } = render(<Markdown source={'see [our site](https://example.com)'} />)
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  // ── the security contract ────────────────────────────────────────────────
  it('never emits raw HTML from the source', () => {
    const { container } = render(<Markdown source={'<img src=x onerror="alert(1)"> <b>hi</b>'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    // The angle brackets survive as literal text, which is the safe failure mode.
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('refuses javascript: and data: links, rendering them as text', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>1</script>']) {
      const { container, unmount } = render(<Markdown source={`[click](${href})`} />)
      expect(container.querySelector('a')).toBeNull()
      expect(container.textContent).toContain('click')
      unmount()
    }
  })

  it('renders an empty source without crashing', () => {
    const { container } = render(<Markdown source="" />)
    expect(container.textContent).toBe('')
  })
})
