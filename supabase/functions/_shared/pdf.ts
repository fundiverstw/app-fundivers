// Registration-form PDF builder. Ported near-verbatim from the Wix
// backend file wix-site/backend/sendRegistrationPdf.web.js — layout and
// colors deliberately match so divers get the same-looking PDF in email
// whether the booking came through Wix or the PWA.
//
// Uses jsPDF directly (Deno 2 edge runtime supports `npm:` specifiers).

import { jsPDF } from "npm:jspdf@2.5.1"
import { Buffer } from "node:buffer"
import { catalogNeedsCjkFont, needsCjkFont, payloadNeedsCjkFont } from "./pdf-fonts.ts"
import { paymentInstructionsFor, paymentConfirmationReminder } from "./payment-instructions.ts"
import type { ShopContact } from "../../../src/lib/payment-method-format.ts"
import { paymentMethodLabel, type PaymentMethodDetails } from "../../../src/lib/payment-method-format.ts"
import { siteConfig } from "../../../fundive.config.ts"
import { t } from "./i18n.ts"

// Shop currency label shown on money rows in the PDF.
const CUR = siteConfig.locale.currency
const d = t.pdf

// Bundled alongside this file in the edge function deploy. Forks replace this
// image with their own logo at the same path.
const LOGO_PATH = new URL("./fd_logo.png", import.meta.url)

// ─── CJK text support ────────────────────────────────────────────────────────
// jsPDF's built-in helvetica is a standard-14 font with WinAnsi (cp1252)
// encoding: it has no CJK glyphs and does NOT fail on them — it silently emits
// mangled bytes. Diver names, event titles and free-text notes are all
// user-supplied, so any of them can be Chinese or Japanese.
//
// We embed a TrueType font (jsPDF cannot embed CFF/OTF) with Latin + kana + the
// CJK ideograph blocks, and switch to it per string, only when that string
// actually needs it. Latin text keeps helvetica, so bold/italic weights and the
// existing layout are untouched.
//
// `pdf-cjk.ttf` is Noto Sans TC (Latin + kana + ~15k ideographs). A fork whose
// divers have Japanese names should replace it, at the same path, with Noto Sans
// JP — the two are not supersets of one another (TC lacks 桜, JP lacks ~4.5k TC
// ideographs). License: pdf-cjk.LICENSE.txt (SIL OFL 1.1).
const CJK_FONT_PATH = new URL("./pdf-cjk.ttf", import.meta.url)
const CJK_FAMILY = "NotoCJK"
const CJK_VFS_NAME = "pdf-cjk.ttf"

// Read + base64 the font once per isolate (~200ms, ~6.8MB), not once per PDF.
let cjkFontB64: Promise<string | null> | null = null
function loadCjkFontB64(): Promise<string | null> {
  cjkFontB64 ??= Deno.readFile(CJK_FONT_PATH)
    .then((bytes) => Buffer.from(bytes).toString("base64"))
    // A fork may delete the font to save bundle size; ASCII PDFs still render.
    .catch(() => null)
  return cjkFontB64
}

const docsWithCjk = new WeakSet<jsPDF>()

// The catalog labels and the shop's config prose are drawn on every PDF but
// never appear in the payload, so the gate has to ask about them separately.
// Resolved once: neither can change between documents.
const SHOP_TEXT_NEEDS_CJK =
  catalogNeedsCjkFont(d) ||
  needsCjkFont(siteConfig.identity.tagline ?? "") ||
  needsCjkFont(siteConfig.identity.shopName)

async function registerCjkFont(doc: jsPDF, payload: unknown): Promise<void> {
  if (!SHOP_TEXT_NEEDS_CJK && !payloadNeedsCjkFont(payload)) return
  const b64 = await loadCjkFontB64()
  if (!b64) return
  doc.addFileToVFS(CJK_VFS_NAME, b64)
  doc.addFont(CJK_VFS_NAME, CJK_FAMILY, "normal")
  docsWithCjk.add(doc)
}

/** Select the font for one string: the embedded CJK face when helvetica cannot
 *  encode it (weights collapse to regular — the face ships one weight), else
 *  helvetica in the requested style. */
