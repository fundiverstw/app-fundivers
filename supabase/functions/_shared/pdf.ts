// Registration-form PDF builder. Ported near-verbatim from the Wix
// backend file wix-site/backend/sendRegistrationPdf.web.js — layout and
// colours deliberately match so divers get the same-looking PDF in email
// whether the booking came through Wix or the PWA.
//
// Uses jsPDF directly (Deno 2 edge runtime supports `npm:` specifiers).

import { jsPDF } from "npm:jspdf@2.5.1"
import { Buffer } from "node:buffer"
import { paymentInstructionsFor, paymentConfirmationReminder } from "./payment-instructions.ts"
import { siteConfig } from "../../../fundive.config.ts"

// Shop currency label shown on money rows in the PDF.
const CUR = siteConfig.locale.currencyLabel

// Bundled alongside this file in the edge function deploy. Forks replace this
// image with their own logo at the same path.
const LOGO_PATH = new URL("./fd_logo.png", import.meta.url)

// Brand colours (matching the LaTeX registration form).
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
  /** Informal nickname (optional). Rendered as its own row when present. */
  nickname: string | null
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
  gearMode: 'a-la-carte' | ''
  gearItems: string[]
  /** Free text the diver left when they picked "I need to ask a human" on the
   *  gear step. When set, it's shown as the gear value so staff see it. */
  gearAssistanceNote: string | null
  diveDays: number | null
  height: number | string | null
  weight: number | string | null
  shoeSize: string | null
  needsRide: boolean
  /** True when the linked EO_prices tier had no transport surcharge — the PDF
   *  renders "Included with base price" instead of yes/no. */
  transportIncluded: boolean
  notes: string | null
  paymentMethod: 'bank_transfer' | 'credit_card' | 'paypal' | 'cash' | string
  /** Where to send the credit-card invoice. Only meaningful when
   *  paymentMethod === 'credit_card'. Null falls back to "your registered
   *  email" copy in the instructions block. */
  creditCardInvoiceEmail: string | null
  deposit: number | string | null
  total: number | null
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
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.5)
  doc.text(title.toUpperCase(), ML + 2, y + 5.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.dark)
  return y + 11
}

function row(doc: jsPDF, y: number, label: string, value: unknown, altState: { alt: boolean }): number {
  if (value === undefined || value === null || value === "" || value === false) return y
  const v = String(value)
  const ROW_H = 7
  const wrapped = doc.splitTextToSize(v, MR - COL)
  const blockH = ROW_H + (wrapped.length > 1 ? (wrapped.length - 1) * 4.5 : 0)
  y = ensureY(doc, y, blockH)
  doc.setFillColor(...(altState.alt ? C.oceanBg : C.white))
  doc.rect(0, y - 5, 210, blockH, "F")
  altState.alt = !altState.alt
  doc.setFontSize(8.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.gray)
  doc.text(label, ML + 2, y)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...C.dark)
  for (let i = 0; i < wrapped.length; i++) doc.text(wrapped[i], COL, y + i * 4.5)
  return y + blockH
}

