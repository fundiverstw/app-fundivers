import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { needsCjkFont } from './pdf-fonts.ts'
import { en } from '../../../src/i18n/messages/en.ts'
import { zhTW } from '../../../src/i18n/messages/zh-TW.ts'
import type { RegistrationPdfPayload, GroupRegistrationPdfPayload } from './pdf.ts'
import type { ShopContact, PaymentMethodDetails } from '../../../src/lib/payment-method-format.ts'

// The one invariant this file exists to hold: no string that helvetica cannot
// encode is ever drawn under helvetica.
//
// pdf-fonts.test.ts checks the predicates in isolation and pdf-font-coverage.ts
// checks the font file, but neither can see a `doc.setFont("helvetica", …)` that
// someone puts in front of a `doc.text()`. That mistake produces no error, no
// warning and no failing test — just a PDF reading "–2[Òˆc" where the diver's
// name should be. It shipped twice, in the group PDF's payment instructions and
// in the shop tagline.
//
// So drive the real renderer and record what font each draw actually used.
// jsPDF resolves through the `npm:jspdf@2.5.1` → `jspdf` alias in
// vitest.config.ts, and pdf.ts's two `Deno.readFile` calls (the font, the logo)
// go through the shim below.
//
// Vite rewrites `new URL("./pdf-cjk.ttf", import.meta.url)` to a served URL
// rather than a file: one, so resolve by basename under this directory instead
// of trusting the scheme.
;(globalThis as unknown as { Deno: unknown }).Deno = {
  readFile: (u: URL | string) => {
    const raw = typeof u === 'string' ? u : u.href
    if (raw.startsWith('file:')) return readFile(fileURLToPath(raw))
    const name = raw.split('?')[0].split('/').pop()!
    return readFile(join(dirname(fileURLToPath(import.meta.url)), name))
  },
  // Defining `Deno` at all makes `typeof Deno !== "undefined"` true, and the
  // edge config seam takes that as licence to read `Deno.env`. Answer it the
  // way an un-injected deployment does: nothing set, fall back to the file.
  env: { get: () => undefined },
}

// Each test renders a real PDF: base64-ing the ~6.8MB font and laying out a
// full A4 page runs ~1.5s, and the size comparison below renders twice. The 5s
// default is enough in isolation but not under a loaded full-suite run.
vi.setConfig({ testTimeout: 30_000 })

const CJK_FAMILY = 'NotoCJK'

interface Draw { font: string; text: string }

/** Where the currently-loaded renderer records its draws. Module-scope because
 *  the jsPDF mock factory below is hoisted and cannot close over a local. */
let recorder: Draw[] = []

// jsPDF assigns `text` and `setFont` as own properties of each instance rather
// than putting them on the prototype, so the only place to intercept is
// construction. Wrapping the constructor keeps the real renderer intact — every
// measurement, page break and font metric is jsPDF's own.
vi.mock('npm:jspdf@2.5.1', async () => {
  const actual = await vi.importActual<typeof import('jspdf')>('jspdf')
  function Recording(this: unknown, ...args: ConstructorParameters<typeof actual.jsPDF>) {
    const doc = new actual.jsPDF(...args)
    let current = 'helvetica'
    const origSetFont = doc.setFont.bind(doc)
    const origText = doc.text.bind(doc)
    doc.setFont = ((family: string, style?: string) => {
      current = family
      return origSetFont(family, style)
    }) as typeof doc.setFont
    doc.text = ((text: string | string[], ...rest: unknown[]) => {
      for (const s of Array.isArray(text) ? text : [text]) recorder.push({ font: current, text: String(s) })
      return (origText as (...a: unknown[]) => unknown)(text, ...rest)
    }) as typeof doc.text
    return doc
  }
  return { ...actual, jsPDF: Recording }
})

/**
 * Load pdf.ts with `catalog` as its message catalog, and return it alongside the
 * list its draws will be recorded into.
 *
 * The catalog has to be swapped per test rather than read from config: pdf.ts
 * resolves `t.pdf` once at module load, so the English and Chinese cases need
 * separate module instances.
 */
async function loadRenderer(catalog: typeof en) {
  vi.resetModules()
  vi.doMock('./i18n.ts', () => ({ t: catalog }))
  recorder = []
  const draws = recorder
  const mod = await import('./pdf.ts')
  return { ...mod, draws }
}

/** Every draw helvetica would have mangled. Empty is the only passing value. */
function mangled(draws: Draw[]): Draw[] {
  return draws.filter(d => needsCjkFont(d.text) && d.font !== CJK_FAMILY)
}

const SHOP: ShopContact = {
  phone: '02-1234-5678',
  address: '台北市中山區民生東路一段 1 號',
  mapsUrl: 'https://maps.example.com/shop',
}

