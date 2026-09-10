import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from './i18n.ts'
import { needsCjkFont } from './pdf-fonts.ts'
import { siteConfig } from '../../../fundive.config.ts'
import { en, type Messages } from '../../../src/i18n/messages/en.ts'
import { zhTW } from '../../../src/i18n/messages/zh-TW.ts'
import { ja } from '../../../src/i18n/messages/ja.ts'
import type { SupportedLanguage } from '../../../src/config/site.ts'

// The vendored pdf-cjk.ttf must actually contain a glyph for every character the
// PDF prints in the deployment's language. jsPDF does NOT fail on a missing
// glyph — it silently drops it. Noto Sans TC, the default, lacks 7 Japanese
// shinjitai used by the `ja` catalog (払 数 残 録 内 単 団): a Japanese shop that
// forgets to swap the font would email PDFs reading "お支い方法" instead of
// "お支払い方法". This test is the thing that stops that shipping.

// vitest serves this file over a non-file URL, so resolve from the repo root.
const FONT = join(process.cwd(), 'supabase/functions/_shared/pdf-cjk.ttf')

/** Code points the font has a glyph for, from its cmap (formats 4 and 12). */
function fontCoverage(path: string): Set<number> {
  const b = readFileSync(path)
  const numTables = b.readUInt16BE(4)
  let cmapOff = -1
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (b.toString('latin1', rec, rec + 4) === 'cmap') cmapOff = b.readUInt32BE(rec + 8)
  }
  if (cmapOff < 0) throw new Error('no cmap table in ' + path)

  const covered = new Set<number>()
  const n = b.readUInt16BE(cmapOff + 2)
  for (let i = 0; i < n; i++) {
    const sub = cmapOff + b.readUInt32BE(cmapOff + 4 + i * 8 + 4)
    const format = b.readUInt16BE(sub)
    if (format === 4) {
      const segX2 = b.readUInt16BE(sub + 6)
      for (let s = 0; s < segX2 / 2; s++) {
        const end = b.readUInt16BE(sub + 14 + s * 2)
        const start = b.readUInt16BE(sub + 16 + segX2 + s * 2)
        for (let cp = start; cp <= end && cp !== 0xFFFF; cp++) covered.add(cp)
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(sub + 12)
      for (let g = 0; g < groups; g++) {
        const o = sub + 16 + g * 12
        const start = b.readUInt32BE(o), end = b.readUInt32BE(o + 4)
        for (let cp = start; cp <= end; cp++) covered.add(cp)
      }
    }
  }
  return covered
}

/** Every character the PDF may print, from one `pdf` catalog. Function values
 *  are invoked with placeholders so their literal text is included. */
function pdfCatalogText(catalog: Messages): string {
  return Object.values(catalog.pdf as Record<string, unknown>)
    .map(v => (typeof v === 'function' ? String((v as (...a: unknown[]) => string)('x', 'x', 'x')) : String(v)))
    .join('')
}

/** Characters `catalog` prints that the vendored font has no glyph for. */
function missingFor(catalog: Messages, covered: Set<number>): string[] {
  return [...new Set([...pdfCatalogText(catalog)])]
    .filter(ch => needsCjkFont(ch) && !covered.has(ch.codePointAt(0)!))
}

const CATALOGS: Record<SupportedLanguage, Messages> = { en, 'zh-TW': zhTW, ja }

// Which languages the *vendored* file can actually print. Noto Sans TC covers
// Latin, kana and ~15k Traditional-Chinese ideographs but not the Japanese
// shinjitai forms, and jsPDF drops a missing glyph without a word — so this is
// declared rather than discovered. Swap the font file and this list changes:
// Noto Sans JP would serve `ja` and stop serving `zh-TW`.
//
// A shop can only pick a language this list contains. If you need another one,
// the font is the blocker, not the catalog.
const SERVED: SupportedLanguage[] = ['en', 'zh-TW']

describe('pdf-cjk.ttf covers the configured language', () => {
  it('has a glyph for every non-Latin character the PDF prints', () => {
    const covered = fontCoverage(FONT)
    const missing = missingFor(t, covered)

    expect(
      missing,
      `pdf-cjk.ttf is missing ${missing.length} glyph(s): ${missing.join('')}. ` +
      `jsPDF drops them silently. Replace supabase/functions/_shared/pdf-cjk.ttf ` +
      `with a font covering this language (e.g. Noto Sans JP for ja).`,
    ).toEqual([])
  })

  // The test above only sees the language this deployment happens to be set to,
  // so on an English build it passes while `ja` is quietly broken. This one
  // fails the moment the font stops matching what SERVED claims, whichever
  // language is configured.
  it('serves exactly the languages SERVED claims', () => {
    const covered = fontCoverage(FONT)
    const served = (Object.keys(CATALOGS) as SupportedLanguage[])
      .filter(lang => missingFor(CATALOGS[lang], covered).length === 0)

    expect(served.sort()).toEqual([...SERVED].sort())
  })

  it('names what is missing for a language it cannot serve', () => {
    const covered = fontCoverage(FONT)
    const unserved = (Object.keys(CATALOGS) as SupportedLanguage[]).filter(l => !SERVED.includes(l))

    for (const lang of unserved) {
      const missing = missingFor(CATALOGS[lang], covered)
      expect(
        missing.length,
        `${lang} is listed as unserved but the font covers it — add it to SERVED.`,
      ).toBeGreaterThan(0)
    }
  })

  it('the configured language is one the font can serve', () => {
    expect(
      SERVED,
      `locale.language is set to a language pdf-cjk.ttf cannot print. ` +
      `Vendor a font that covers it before shipping this build.`,
    ).toContain(siteConfig.locale.language)
  })

  it('the coverage probe is not vacuous', () => {
    const covered = fontCoverage(FONT)
    expect(covered.has('王'.codePointAt(0)!)).toBe(true)   // TC ideograph: present
    expect(covered.has('A'.codePointAt(0)!)).toBe(true)    // Latin: present
    expect(covered.has('払'.codePointAt(0)!)).toBe(false)  // JP shinjitai: absent
    expect(covered.has('다'.codePointAt(0)!)).toBe(false)  // Hangul syllable: absent
  })
})
