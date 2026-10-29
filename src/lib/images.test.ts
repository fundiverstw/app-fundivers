import { describe, it, expect } from 'vitest'
import { resolveImageUrl } from './images'

describe('resolveImageUrl', () => {
  it('passes a site path through', () => {
    expect(resolveImageUrl('/imgs/media/b37fef_abc_mv2_jpg.webp')).toBe('/imgs/media/b37fef_abc_mv2_jpg.webp')
  })

  it('passes an https URL through, trimmed', () => {
    expect(resolveImageUrl('  https://x.supabase.co/storage/v1/object/public/a%20b.jpg ')).toBe(
      'https://x.supabase.co/storage/v1/object/public/a%20b.jpg',
    )
  })

  it('returns null for nothing usable', () => {
    expect(resolveImageUrl(null)).toBeNull()
    expect(resolveImageUrl(undefined)).toBeNull()
    expect(resolveImageUrl('   ')).toBeNull()
    expect(resolveImageUrl('photo.jpg')).toBeNull()
    expect(resolveImageUrl('javascript:alert(1)')).toBeNull()
    // A leftover Wix media ref is no longer understood.
    expect(resolveImageUrl('wix:image://v1/b37fef_abc~mv2.jpg/x.jpg#originWidth=1')).toBeNull()
  })

  it('rejects plain http (mixed content)', () => {
    expect(resolveImageUrl('http://cdn.example/hero.jpg')).toBeNull()
  })

  it('rejects refs a browser would turn into an off-site address', () => {
    expect(resolveImageUrl('//evil.example/x.jpg')).toBeNull()
    expect(resolveImageUrl('/\\evil.example/x.jpg')).toBeNull()
    expect(resolveImageUrl('/\t/evil.example/x.jpg')).toBeNull()
    expect(resolveImageUrl('/\n/evil.example/x.jpg')).toBeNull()
  })
})