async function loadLogoDataUrl(): Promise<{ dataUrl: string; format: "PNG" } | null> {
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
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const altState = { alt: false }

  // ── Header ────────────────────────────────────────────
  const logo = await loadLogoDataUrl()
  let y = 8

  doc.setFontSize(7.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.gray)
  doc.text("Generated: " + formatGeneratedDate(), MR, y, { align: "right" })
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

  doc.setFontSize(8.5)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(...C.ocean)
  doc.text("Breathe the Adventure! Explore with Confidence!", 105, y, { align: "center" })
  y += 6

  doc.setFontSize(16)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...C.ocean)
  doc.text("Registration Form", 105, y, { align: "center" })
  y += 4

  doc.setDrawColor(...C.ocean)
  doc.setLineWidth(0.5)
  doc.line(ML, y, MR, y)
  y += 6

  // ── Event ─────────────────────────────────────────────
  altState.alt = false
  y = section(doc, y, "Event")
  y = row(doc, y, "Event", p.eventTitle, altState)
  const dateStr = p.startDate
    ? (p.startDate + (p.endDate && p.endDate !== p.startDate ? " to " + p.endDate : ""))
    : ""
  y = row(doc, y, "Date", dateStr, altState)
  y += 4

  // ── Personal details ──────────────────────────────────
  altState.alt = false
  y = section(doc, y, "Personal details")
  y = row(doc, y, "Name", p.name, altState)
  y = row(doc, y, "Nickname", p.nickname, altState)
  y = row(doc, y, "Email", p.email, altState)
  y = row(doc, y, "Date of birth", p.dob, altState)
  y = row(doc, y, "Nationality", p.nationality, altState)
  y = row(doc, y, "Passport / ARC", p.idNumber, altState)
  const contactStr = p.contactMethod ? (p.contactMethod + (p.contactId ? " - " + p.contactId : "")) : ""
  y = row(doc, y, "Contact", contactStr, altState)
  y += 4

  // ── Certification ─────────────────────────────────────
  if (p.certLevel || p.certOrg || p.loggedDives || p.lastDiveDate) {
    altState.alt = false
    y = section(doc, y, "Certification")
    y = row(doc, y, "Level", p.certLevel, altState)
    y = row(doc, y, "Organization", p.certOrg, altState)
    y = row(doc, y, "Nitrox certified", p.diverNitrox ? "Yes" : "", altState)
    y = row(doc, y, "Deep certified (40m)", p.diverDeep ? "Yes" : "", altState)
    y = row(doc, y, "Nitrox course add-on", p.addNitroxCourse ? "Yes" : "", altState)
    y = row(doc, y, "Logged dives", p.loggedDives, altState)
    y = row(doc, y, "Last dive", p.lastDiveDate, altState)
    y += 4
  }

  // ── Accommodation & extras ────────────────────────────
  altState.alt = false
  y = section(doc, y, "Accommodation & extras")
  y = row(doc, y, "Room upgrade", p.roomBoard, altState)
  y = row(doc, y, "Room requests", p.roomNotes, altState)
  if (p.otherAddons && p.otherAddons.length) {
    y = row(doc, y, "Other add-ons", p.otherAddons.join(", "), altState)
  }
  const gearDays = p.diveDays && p.diveDays > 1 ? p.diveDays : 1
  const gearLabel = p.gearIncluded
    ? "Included with course"
    : p.gearAssistanceNote
      ? "NEEDS HELP — see note below"
      : p.rentGear
        ? ("A-la-carte" + (gearDays > 1 ? " x" + gearDays + " days" : ""))
        : "No"
  y = row(doc, y, "Gear rental", gearLabel, altState)
  if (p.gearAssistanceNote) {
    y = row(doc, y, "Gear note", p.gearAssistanceNote, altState)
  }
  if (p.rentGear && p.gearItems && p.gearItems.length) {
    y = row(doc, y, "Items", p.gearItems.join(", "), altState)
  }
  if (p.rentGear && (p.height || p.weight || p.shoeSize)) {
    y = row(doc, y, "Sizing", "H: " + (p.height || "") + "  W: " + (p.weight || "") + "  Shoe: " + (p.shoeSize || ""), altState)
  }
  y = row(doc, y, "Transportation",
    p.needsRide ? "Riding with the shop" : "Driving themselves",
    altState)
  if (p.notes) y = row(doc, y, "Note", p.notes, altState)
  y += 4

  // ── Payment ───────────────────────────────────────────
  altState.alt = false
  y = section(doc, y, "Payment")
  const methodLabel =
    p.paymentMethod === "bank_transfer" ? "Bank transfer"
    : p.paymentMethod === "paypal"      ? "PayPal (+5%)"
    : p.paymentMethod === "credit_card" ? "Credit card (+5%)"
    : p.paymentMethod === "cash"        ? "Cash"
    : (p.paymentMethod || "")
  y = row(doc, y, "Method", methodLabel, altState)
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
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...C.ocean)
  doc.text(`Total (${CUR})`, ML + 2, y + 1)
  doc.setFontSize(13)
  doc.text(p.total != null ? String(p.total) : "-", COL, y + 1)
  y += 8

  // How to pay — per-method instructions (shop address + map for cash,
  // bank details for transfer, paypal.me link for PayPal, invoice email
  // for credit card).
  const instr = paymentInstructionsFor(p.paymentMethod, {
    invoiceEmail: p.creditCardInvoiceEmail ?? p.email,
  })
  if (instr) {
    y += 6
    y = section(doc, y, instr.title)
    doc.setFontSize(8.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...C.dark)
    for (const line of instr.lines) {
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
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.dark)
  for (const line of reminder.lines) {
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
    ? `Pay deposit ASAP to hold your spot. Pay the remaining balance by ${formatDeadlineLong(p.fullPaymentDeadline)} to complete your registration.`
    : `Pay deposit ASAP to hold your spot. Pay the remaining balance to complete your registration.`
  const wrapped = doc.splitTextToSize(summary, MR - ML - 2)
  for (const line of wrapped) { doc.text(line, ML + 2, y); y += 4.5 }

  if (p.payDepositOnly && typeof p.deposit === "number" && typeof p.total === "number") {
    y += 2
    const remaining = Math.max(0, p.total - p.deposit)
    doc.setFont("helvetica", "bold")
    doc.text(`Pay deposit ASAP: ${p.deposit} ${CUR}`, ML + 2, y)
    y += 4.5
    const balanceLine = p.fullPaymentDeadline
      ? `Pay remaining balance by ${formatDeadlineLong(p.fullPaymentDeadline)}: ${remaining} ${CUR}`
      : `Pay remaining balance: ${remaining} ${CUR}`
    doc.text(balanceLine, ML + 2, y)
    y += 4.5
    doc.setFont("helvetica", "normal")
  }

  // Cancellation policy — full text plus the cancel-by date and the diver's
  // acknowledgement timestamp from the registration form.
  if (p.cancellationPolicyText) {
    y += 6
    const heading = p.cancellationPolicyTitle
      ? `Cancellation policy — ${p.cancellationPolicyTitle}`
      : "Cancellation policy"
    y = section(doc, y, heading)
    doc.setFontSize(8.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...C.dark)
    if (p.cancelDate) {
      doc.setFont("helvetica", "bold")
      doc.text(`Cancel-by date: ${formatDeadlineLong(p.cancelDate)}`, ML + 2, y)
      doc.setFont("helvetica", "normal")
      y += 5
    }
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
      doc.text(
        `Acknowledged by diver: ${new Date(p.cancellationPolicyAckedAt).toUTCString()}`,
        ML + 2, y,
      )
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
  nickname: string | null
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
  /** Raw payment method (bank_transfer | credit_card | paypal | cash). */
  paymentMethod: string
  creditCardInvoiceEmail: string | null
  /** Sum of every booking's total — what the lead owes for the group. */
  groupTotal: number
  /** Sum of every booking's deposit, when all carry one. */
  groupDeposit: number | null
  fullPaymentDeadline: string | null
  divers: GroupDiverColumn[]
}

const GROUP_FIELDS: Array<{ label: string; get: (d: GroupDiverColumn) => string }> = [
  { label: "Event",         get: d => d.eventTitle },
  { label: "Date",          get: d => d.dateStr ?? "" },
  { label: "Name",          get: d => d.name },
  { label: "Nickname",      get: d => d.nickname ?? "" },
  { label: "Date of birth", get: d => d.dob ?? "" },
  { label: "Nationality",   get: d => d.nationality ?? "" },
  { label: "Cert level",    get: d => d.certLevel ?? "" },
  { label: "Cert org",      get: d => d.certOrg ?? "" },
  { label: "Nitrox",        get: d => d.nitrox ? "Yes" : "" },
  { label: "Gear",          get: d => d.gearLabel },
  { label: "Transport",     get: d => d.ride },
  { label: "Room",          get: d => d.room ?? "" },
  { label: "Add-ons",       get: d => d.addons.join(", ") },
  { label: "Status",        get: d => d.status },
  { label: `Deposit (${CUR})`, get: d => d.deposit != null ? String(d.deposit) : "" },
  { label: `Total (${CUR})`,   get: d => d.total != null ? String(d.total) : "" },
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
  const wraps = values.map((v, i) => doc.splitTextToSize(v || "—", cols[i].w))
  const maxLines = Math.max(1, ...wraps.map(w => w.length))
  const blockH = 6 + (maxLines - 1) * 4
  doc.setFillColor(...(altState.alt ? C.oceanBg : C.white))
  doc.rect(0, y - 4.5, 210, blockH, "F")
  altState.alt = !altState.alt
  doc.setFontSize(8)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.gray)
  doc.text(label, GROUP_LABEL_X, y)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...C.dark)
  wraps.forEach((w, i) => { for (let l = 0; l < w.length; l++) doc.text(w[l], cols[i].x, y + l * 4) })
  return y + blockH
}