function setFontFor(doc: jsPDF, text: string, style: "normal" | "bold" | "italic"): void {
  if (docsWithCjk.has(doc) && needsCjkFont(text)) doc.setFont(CJK_FAMILY, "normal")
  else doc.setFont("helvetica", style)
}

// Brand colors (matching the LaTeX registration form).
const C = {
  ocean:      [11, 83, 148],    // #0B5394
  oceanLight: [214, 233, 248],  // #D6E9F8
  oceanBg:    [238, 245, 251],  // #EEF5FB
  dark:       [26, 26, 26],     // #1A1A1A
  gray:       [110, 110, 110],
  white:      [255, 255, 255],
} as const

const ML = 10   // left margin
const MR = 200  // right edge (A4 is 210mm)
const COL = 68  // value-column start

export interface RegistrationPdfPayload {
  eventTitle: string
  startDate: string | null
  endDate: string | null
  /** Legal name, exactly as on the diver's passport / ID. */
  name: string
  email: string
  dob: string | null
  nationality: string | null
  idNumber: string | null
  contactMethod: string | null
  contactId: string | null
  certLevel: string | null
  certOrg: string | null
  diverNitrox: boolean
  diverDeep: boolean
  addNitroxCourse: boolean
  loggedDives: number | null
  lastDiveDate: string | null
  roomBoard: string | null
  roomNotes: string | null
  otherAddons: string[]
  rentGear: boolean
  /** True when the event itself bundles gear (e.g. OW course). Wins over
   *  rentGear in the PDF so the row reads "Included with course". */
  gearIncluded: boolean
  gearItems: string[]
  /** Free text the diver left when they picked "I need to ask a human" on the
   *  gear step. When set, it's shown as the gear value so staff see it. */
  gearAssistanceNote: string | null
  diveDays: number | null
  height: number | string | null
  weight: number | string | null
  shoeSize: string | null
  needsRide: boolean
  /** True when the linked prices tier had no transport surcharge — the PDF
   *  renders "Included with base price" instead of yes/no. */
  transportIncluded: boolean
  notes: string | null
  /** The shop's own phone / address / map, for a method that prints them.
   *  Carried on the payload rather than read here: they are a database row now
   *  (`shop_contact`), and the handler that builds this payload is the thing
   *  holding an admin client. */
  shop: ShopContact
  /** The shop's uploaded logo as a PNG data URL, when it has one. Null or
   *  absent prints the logo vendored beside pdf.ts. Same reasoning as `shop`:
   *  the handler holds the client, so it does the read. */
  logoDataUrl?: string | null
  /** The shop's payment_methods row for the key on the booking. Null when the
   *  key no longer resolves — the Method row and the "How to pay" block are
   *  then omitted rather than guessed at. */
  paymentMethod: PaymentMethodDetails | null
  /** Where to send the invoice. Only meaningful for a method that collects one
   *  (payment_methods.collects_invoice_email). Null falls back to "your
   *  registered email" copy in the instructions block. */
  creditCardInvoiceEmail: string | null
  deposit: number | string | null
  total: number | null
  /** Account credit applied at checkout (deducted deposit-first). When > 0 the
   *  Payment section shows the gross total, this credit as a negative line, and
   *  the resulting balance after credit. Null / 0 = no credit applied. */
  creditApplied: number | null
  /** Itemized charge lines (base + every additional charge with its amount)
   *  snapshotted on the booking. When present, the Payment section lists each
   *  line so the total is fully backtrackable. Null/empty for older bookings. */
  charges: Array<{ label: string; amount: number }> | null
  /** True when the diver chose deposit-only at registration. */
  payDepositOnly: boolean
  /** YYYY-MM-DD; deposit is always due ASAP, so only the balance carries a date. */
  fullPaymentDeadline: string | null
  /** Cancellation policy resolved from EO_*.cancel_policy → cancellation_policies. */
  cancellationPolicyTitle: string | null
  cancellationPolicyText:  string | null
  /** YYYY-MM-DD — the cancel-by date the policy text references. */
  cancelDate: string | null
  /** ISO timestamp of when the diver checked the "I have read the policy" box. */
  cancellationPolicyAckedAt: string | null
}

function formatGeneratedDate(): string {
  return new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
}

