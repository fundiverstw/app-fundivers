import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MIN_TEXT_CONTRAST,
  backgroundColorFor,
  baseUtility,
  composite,
  contrastRatio,
  oklchToRgb,
  parseHex,
  readPalette,
  relativeLuminance,
  textColorFor,
} from './contrast'

const palette = readPalette(
  readFileSync('node_modules/tailwindcss/theme.css', 'utf8'),
  readFileSync('src/index.css', 'utf8'),
)
const PAGE = palette.page

const bg = (cls: string, backdrop = PAGE) => backgroundColorFor(cls, palette, backdrop)
const fg = (cls: string, backdrop = PAGE) => textColorFor(cls, palette, backdrop)

/** Contrast of a text class against a background class, as the eye sees it. */
function ratio(bgClass: string, textClass: string): number {
  const back = bg(bgClass)
  expect(back, `${bgClass} resolved`).not.toBeNull()
  const ink = fg(textClass, back!)
  expect(ink, `${textClass} resolved`).not.toBeNull()
  return contrastRatio(back!, ink!)
}

describe('color math', () => {
  it('converts oklch to sRGB', () => {
    expect(oklchToRgb(1, 0, 0)).toEqual({ r: 255, g: 255, b: 255 })
    expect(oklchToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 })
    const red = oklchToRgb(0.637, 0.237, 25.331)
    expect(red.r).toBeGreaterThan(230)
    expect(red.g).toBeLessThan(60)
  })

  it('parses short and long hex', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('#0a1120')).toEqual({ r: 10, g: 17, b: 32 })
  })

  it('composites a translucent color onto its backdrop', () => {
    expect(composite({ r: 255, g: 255, b: 255 }, 0.5, { r: 0, g: 0, b: 0 }))
      .toEqual({ r: 128, g: 128, b: 128 })
  })

  it('scores black on white at the WCAG maximum', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1)
  })

  it('scores a color against itself at 1:1', () => {
    const c = { r: 12, g: 90, b: 200 }
    expect(contrastRatio(c, c)).toBe(1)
  })

  it('orders luminance from black to white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
  })
})

describe('palette resolution', () => {
  it('reads the page background from index.css', () => {
    expect(PAGE).toEqual(parseHex('#0a1120'))
  })

  it('resolves plain Tailwind palette classes', () => {
    expect(bg('bg-rose-50')).toEqual(parseHex('#fff1f2'))
  })

  it('resolves the app @theme seam', () => {
    expect(fg('text-reef-300')).toEqual(parseHex('#66e6da'))
  })

  // The retrofit is why source that reads "dark ink" ships as near-white ink.
  it('applies the dark retrofit rather than the literal Tailwind value', () => {
    expect(relativeLuminance(fg('text-brand-900')!)).toBeGreaterThan(0.8)
    expect(relativeLuminance(fg('text-brand-950')!)).toBeGreaterThan(0.8)
    expect(relativeLuminance(bg('bg-white')!)).toBeLessThan(0.05)
    expect(relativeLuminance(bg('bg-surface-50')!)).toBeLessThan(0.05)
  })

  it('applies [class*=…] prefix overrides to opacity variants', () => {
    expect(relativeLuminance(fg('text-brand-900/80')!)).toBeGreaterThan(0.5)
  })

  it('composites alpha utilities onto the backdrop they sit on', () => {
    const overDark = bg('bg-red-500/15', parseHex('#000000'))!
    const overLight = bg('bg-red-500/15', parseHex('#ffffff'))!
    expect(relativeLuminance(overDark)).toBeLessThan(relativeLuminance(overLight))
  })

  it('ignores classes that paint no color', () => {
    expect(bg('bg-transparent')).toBeNull()
    expect(bg('bg-cover')).toBeNull()
    expect(fg('text-xs')).toBeNull()
    expect(fg('text-center')).toBeNull()
  })

  it('strips state and breakpoint variants', () => {
    expect(baseUtility('hover:bg-white/70')).toBe('bg-white/70')
    expect(baseUtility('md:group-hover:text-red-300')).toBe('text-red-300')
  })
})

describe('the gate', () => {
  // The reported bug: a pale rose card whose ink the retrofit turns near-white.
  it('rejects brand ink on a pale status card', () => {
    expect(ratio('bg-rose-50', 'text-brand-950')).toBeLessThan(MIN_TEXT_CONTRAST)
    expect(ratio('bg-amber-50', 'text-brand-900')).toBeLessThan(MIN_TEXT_CONTRAST)
  })

  it('accepts the same-hue ink those cards should use', () => {
    expect(ratio('bg-rose-50', 'text-rose-900')).toBeGreaterThan(MIN_TEXT_CONTRAST)
    expect(ratio('bg-amber-50', 'text-amber-900')).toBeGreaterThan(MIN_TEXT_CONTRAST)
  })

  // "Close but not the same" is the interesting case — an equality check on
  // two colors would pass every one of these.
  it('rejects colors that merely sit near each other, not only identical ones', () => {
    const nearMisses: [string, string][] = [
      ['bg-white/70', 'text-violet-700'],
      ['bg-surface-50', 'text-red-700'],
      ['bg-amber-400/10', 'text-amber-800'],
      ['bg-white/70', 'text-red-700'],
    ]
    for (const [b, text] of nearMisses) {
      const r = ratio(b, text)
      expect(r, `${text} on ${b}`).toBeGreaterThan(1)
      expect(r, `${text} on ${b}`).toBeLessThan(MIN_TEXT_CONTRAST)
    }
  })

  it('accepts the light-end status ink those dark surfaces should use', () => {
    expect(ratio('bg-white/70', 'text-violet-300')).toBeGreaterThan(MIN_TEXT_CONTRAST)
    expect(ratio('bg-surface-50', 'text-red-300')).toBeGreaterThan(MIN_TEXT_CONTRAST)
    expect(ratio('bg-amber-400/10', 'text-amber-300')).toBeGreaterThan(MIN_TEXT_CONTRAST)
    expect(ratio('bg-white/70', 'text-red-300')).toBeGreaterThan(MIN_TEXT_CONTRAST)
  })
})