export async function buildGroupPdfBase64(p: GroupRegistrationPdfPayload): Promise<string> {
  const doc = new jsPDF({ unit: "mm", format: "a4" })

  const logo = await loadLogoDataUrl()
  let y = 8
  doc.setFontSize(7.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.gray)
  doc.text("Generated: " + formatGeneratedDate(), MR, y, { align: "right" })
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
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...C.ocean)
  doc.text("Group Registration", 105, y, { align: "center" })
  y += 4
  doc.setFontSize(8.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.gray)
  doc.text(`Paid by ${p.generatedFor} · ${p.divers.length} divers`, 105, y + 4, { align: "center" })
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
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    chunk.forEach((d, c) => doc.text(`Diver ${i + c + 1}`, cols[c].x, y + 5.5))
    doc.text(`DIVERS ${i + 1}–${i + chunk.length}`, GROUP_LABEL_X, y + 5.5)
    doc.setFont("helvetica", "normal")
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
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...C.ocean)
  doc.text(`Group total (${p.divers.length} divers) (${CUR})`, GROUP_LABEL_X, y + 1)
  doc.setFontSize(13)
  doc.text(String(p.groupTotal), 130, y + 1)
  y += 10

  // How to pay — the group shares one payment method (the lead settles once).
  const instr = paymentInstructionsFor(p.paymentMethod, {
    invoiceEmail: p.creditCardInvoiceEmail ?? p.leadEmail,
  })
  if (instr) {
    y += 4
    y = section(doc, y, instr.title)
    doc.setFontSize(8.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...C.dark)
    for (const line of instr.lines) {
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
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.dark)
  for (const line of reminder.lines) {
    for (const w of doc.splitTextToSize(line, MR - ML - 2)) {
      y = ensureY(doc, y, 6)
      doc.text(w, ML + 2, y)
      y += 4.5
    }
  }

  y += 4
  y = ensureY(doc, y, 8)
  doc.setFont("helvetica", "normal")
  const summary = p.fullPaymentDeadline
    ? `Pay deposit ASAP to hold the group's spots. Pay the remaining balance by ${formatDeadlineLong(p.fullPaymentDeadline)} to complete the registration.`
    : `Pay deposit ASAP to hold the group's spots. Pay the remaining balance to complete the registration.`
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