function ensureY(doc: jsPDF, y: number, reserveMm: number): number {
  const pageH = doc.internal.pageSize.getHeight()
  if (y + reserveMm > pageH - 12) { doc.addPage(); return 18 }
  return y
}

function section(doc: jsPDF, y: number, title: string): number {
  y = ensureY(doc, y, 22)
  doc.setFillColor(...C.ocean)
  doc.rect(0, y, 210, 8, "F")
  doc.setTextColor(...C.white)
  doc.setFontSize(8.5)
  setFontFor(doc, title, "bold")
  doc.text(title.toUpperCase(), ML + 2, y + 5.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.dark)
  return y + 11
}

function row(doc: jsPDF, y: number, label: string, value: unknown, altState: { alt: boolean }): number {
  if (value === undefined || value === null || value === "" || value === false) return y
  const v = String(value)
  const ROW_H = 7
  // Measure with the same font+size the value is drawn in, or the wrap width is
  // computed against the wrong metrics.
  doc.setFontSize(8.5)
  setFontFor(doc, v, "bold")
  const wrapped = doc.splitTextToSize(v, MR - COL)
  const blockH = ROW_H + (wrapped.length > 1 ? (wrapped.length - 1) * 4.5 : 0)
  y = ensureY(doc, y, blockH)
  const fill = altState.alt ? C.oceanBg : C.white
  doc.setFillColor(fill[0], fill[1], fill[2])
  doc.rect(0, y - 5, 210, blockH, "F")
  altState.alt = !altState.alt
  doc.setFontSize(8.5)
  setFontFor(doc, label, "normal")
  doc.setTextColor(...C.gray)
  doc.text(label, ML + 2, y)
  setFontFor(doc, v, "bold")
  doc.setTextColor(...C.dark)
  for (let i = 0; i < wrapped.length; i++) doc.text(wrapped[i], COL, y + i * 4.5)
  return y + blockH
}

/**
 * The logo to print: the shop's uploaded one when it has one, else the file
 * vendored beside this module.
 *
 * `uploaded` comes in on the payload rather than being read here, so the
 * builders stay free of a Supabase client and the vitest render tests can drive
 * both branches without one.
 */
async function loadLogoDataUrl(uploaded?: string | null): Promise<{ dataUrl: string; format: "PNG" } | null> {
  if (uploaded) return { dataUrl: uploaded, format: "PNG" }
  try {
    const bytes = await Deno.readFile(LOGO_PATH)
    return {
      dataUrl: "data:image/png;base64," + Buffer.from(bytes).toString("base64"),
      format:  "PNG",
    }
  } catch {
    return null
  }
}

