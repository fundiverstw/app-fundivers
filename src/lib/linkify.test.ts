import { describe, it, expect } from 'vitest'
import { linkify, hasLink } from './linkify'

const links = (s: string) => linkify(s).filter(x => x.kind === 'link')
const text = (s: string) => linkify(s).map(x => x.value).join('')

describe('linkify', () => {
  it('leaves text with no URL as a single run', () => {
    expect(linkify('See you at the pier at 8.')).toEqual([
      { kind: 'text', value: 'See you at the pier at 8.' },
    ])
  })

  it('pulls a https URL out of the sentence around it', () => {
    const segs = linkify('Photos: https://drive.google.com/drive/folders/1AbC_dEf enjoy!')
    expect(segs).toEqual([
      { kind: 'text', value: 'Photos: ' },
      {
        kind: 'link',
        value: 'https://drive.google.com/drive/folders/1AbC_dEf',
        href: 'https://drive.google.com/drive/folders/1AbC_dEf',
      },
      { kind: 'text', value: ' enjoy!' },
    ])
  })

  it('finds every link in a multi-line body', () => {
    const body = 'Photos:\nhttps://drive.google.com/a\nVideo:\nhttps://drive.google.com/b'
    expect(links(body).map(l => l.href)).toEqual([
      'https://drive.google.com/a',
      'https://drive.google.com/b',
    ])
  })

  it('gives a bare www host an https scheme without changing what is shown', () => {
    const [seg] = links('Book at www.fundiverstw.com today')
    expect(seg).toEqual({ kind: 'link', value: 'www.fundiverstw.com', href: 'https://www.fundiverstw.com' })
  })

  it('hands back sentence punctuation instead of swallowing it', () => {
    const segs = linkify('Album is at https://drive.google.com/x.')
    expect(segs[1]).toMatchObject({ value: 'https://drive.google.com/x' })
    expect(segs[2]).toEqual({ kind: 'text', value: '.' })
  })

  it('keeps a bracket the URL opened, drops one it did not', () => {
    expect(links('see https://x.test/a_(b) now')[0].value).toBe('https://x.test/a_(b)')
    expect(links('(see https://x.test/a) now')[0].value).toBe('https://x.test/a')
  })

  it('refuses a scheme that is not http(s) — it stays literal text', () => {
    for (const hostile of ['javascript:alert(1)', 'data:text/html;base64,PHN2Zz4=', 'file:///etc/passwd']) {
      expect(links(`tap ${hostile} here`)).toHaveLength(0)
    }
  })

  it('never loses or invents a character', () => {
    for (const body of [
      'plain',
      'https://a.test',
      'a https://a.test b www.c.test d.',
      '(https://a.test/x_(y)) trailing',
      'no scheme: www. alone',
    ]) {
      expect(text(body)).toBe(body)
    }
  })

  it('reports whether a body carries a link at all', () => {
    expect(hasLink('nothing here')).toBe(false)
    expect(hasLink('grab https://a.test')).toBe(true)
  })
})
