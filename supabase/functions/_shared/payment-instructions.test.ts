import { describe, it, expect } from 'vitest'
import {
  paymentInstructionsFor as edgeInstructions,
  paymentConfirmationReminder as edgeReminder,
  SHOP_PHONE, SHOP_ADDRESS, SHOP_MAPS_URL, PAYPAL_LINK,
} from './payment-instructions.ts'
import { siteConfig } from '../../../fundive.config.ts'
import { en } from '../../../src/i18n/messages/en.ts'

// This module feeds pdf.ts, which renders with jsPDF's built-in helvetica — a
// WinAnsi font with no CJK glyphs. So it is pinned to the English catalog rather
// than the deployment's language: a translated PDF would emit mangled bytes, not
// Chinese. These tests pin BOTH halves of that contract — the copy comes from the
// one catalog (so it can't drift from the SPA's), and it is the `en` one.
const p = en.paymentInstructions
const surcharge = `+${siteConfig.business.cardSurchargePercent}%`

describe('edge payment instructions', () => {
  it('renders cash from the English catalog, with the shop config values', () => {
    expect(edgeInstructions('cash')).toEqual({
      title: p.cashTitle,
      lines: [p.cashLine, p.phone(SHOP_PHONE), p.address(SHOP_ADDRESS), p.map(SHOP_MAPS_URL)],
    })
  })

  it('renders bank_transfer without leaking raw account details', () => {
    const i = edgeInstructions('bank_transfer')!
    expect(i).toEqual({ title: p.bankTitle, lines: [p.bankLine] })
    expect(i.lines.join(' ')).not.toMatch(/code:|account:|branch:/i)
  })

  it('renders paypal with the surcharge in the title and the link in the body', () => {
    expect(edgeInstructions('paypal')).toEqual({
      title: p.paypalTitle(surcharge),
      lines: [p.paypalLine, PAYPAL_LINK, p.paypalNote],
    })
  })

  it('echoes a supplied invoice email, and falls back when it is blank', () => {
    expect(edgeInstructions('credit_card', { invoiceEmail: 'invoices@example.com' })!.lines)
      .toContain(p.invoiceTo('invoices@example.com'))
    expect(edgeInstructions('credit_card', { invoiceEmail: '   ' })!.lines)
      .toContain(p.invoiceTo(p.registeredEmail))
    expect(edgeInstructions('credit_card')!.lines)
      .toContain(p.invoiceTo(p.registeredEmail))
  })

  it('returns null for a payment method the SPA never emits', () => {
    expect(edgeInstructions('crypto')).toBeNull()
  })

  it('renders the after-you-pay reminder from the English catalog', () => {
    expect(edgeReminder()).toEqual({
      title: p.afterTitle,
      lines: [
        p.afterContact(siteConfig.identity.shortName),
        p.afterApp(siteConfig.identity.shopName),
      ],
    })
  })

  // The PDF must stay renderable under jsPDF's standard-14 helvetica, whose
  // encoding is WinAnsi (cp1252). Latin-1 plus the cp1252 0x80-0x9F block — which
  // includes the em dash this copy uses — is fine; anything else (CJK) silently
  // renders as mangled bytes rather than failing. Verified against jsPDF: "防"
  // comes out as "–2", while "—" round-trips intact.
  const CP1252_EXTRAS = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152'
    + '\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178'
  const encodable = (ch: string) => {
    const cp = ch.codePointAt(0)!
    return cp <= 0xFF || CP1252_EXTRAS.includes(ch)
  }

  it('emits only characters jsPDF WinAnsi helvetica can encode', () => {
    const all = [
      ...(['cash', 'bank_transfer', 'paypal', 'credit_card'] as const)
        .flatMap(m => { const i = edgeInstructions(m)!; return [i.title, ...i.lines] }),
      edgeReminder().title, ...edgeReminder().lines,
    ].join(' ')
    expect([...all].filter(ch => !encodable(ch))).toEqual([])
  })

  it('would reject CJK copy, so the guard above is not vacuous', () => {
    expect([...'防寒衣'].filter(ch => !encodable(ch))).toEqual(['防', '寒', '衣'])
    expect([...'How to pay — Cash'].filter(ch => !encodable(ch))).toEqual([])
  })
})