const BANK: PaymentMethodDetails = {
  key: 'bank_transfer',
  label: '銀行轉帳',
  surcharge_percent: 0,
  bank_name: '玉山銀行',
  bank_branch: '民生分行',
  bank_code: '808',
  account_number: '0123456789',
  account_holder: '王小明',
  collects_invoice_email: false,
  shows_shop_contact: false,
}

// A shop whose own rows carry no CJK, so `payloadNeedsCjkFont` cannot be what
// registers the font. Without these the catalog-only cases below pass for the
// wrong reason — the Chinese bank details alone would trip the payload gate.
const LATIN_SHOP: ShopContact = {
  phone: '+44 20 7946 0000',
  address: '1 Harbour Road, Brighton',
  mapsUrl: 'https://maps.example.com/shop',
}

const LATIN_BANK: PaymentMethodDetails = {
  key: 'bank_transfer',
  label: 'Bank transfer',
  surcharge_percent: 0,
  bank_name: 'Barclays',
  bank_branch: 'Brighton',
  bank_code: '20-00-00',
  account_number: '0123456789',
  account_holder: 'Dive Shop Ltd',
  collects_invoice_email: false,
  shows_shop_contact: false,
}

/** Nothing in the payload needs the embedded face — only the catalog can. */
const ALL_LATIN: Partial<RegistrationPdfPayload> = { shop: LATIN_SHOP, paymentMethod: LATIN_BANK }

function registration(over: Partial<RegistrationPdfPayload> = {}): RegistrationPdfPayload {
  return {
    eventTitle: 'Green Island Boat Dive',
    startDate: '2026-09-12',
    endDate: null,
    name: 'Sam Diver',
    nickname: null,
    email: 'sam@example.com',
    dob: '1990-01-01',
    nationality: 'British',
    idNumber: 'A1234567',
    contactMethod: 'line',
    contactId: 'samdiver',
    certLevel: 'AOW',
    certOrg: 'PADI',
    diverNitrox: true,
    diverDeep: false,
    addNitroxCourse: false,
    loggedDives: 42,
    lastDiveDate: '2026-08-01',
    roomBoard: null,
    roomNotes: null,
    otherAddons: [],
    rentGear: true,
    gearIncluded: false,
    gearItems: ['BCD', 'Fins'],
    gearAssistanceNote: null,
    diveDays: 2,
    height: 175,
    weight: 70,
    shoeSize: 'EU 42',
    needsRide: true,
    transportIncluded: false,
    notes: null,
    shop: SHOP,
    paymentMethod: BANK,
    creditCardInvoiceEmail: null,
    deposit: 2000,
    total: 6000,
    creditApplied: null,
    charges: [{ label: 'Base', amount: 5000 }, { label: 'Gear', amount: 1000 }],
    payDepositOnly: true,
    fullPaymentDeadline: '2026-09-05',
    cancellationPolicyTitle: null,
    cancellationPolicyText: null,
    cancelDate: null,
    cancellationPolicyAckedAt: null,
    ...over,
  }
}

function group(over: Partial<GroupRegistrationPdfPayload> = {}): GroupRegistrationPdfPayload {
  return {
    generatedFor: 'Sam Diver',
    leadEmail: 'sam@example.com',
    shop: SHOP,
    paymentMethod: BANK,
    creditCardInvoiceEmail: null,
    groupTotal: 12000,
    groupDeposit: 4000,
    fullPaymentDeadline: '2026-09-05',
    divers: [
      {
        eventTitle: 'Green Island Boat Dive', dateStr: '2026-09-12', name: 'Sam Diver',
        nickname: null, dob: '1990-01-01', nationality: 'British', certLevel: 'AOW',
        certOrg: 'PADI', nitrox: true, gearLabel: 'Own', ride: 'Yes', room: null,
        addons: [], status: 'pending', deposit: 2000, total: 6000,
      },
      {
        eventTitle: 'Green Island Boat Dive', dateStr: '2026-09-12', name: 'Ada Lovelace',
        nickname: null, dob: '1991-02-02', nationality: 'British', certLevel: 'OW',
        certOrg: 'SSI', nitrox: false, gearLabel: 'A-la-carte', ride: 'No', room: null,
        addons: [], status: 'pending', deposit: 2000, total: 6000,
      },
    ],
    ...over,
  }
}

/** A diver whose every free-text field is Chinese. */
const CJK_OVERRIDES: Partial<RegistrationPdfPayload> = {
  eventTitle: '綠島船潛',
  name: '王小明',
  nickname: '小明',
  nationality: '台灣',
  certLevel: '進階開放水域',
  certOrg: '國際潛水教練協會',
  gearItems: ['防寒衣', '蛙鞋'],
  gearAssistanceNote: '不確定尺寸，需要協助',
  roomBoard: '雙人房',
  roomNotes: '想住靠海那側',
  otherAddons: ['水下攝影'],
  notes: '第一次夜潛，請多指教',
  cancellationPolicyTitle: '標準取消政策',
  cancellationPolicyText: '出發前七日取消退還全額；三日內取消不予退費。',
  cancelDate: '2026-09-05',
  cancellationPolicyAckedAt: '2026-08-20T10:00:00Z',
}