export async function buildPdfBase64(p: RegistrationPdfPayload): Promise<string> {
  // compress: true Flate-compresses every stream. The shop logo is a large PNG
  // that jsPDF otherwise stores as a raw RGB bitmap + alpha SMask: a 3000x1514
  // logo alone made a 17MB attachment, close to the 25MB Gmail ceiling. Lossless.
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true })
  const altState = { alt: false }

  // ── Header ────────────────────────────────────────────
  await registerCjkFont(doc, p)
  const logo = await loadLogoDataUrl(p.logoDataUrl)
  let y = 8

  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray)
  setFontFor(doc, d.generated(formatGeneratedDate()), "normal")
  doc.text(d.generated(formatGeneratedDate()), MR, y, { align: "right" })
  y += 5

  if (logo) {
    try {
      // Compute render dims from the source's natural aspect ratio so we
      // don't squish wide logos into a narrow box.
      const props = doc.getImageProperties(logo.dataUrl)
      const maxW = 50, maxH = 24
      const ratio = props.width / props.height
      let logoW = maxW, logoH = maxW / ratio
      if (logoH > maxH) { logoH = maxH; logoW = maxH * ratio }
      doc.addImage(logo.dataUrl, logo.format, (210 - logoW) / 2, y, logoW, logoH)
      y += logoH + 3
    } catch { y += 4 }
  }

  // Shop's own marketing line (identity.tagline). Blank = no line, no gap.
  if (siteConfig.identity.tagline) {
    doc.setFontSize(8.5)
    setFontFor(doc, siteConfig.identity.tagline, "italic")
    doc.setTextColor(...C.ocean)
    doc.text(siteConfig.identity.tagline, 105, y, { align: "center" })
    y += 6
  }

  doc.setFontSize(16)
  doc.setTextColor(...C.ocean)
  setFontFor(doc, d.registrationForm, "bold")
  doc.text(d.registrationForm, 105, y, { align: "center" })
  y += 4

  doc.setDrawColor(...C.ocean)
  doc.setLineWidth(0.5)
  doc.line(ML, y, MR, y)
  y += 6

  // ── Event ─────────────────────────────────────────────
  altState.alt = false
  y = section(doc, y, d.event)
  y = row(doc, y, d.event, p.eventTitle, altState)
  const dateStr = p.startDate
    ? (p.endDate && p.endDate !== p.startDate ? d.dateRange(p.startDate, p.endDate) : p.startDate)
    : ""
  y = row(doc, y, d.date, dateStr, altState)
  y += 4

  // ── Personal details ──────────────────────────────────
  altState.alt = false
  y = section(doc, y, d.personalDetails)
  y = row(doc, y, d.name, p.name, altState)
  y = row(doc, y, d.email, p.email, altState)
  y = row(doc, y, d.dob, p.dob, altState)
  y = row(doc, y, d.nationality, p.nationality, altState)
  y = row(doc, y, d.passportId, p.idNumber, altState)
  const contactStr = p.contactMethod ? (p.contactMethod + (p.contactId ? " - " + p.contactId : "")) : ""
  y = row(doc, y, d.contact, contactStr, altState)
  y += 4

  // ── Certification ─────────────────────────────────────
  if (p.certLevel || p.certOrg || p.loggedDives || p.lastDiveDate) {
    altState.alt = false
    y = section(doc, y, d.certification)
    y = row(doc, y, d.level, p.certLevel, altState)
    y = row(doc, y, d.organization, p.certOrg, altState)
    y = row(doc, y, d.nitroxCertified, p.diverNitrox ? d.yes : "", altState)
    y = row(doc, y, d.deepCertified, p.diverDeep ? d.yes : "", altState)
    y = row(doc, y, d.nitroxCourseAddon, p.addNitroxCourse ? d.yes : "", altState)
    y = row(doc, y, d.loggedDives, p.loggedDives, altState)
    y = row(doc, y, d.lastDive, p.lastDiveDate, altState)
    y += 4
  }

  // ── Accommodation & extras ────────────────────────────
  altState.alt = false
  y = section(doc, y, d.accommodationExtras)
  y = row(doc, y, d.roomUpgrade, p.roomBoard, altState)
  y = row(doc, y, d.roomRequests, p.roomNotes, altState)
  if (p.otherAddons && p.otherAddons.length) {
    y = row(doc, y, d.otherAddons, p.otherAddons.join(", "), altState)
  }
  const gearDays = p.diveDays && p.diveDays > 1 ? p.diveDays : 1
  const gearLabel = p.gearIncluded
    ? d.includedWithCourse
    : p.gearAssistanceNote
      ? d.needsHelp
      : p.rentGear
        ? (d.alaCarte + (gearDays > 1 ? d.alaCarteDays(gearDays) : ""))
        : d.no
  y = row(doc, y, d.gearRental, gearLabel, altState)
  if (p.gearAssistanceNote) {
    y = row(doc, y, d.gearNote, p.gearAssistanceNote, altState)
  }
  if (p.rentGear && p.gearItems && p.gearItems.length) {
    y = row(doc, y, d.items, p.gearItems.join(", "), altState)
  }
  if (p.rentGear && (p.height || p.weight || p.shoeSize)) {
    y = row(doc, y, d.sizing, d.sizingValue(String(p.height || ""), String(p.weight || ""), String(p.shoeSize || "")), altState)
  }
  y = row(doc, y, d.transportation,
    p.needsRide ? d.ridingWithShop : d.drivingThemselves,
    altState)
  if (p.notes) y = row(doc, y, d.note, p.notes, altState)
  y += 4

  // ── Payment ───────────────────────────────────────────
  altState.alt = false
  y = section(doc, y, d.payment)
  // The method's name and its surcharge both come off the shop's own row, so a
  // shop that charges 3% is never shown "+5%".
  const methodLabel = p.paymentMethod ? paymentMethodLabel(p.paymentMethod) : ""
  y = row(doc, y, d.method, methodLabel, altState)
  // Itemized charge breakdown — each line sums into the highlighted Total
  // below, so staff and divers can trace exactly what was charged.
  if (p.charges && p.charges.length) {
    for (const c of p.charges) y = row(doc, y, c.label, c.amount, altState)
  }
  y = row(doc, y, `Deposit due (${CUR})`, p.deposit, altState)
  y += 2

  // Total — highlighted row
  y = ensureY(doc, y, 14)
  doc.setFillColor(...C.oceanLight)
  doc.rect(0, y - 5, 210, 10, "F")
  doc.setFontSize(9)
  doc.setTextColor(...C.ocean)
  setFontFor(doc, d.total(CUR), "bold")
  doc.text(d.total(CUR), ML + 2, y + 1)
  doc.setFontSize(13)
  doc.text(p.total != null ? String(p.total) : "-", COL, y + 1)
  y += 8

  // Account credit — when the diver paid part of the booking with credit, show
  // it as a negative line and the resulting balance so the gross total above
  // and the after-credit balance are both on the PDF.
  if (typeof p.creditApplied === "number" && p.creditApplied > 0 && typeof p.total === "number") {
    y += 2
    y = row(doc, y, d.creditApplied(CUR), -p.creditApplied, altState)
    y += 2
    const afterCredit = Math.max(0, p.total - p.creditApplied)
    y = ensureY(doc, y, 14)
    doc.setFillColor(...C.oceanLight)
    doc.rect(0, y - 5, 210, 10, "F")
    doc.setFontSize(9)
    doc.setTextColor(...C.ocean)
    setFontFor(doc, d.balanceAfterCredit(CUR), "bold")
    doc.text(d.balanceAfterCredit(CUR), ML + 2, y + 1)
    doc.setFontSize(13)
    doc.text(String(afterCredit), COL, y + 1)
    y += 8
  }

  // How to pay — per-method instructions (shop address + map for cash,
  // bank details for transfer, paypal.me link for PayPal, invoice email
  // for credit card).
  const instr = paymentInstructionsFor(p.paymentMethod, {
    invoiceEmail: p.creditCardInvoiceEmail ?? p.email,
    shop: p.shop,
  })
  if (instr) {
    y += 6
    y = section(doc, y, instr.title)
    doc.setFontSize(8.5)
    doc.setTextColor(...C.dark)
    for (const line of instr.lines) {
      setFontFor(doc, line, "normal")
      const wrapped = doc.splitTextToSize(line, MR - ML - 2)
      for (const w of wrapped) {
        y = ensureY(doc, y, 6)
        doc.text(w, ML + 2, y)
        y += 4.5
      }
    }
  }

  // "After you pay" reminder — tells the diver to ping the shop and watch
  // the app for status updates. Same copy as the registration form so the
  // PDF doesn't drift.
  const reminder = paymentConfirmationReminder()
  y += 6
  y = section(doc, y, reminder.title)
  doc.setFontSize(8.5)
  doc.setTextColor(...C.dark)
  for (const line of reminder.lines) {
    setFontFor(doc, line, "normal")
    const wrapped = doc.splitTextToSize(line, MR - ML - 2)
    for (const w of wrapped) {
      y = ensureY(doc, y, 6)
      doc.text(w, ML + 2, y)
      y += 4.5
    }
  }

  // Deposit is always due ASAP; the configurable deadline only governs the
  // remaining balance. When the diver opted to pay the deposit only we also
  // break out the two amount/date pairs so they know exactly what to send.
  y += 4
  y = ensureY(doc, y, 16)
  doc.setFontSize(8.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.dark)
  const summary = p.fullPaymentDeadline
    ? d.payDepositSummary(formatDeadlineLong(p.fullPaymentDeadline))
    : d.payDepositSummaryNoDeadline
  setFontFor(doc, summary, "normal")
  const wrapped = doc.splitTextToSize(summary, MR - ML - 2)
  for (const line of wrapped) { doc.text(line, ML + 2, y); y += 4.5 }

  if (p.payDepositOnly && typeof p.deposit === "number" && typeof p.total === "number") {
    y += 2
    // Credit pays the deposit down first, then trims the leftover balance, so
    // the "pay now / pay later" figures here match the after-credit balance
    // shown above rather than the gross deposit and total.
    const credit = typeof p.creditApplied === "number" ? p.creditApplied : 0
    const depositNow = Math.max(0, p.deposit - credit)
    const remaining = Math.max(0, (p.total - credit) - depositNow)
    setFontFor(doc, d.payDepositNow(depositNow, CUR), "bold")
    doc.text(d.payDepositNow(depositNow, CUR), ML + 2, y)
    y += 4.5
    const balanceLine = p.fullPaymentDeadline
      ? d.payBalanceBy(formatDeadlineLong(p.fullPaymentDeadline), remaining, CUR)
      : d.payBalance(remaining, CUR)
    setFontFor(doc, balanceLine, "bold")
    doc.text(balanceLine, ML + 2, y)
    y += 4.5
    doc.setFont("helvetica", "normal")
  }

  // Cancellation policy — full text plus the cancel-by date and the diver's
  // acknowledgment timestamp from the registration form.
  if (p.cancellationPolicyText) {
    y += 6
    const heading = p.cancellationPolicyTitle
      ? d.cancellationPolicyNamed(p.cancellationPolicyTitle)
      : d.cancellationPolicy
    y = section(doc, y, heading)
    doc.setFontSize(8.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...C.dark)
    if (p.cancelDate) {
      setFontFor(doc, d.cancelByDate(formatDeadlineLong(p.cancelDate)), "bold")
      doc.text(d.cancelByDate(formatDeadlineLong(p.cancelDate)), ML + 2, y)
      doc.setFont("helvetica", "normal")
      y += 5
    }
    setFontFor(doc, p.cancellationPolicyText, "normal")
    const wrappedPol = doc.splitTextToSize(p.cancellationPolicyText, MR - ML - 2)
    for (const line of wrappedPol) {
      y = ensureY(doc, y, 6)
      doc.text(line, ML + 2, y)
      y += 4.5
    }
    if (p.cancellationPolicyAckedAt) {
      y += 2
      y = ensureY(doc, y, 6)
      doc.setTextColor(...C.gray)
      const acked = d.acknowledgedByDiver(new Date(p.cancellationPolicyAckedAt).toUTCString())
      setFontFor(doc, acked, "normal")
      doc.text(acked, ML + 2, y)
      doc.setTextColor(...C.dark)
    }
  }

  const dataUri = doc.output("datauristring")
  return dataUri.split(",")[1]
}

