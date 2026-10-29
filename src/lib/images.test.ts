import { describe, it, expect } from 'vitest'
import { resolveImageUrl } from './images'

describe('resolveImageUrl', () => {
  it('passes a site path through', () => {
    expect(resolveImageUrl('/imgs/media/b37fef_abc_mv2_jpg.webp')).toBe('/imgs/media/b37fef_abc_mv2_jpg.webp')
  })

  it('passes an http(s) URL through, trimmed', () => {
    expect(resolveImageUrl('  https://cdn.example/hero.jpg ')).toBe('https://cdn.example/hero.jpg')
    expect(resolveImageUrl('http://cdn.example/hero.jpg')).toBe('http://cdn.example/hero.jpg')
  })

  it('returns null for nothing usable', () => {
    expect(resolveImageUrl(null)).toBeNull()
    expect(resolveImageUrl(undefined)).toBeNull()
    expect(resolveImageUrl('   ')).toBeNull()
    expect(resolveImageUrl('//evil.example/x.jpg')).toBeNull()
    expect(resolveImageUrl('javascript:alert(1)')).toBeNull()
    expect(resolveImageUrl('photo.jpg')).toBeNull()
  })
})
