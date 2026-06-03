import { describe, it, expect } from 'vitest'
import { safeNotificationTarget } from './sw-notification-target'

describe('safeNotificationTarget (audit M10)', () => {
  it('accepts a bare same-origin path', () => {
    expect(safeNotificationTarget('/calendar')).toBe('/calendar')
  })

  it('accepts a path with query + hash', () => {
    expect(safeNotificationTarget('/admin/events/dive/abc?from=push#detail'))
      .toBe('/admin/events/dive/abc?from=push#detail')
  })

  it('rejects absolute https URLs', () => {
    expect(safeNotificationTarget('https://evil.example/phish')).toBe('/')
  })

  it('rejects protocol-relative URLs (the //host trick)', () => {
    expect(safeNotificationTarget('//evil.example/phish')).toBe('/')
  })

  it('rejects javascript: pseudo-protocol', () => {
    expect(safeNotificationTarget('javascript:alert(1)')).toBe('/')
  })

  it('rejects relative paths (no leading slash)', () => {
    // Could resolve relative to the SW scope and surprise us.
    expect(safeNotificationTarget('admin/duty')).toBe('/')
  })

  it('rejects non-strings', () => {
    expect(safeNotificationTarget(null)).toBe('/')
    expect(safeNotificationTarget(undefined)).toBe('/')
    expect(safeNotificationTarget(42)).toBe('/')
    expect(safeNotificationTarget({ url: '/calendar' })).toBe('/')
  })
})