// ── Consolidated group registration PDF ──────────────────────────────
// One PDF for a whole group submitted together (a parent paying for the
// family, or one diver across several events). Each booking is a column;
// a left column carries the field labels; two divers fit per page, and
// 3+ paginate two-at-a-time. A group-total band sums what the lead owes.

export interface GroupDiverColumn {
  name: string
  eventTitle: string
  dateStr: string | null
  dob: string | null
  nationality: string | null
  certLevel: string | null
  certOrg: string | null
  nitrox: boolean
  /** Pre-formatted gear label (e.g. "Own", "A-la-carte x2 days", "Included"). */
  gearLabel: string
  /** Pre-formatted transportation label. */
  ride: string
  room: string | null
  addons: string[]
  /** Booking status — pending / waitlisted / confirmed. */
  status: string
  deposit: number | null
  total: number | null
}

export interface GroupRegistrationPdfPayload {
  /** Lead booker the summary is addressed to. */
  generatedFor: string
  leadEmail: string
  /** The shop's own phone / address / map — see `RegistrationPdfPayload.shop`. */
  shop: ShopContact
  /** The shop's uploaded logo — see `RegistrationPdfPayload.logoDataUrl`. */
  logoDataUrl?: string | null
  /** The shop's payment_methods row the group settles through. */
  paymentMethod: PaymentMethodDetails | null
  creditCardInvoiceEmail: string | null
  /** Sum of every booking's total — what the lead owes for the group. */
  groupTotal: number
  /** Sum of every booking's deposit, when all carry one. */
  groupDeposit: number | null
  fullPaymentDeadline: string | null
  divers: GroupDiverColumn[]
}

