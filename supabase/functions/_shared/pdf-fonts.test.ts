import { describe, it, expect } from 'vitest'
import { needsCjkFont, payloadNeedsCjkFont } from './pdf-fonts.ts'

// jsPDF's built-in helvetica is a standard-14 font with WinAnsi (cp1252)
// encoding. Feeding it CJK does not throw — it silently emits mangled bytes
// (verified: "防寒衣" renders as "–2[Òˆc"). These helpers decide when to switch
// to the embedded TrueType face, so a false negative means a corrupt PDF.

describe('needsCjkFont', () => {
  it('is false for text helvetica can encode', () => {
    expect(needsCjkFont('Sam Diver')).toBe(false)
    expect(needsCjkFont('How to pay — Cash')).toBe(false)   // em dash IS cp1252
    expect(needsCjkFont('Café Ångström ÿ')).toBe(false)      // Latin-1
    expect(needsCjkFont('“quotes” … • –')).toBe(false)       // cp1252 0x80-0x9F block
    expect(needsCjkFont('')).toBe(false)
  })

  it('is true for CJK, kana and fullwidth punctuation', () => {
    expect(needsCjkFont('王小明')).toBe(true)
    expect(needsCjkFont('さくら')).toBe(true)
    expect(needsCjkFont('日本語テスト')).toBe(true)
    expect(needsCjkFont('綠島')).toBe(true)
    expect(needsCjkFont('（全角）')).toBe(true)
  })

  it('is true when a single CJK char hides inside Latin text', () => {
    expect(needsCjkFont('Name: 王 (Alice)')).toBe(true)
  })
})

describe('payloadNeedsCjkFont', () => {
  it('walks nested strings, arrays and objects', () => {
    expect(payloadNeedsCjkFont({ name: 'Sam', gearItems: ['BCD', 'Fins'] })).toBe(false)
    expect(payloadNeedsCjkFont({ name: 'Sam', gearItems: ['BCD', '防寒衣'] })).toBe(true)
    expect(payloadNeedsCjkFont({ a: { b: { c: 'さくら' } } })).toBe(true)
  })

  it('ignores non-string leaves', () => {
    expect(payloadNeedsCjkFont({ total: 5000, paid: true, when: null, missing: undefined })).toBe(false)
  })

  // An all-Latin registration must not pay for a ~260KB embedded font stream.
  it('is false for a realistic Latin-only payload', () => {
    expect(payloadNeedsCjkFont({
      eventTitle: 'Green Island Boat Dive', name: 'Sam Diver',
      email: 'sam@example.com', paymentMethod: 'cash', total: 5000,
    })).toBe(false)
  })
})
