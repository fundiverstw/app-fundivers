import { describe, it, expect, vi, beforeEach } from 'vitest'
import { channelHref, channelLabel } from './contact'
import { t } from '../i18n'

vi.mock('./supabase', () => ({ supabase: {} }))

beforeEach(() => vi.clearAllMocks())

describe('where a contact button points', () => {
  it('uses a chat service link exactly as the shop pasted it', () => {
    expect(channelHref({ kind: 'line', url: 'https://line.me/R/ti/p/%40x' }))
      .toBe('https://line.me/R/ti/p/%40x')
    expect(channelHref({ kind: 'other', url: 'https://example.com/chat' }))
      .toBe('https://example.com/chat')
  })

  // The admin types a phone number into a box labelled "phone number"; the
  // scheme, and the stripping a dialler needs, happen here.
  it('dials a phone number, punctuation and spacing removed', () => {
    expect(channelHref({ kind: 'phone', url: '+886 909-083-683' })).toBe('tel:+886909083683')
    expect(channelHref({ kind: 'phone', url: '(02) 1234 5678' })).toBe('tel:0212345678')
    expect(channelHref({ kind: 'sms', url: '+886 909 083 683' })).toBe('sms:+886909083683')
  })

  it('keeps a leading plus as the country prefix and nowhere else', () => {
    expect(channelHref({ kind: 'phone', url: '+886-9+09' })).toBe('tel:+886909')
    expect(channelHref({ kind: 'phone', url: '886+909' })).toBe('tel:886909')
  })
})

describe('what a contact button says', () => {
  it('uses the deployment wording for the service when the shop wrote none', () => {
    expect(channelLabel({ kind: 'line', label: null })).toBe(t.contact.channelDefaults.line)
    expect(channelLabel({ kind: 'phone', label: '   ' })).toBe(t.contact.channelDefaults.phone)
  })

  // Shop-authored text is user-generated content and is never translated.
  it('uses the shop\'s own wording when it wrote some', () => {
    expect(channelLabel({ kind: 'line', label: 'Ask us about courses' }))
      .toBe('Ask us about courses')
  })

  it('has wording for every service in the vocabulary', () => {
    for (const kind of Object.keys(t.contact.channelDefaults)) {
      expect(t.contact.channelDefaults[kind as 'line']).toBeTruthy()
    }
  })
})