const GROUP_FIELDS: Array<{ label: string; get: (d: GroupDiverColumn) => string }> = [
  { label: d.event,        get: c => c.eventTitle },
  { label: d.date,         get: c => c.dateStr ?? "" },
  { label: d.name,         get: c => c.name },
  { label: d.dob,          get: c => c.dob ?? "" },
  { label: d.nationality,  get: c => c.nationality ?? "" },
  { label: d.certLevel,    get: c => c.certLevel ?? "" },
  { label: d.certOrg,      get: c => c.certOrg ?? "" },
  { label: d.nitrox,       get: c => c.nitrox ? d.yes : "" },
  { label: d.gear,         get: c => c.gearLabel },
  { label: d.transport,    get: c => c.ride },
  { label: d.room,         get: c => c.room ?? "" },
  { label: d.addons,       get: c => c.addons.join(", ") },
  { label: d.status,       get: c => c.status },
  { label: d.deposit(CUR), get: c => c.deposit != null ? String(c.deposit) : "" },
  { label: d.total(CUR),   get: c => c.total != null ? String(c.total) : "" },
]

const GROUP_LABEL_X = ML + 2

// Column x-anchors + wrap widths for the 1- or 2-diver case on a page.
function groupColumns(n: number): Array<{ x: number; w: number }> {
  if (n <= 1) return [{ x: 60, w: MR - 60 }]
  return [{ x: 55, w: 66 }, { x: 128, w: MR - 128 }]
}