beforeEach(() => {
  vi.resetModules()
})

describe('the registration PDF never draws CJK under helvetica', () => {
  it('holds for a Chinese diver on an English deployment', async () => {
    const { buildPdfBase64, draws } = await loadRenderer(en)
    await buildPdfBase64(registration(CJK_OVERRIDES))

    expect(draws.some(d => d.font === CJK_FAMILY)).toBe(true)
    expect(mangled(draws)).toEqual([])
  })

  // The bug this file was written for. The labels come from the catalog and the
  // shop's config, neither of which travels in the payload — so a Chinese
  // deployment printing an all-Latin registration used to register no font at
  // all and mangle every label on the page.
  it('holds for a Latin diver on a Chinese deployment', async () => {
    const { buildPdfBase64, draws } = await loadRenderer(zhTW)
    await buildPdfBase64(registration(ALL_LATIN))

    expect(draws.some(d => d.text === '報名表')).toBe(true)
    expect(draws.some(d => d.font === CJK_FAMILY)).toBe(true)
    expect(mangled(draws)).toEqual([])
  })

  it('holds for a Chinese diver on a Chinese deployment', async () => {
    const { buildPdfBase64, draws } = await loadRenderer(zhTW)
    await buildPdfBase64(registration(CJK_OVERRIDES))
    expect(mangled(draws)).toEqual([])
  })

  // The shop's bank name and account holder are admin-authored rows, so they
  // are Chinese at a Taiwanese shop whatever the app's language is set to.
  it('holds for Chinese bank details under an English catalog', async () => {
    const { buildPdfBase64, draws } = await loadRenderer(en)
    await buildPdfBase64(registration())

    expect(draws.some(d => d.text.includes('玉山銀行'))).toBe(true)
    expect(mangled(draws)).toEqual([])
  })
})

describe('the group PDF never draws CJK under helvetica', () => {
  it('holds for Chinese divers on an English deployment', async () => {
    const { buildGroupPdfBase64, draws } = await loadRenderer(en)
    await buildGroupPdfBase64(group({
      generatedFor: '王小明',
      divers: group().divers.map((d, i) => ({
        ...d,
        eventTitle: '綠島船潛',
        name: i === 0 ? '王小明' : '陳美玲',
        certLevel: '進階開放水域',
      })),
    }))

    expect(draws.some(d => d.font === CJK_FAMILY)).toBe(true)
    expect(mangled(draws)).toEqual([])
  })

  it('holds for Latin divers on a Chinese deployment', async () => {
    const { buildGroupPdfBase64, draws } = await loadRenderer(zhTW)
    await buildGroupPdfBase64(group({ shop: LATIN_SHOP, paymentMethod: LATIN_BANK }))

    expect(draws.some(d => d.font === CJK_FAMILY)).toBe(true)
    expect(mangled(draws)).toEqual([])
  })

  // Four pages, so the per-chunk header band and the page-break path are both
  // exercised rather than only the first chunk's.
  it('holds across every page of a large Chinese group', async () => {
    const { buildGroupPdfBase64, draws } = await loadRenderer(zhTW)
    const one = group().divers[0]
    await buildGroupPdfBase64(group({
      generatedFor: '王小明',
      divers: Array.from({ length: 7 }, (_, i) => ({
        ...one, name: `潛水員 ${i + 1}`, eventTitle: '綠島船潛',
      })),
    }))
    expect(mangled(draws)).toEqual([])
  })
})

// The embedded face is ~260KB of font stream. An English deployment printing an
// all-Latin registration must not pay for it — that is the whole reason the
// gate is conditional rather than "always embed".
describe('the embedded face is not paid for when nothing needs it', () => {
  it('registers no CJK font for an all-Latin registration on an English deployment', async () => {
    const { buildPdfBase64, draws } = await loadRenderer(en)
    await buildPdfBase64(registration(ALL_LATIN))

    expect(draws.length).toBeGreaterThan(0)
    expect(draws.every(d => d.font === 'helvetica')).toBe(true)
  })

  it('keeps the all-Latin PDF materially smaller than the CJK one', async () => {
    const latin = await loadRenderer(en)
    const latinB64 = await latin.buildPdfBase64(registration(ALL_LATIN))
    const cjk = await loadRenderer(en)
    const cjkB64 = await cjk.buildPdfBase64(registration(CJK_OVERRIDES))

    expect(cjkB64.length).toBeGreaterThan(latinB64.length * 1.5)
  })
})