function groupRow(
  doc: jsPDF, y: number, label: string, values: string[],
  cols: Array<{ x: number; w: number }>, altState: { alt: boolean },
): number {
  doc.setFontSize(8)
  const wraps = values.map((v, i) => {
    setFontFor(doc, v || "—", "normal")
    return doc.splitTextToSize(v || "—", cols[i].w)
  })
  const maxLines = Math.max(1, ...wraps.map(w => w.length))
  const blockH = 6 + (maxLines - 1) * 4
  const fill = altState.alt ? C.oceanBg : C.white
  doc.setFillColor(fill[0], fill[1], fill[2])
  doc.rect(0, y - 4.5, 210, blockH, "F")
  altState.alt = !altState.alt
  doc.setFontSize(8)
  setFontFor(doc, label, "normal")
  doc.setTextColor(...C.gray)
  doc.text(label, GROUP_LABEL_X, y)
  doc.setTextColor(...C.dark)
  wraps.forEach((w, i) => {
    setFontFor(doc, values[i] || "—", "bold")
    for (let l = 0; l < w.length; l++) doc.text(w[l], cols[i].x, y + l * 4)
  })
  return y + blockH
}

export async function buildGroupPdfBase64(p: GroupRegistrationPdfPayload): Promise<string> {
  // compress: true Flate-compresses every stream. The shop logo is a large PNG
  // that jsPDF otherwise stores as a raw RGB bitmap + alpha SMask: a 3000x1514
  // logo alone made a 17MB attachment, close to the 25MB Gmail ceiling. Lossless.
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true })

  await registerCjkFont(doc, p)
  const logo = await loadLogoDataUrl(p.logoDataUrl)
  let y = 8
  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray)
  setFontFor(doc, d.generated(formatGeneratedDate()), "normal")
  doc.text(d.generated(formatGeneratedDate()), MR, y, { align: "right" })
  y += 5
  if (logo) {
    try {
      const props = doc.getImageProperties(logo.dataUrl)
      const maxW = 50, maxH = 24
      const ratio = props.width / props.height
      let logoW = maxW, logoH = maxW / ratio
      if (logoH > maxH) { logoH = maxH; logoW = maxH * ratio }
      doc.addImage(logo.dataUrl, logo.format, (210 - logoW) / 2, y, logoW, logoH)
      y += logoH + 3
    } catch { y += 4 }
  }
  doc.setFontSize(16)
  doc.setTextColor(...C.ocean)
  setFontFor(doc, d.groupRegistration, "bold")
  doc.text(d.groupRegistration, 105, y, { align: "center" })
  y += 4
  doc.setFontSize(8.5)
  const paidBy = d.paidByGroup(p.generatedFor, p.divers.length)
  setFontFor(doc, paidBy, "normal")
  doc.setTextColor(...C.gray)
  doc.text(paidBy, 105, y + 4, { align: "center" })
  y += 8
  doc.setDrawColor(...C.ocean)
  doc.setLineWidth(0.5)
  doc.line(ML, y, MR, y)
  y += 6

  // Two divers per page. Each chunk renders its own header band + the
  // full field list, so a column never splits across a page.
  for (let i = 0; i < p.divers.length; i += 2) {
    const chunk = p.divers.slice(i, i + 2)
    const cols = groupColumns(chunk.length)
    if (i > 0) { doc.addPage(); y = 18 }

    doc.setFillColor(...C.ocean)
    doc.rect(0, y, 210, 8, "F")
    doc.setTextColor(...C.white)
    doc.setFontSize(8.5)
    chunk.forEach((_col, c) => {
      const heading = d.diverN(i + c + 1)
      setFontFor(doc, heading, "bold")
      doc.text(heading, cols[c].x, y + 5.5)
    })
    const range = d.diversRange(i + 1, i + chunk.length)
    setFontFor(doc, range, "bold")
    doc.text(range, GROUP_LABEL_X, y + 5.5)
    doc.setTextColor(...C.dark)
    y += 11

    const altState = { alt: false }
    for (const f of GROUP_FIELDS) {
      y = groupRow(doc, y, f.label, chunk.map(f.get), cols, altState)
    }
    y += 4
  }

  // Group total band.
  y = ensureY(doc, y, 14)
  doc.setFillColor(...C.oceanLight)
  doc.rect(0, y - 5, 210, 10, "F")
  doc.setFontSize(9)
  const groupTotalLabel = d.groupTotal(p.divers.length, CUR)
  setFontFor(doc, groupTotalLabel, "bold")
  doc.setTextColor(...C.ocean)
  doc.text(groupTotalLabel, GROUP_LABEL_X, y + 1)
  doc.setFontSize(13)
  doc.setFont("helvetica", "bold")
  doc.text(String(p.groupTotal), 130, y + 1)
  y += 10

  // How to pay — the group shares one payment method (the lead settles once).
  const instr = paymentInstructionsFor(p.paymentMethod, {
    invoiceEmail: p.creditCardInvoiceEmail ?? p.leadEmail,
    shop: p.shop,
  })
  if (instr) {
    y += 4
    y = section(doc, y, instr.title)
    doc.setFontSize(8.5)
    doc.setTextColor(...C.dark)
    for (const line of instr.lines) {
      setFontFor(doc, line, "normal")
      for (const w of doc.splitTextToSize(line, MR - ML - 2)) {
        y = ensureY(doc, y, 6)
        doc.text(w, ML + 2, y)
        y += 4.5
      }
    }
  }

  const reminder = paymentConfirmationReminder()
  y += 6
  y = section(doc, y, reminder.title)
  doc.setFontSize(8.5)
  doc.setTextColor(...C.dark)
  for (const line of reminder.lines) {
    setFontFor(doc, line, "normal")
    for (const w of doc.splitTextToSize(line, MR - ML - 2)) {
      y = ensureY(doc, y, 6)
      doc.text(w, ML + 2, y)
      y += 4.5
    }
  }

  y += 4
  y = ensureY(doc, y, 8)
  const summary = p.fullPaymentDeadline
    ? d.payGroupSummary(formatDeadlineLong(p.fullPaymentDeadline))
    : d.payGroupSummaryNoDeadline
  setFontFor(doc, summary, "normal")
  for (const line of doc.splitTextToSize(summary, MR - ML - 2)) { doc.text(line, ML + 2, y); y += 4.5 }

  const dataUri = doc.output("datauristring")
  return dataUri.split(",")[1]
}

// Render a YYYY-MM-DD string as 'EEE, MMM d' (e.g. 'Sat, May 1') without
// pulling in date-fns on the edge runtime. Falls back to the raw string
// when input is null/empty.
function formatDeadlineLong(yyyyMmDd: string | null): string {
  if (!yyyyMmDd) return "TBD"
  const d = new Date(yyyyMmDd + "T00:00:00Z")
  if (Number.isNaN(d.getTime())) return yyyyMmDd
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]
  return `${wd}, ${mo} ${d.getUTCDate()}`
}
