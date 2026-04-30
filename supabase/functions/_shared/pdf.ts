// Registration-form PDF builder. Ported near-verbatim from the Wix
// backend file wix-site/backend/sendRegistrationPdf.web.js — layout and
// colours deliberately match so divers get the same-looking PDF in email
// whether the booking came through Wix or the PWA.
//
// Uses jsPDF directly (Deno 2 edge runtime supports `npm:` specifiers).

import { jsPDF } from "npm:jspdf@2.5.1"
import { Buffer } from "node:buffer"
import { paymentInstructionsFor } from "./payment-instructions.ts"

const LOGO_URL =
  "https://static.wixstatic.com/media/b37fef_ade8b006d798481a89453869bbc7aee6~mv2.png/v1/fill/w_400,h_240,al_c,q_85,enc_auto/b37fef_ade8b006d798481a89453869bbc7aee6~mv2.png"

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
  gearMode: 'full' | 'a-la-carte' | ''
  gearItems: string[]
  diveDays: number | null
  height: number | string | null
  weight: number | string | null
  shoeSize: string | null
  needsRide: boolean
  notes: string | null
  paymentMethod: 'bank' | 'paypal' | 'cash' | string
  deposit: number | string | null
  total: number | null
  /** True when the diver chose deposit-only at registration. */
  payDepositOnly: boolean
  /** YYYY-MM-DD; resolved upstream so the PDF always has concrete dates. */
  depositDeadline: string | null
  fullPaymentDeadline: string | null
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

async function fetchLogoDataUrl(): Promise<{ dataUrl: string; format: "PNG" | "JPEG" } | null> {
  try {
    const res = await fetch(LOGO_URL)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const ct = res.headers.get("content-type") ?? ""
    const b64 = Buffer.from(buf).toString("base64")
    if (ct.includes("jpeg") || ct.includes("jpg")) {
      return { dataUrl: "data:image/jpeg;base64," + b64, format: "JPEG" }
    }
    return { dataUrl: "data:image/png;base64," + b64, format: "PNG" }
  } catch {
    return null
  }
}

export async function buildPdfBase64(p: RegistrationPdfPayload): Promise<string> {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const altState = { alt: false }

  // ── Header ────────────────────────────────────────────
  const logo = await fetchLogoDataUrl()
  let y = 8

  doc.setFontSize(7.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...C.gray)
  doc.text("Generated: " + formatGeneratedDate(), MR, y, { align: "right" })
  y += 5

  if (logo) {
    try {
      const logoW = 38, logoH = 23
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
    : p.rentGear
      ? ((p.gearMode === "full" ? "Full set" : "A-la-carte") + (gearDays > 1 ? " x" + gearDays + " days" : ""))
      : "No"
  y = row(doc, y, "Gear rental", gearLabel, altState)
  if (p.rentGear && p.gearItems && p.gearItems.length) {
    y = row(doc, y, "Items", p.gearItems.join(", "), altState)
  }
  if (p.rentGear && (p.height || p.weight || p.shoeSize)) {
    y = row(doc, y, "Sizing", "H: " + (p.height || "") + "  W: " + (p.weight || "") + "  Shoe: " + (p.shoeSize || ""), altState)
  }
  y = row(doc, y, "Transportation", p.needsRide ? "Yes" : "No", altState)
  if (p.notes) y = row(doc, y, "Note", p.notes, altState)
  y += 4

  // ── Payment ───────────────────────────────────────────
  altState.alt = false
  y = section(doc, y, "Payment")
  const methodLabel =
    p.paymentMethod === "bank"   ? "Bank transfer"
    : p.paymentMethod === "paypal" ? "Credit card / PayPal"
    : p.paymentMethod === "cash"   ? "Cash"
    : (p.paymentMethod || "")
  y = row(doc, y, "Method", methodLabel, altState)
  y = row(doc, y, "Deposit due (NTD)", p.deposit, altState)
  y += 2

  // Total — highlighted row
  y = ensureY(doc, y, 14)
  doc.setFillColor(...C.oceanLight)
  doc.rect(0, y - 5, 210, 10, "F")
  doc.setFontSize(9)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...C.ocean)
  doc.text("Total (NTD)", ML + 2, y + 1)
  doc.setFontSize(13)
  doc.text(p.total != null ? String(p.total) : "-", COL, y + 1)
  y += 8

  // How to pay — per-method instructions (shop address for cash, bank
  // details for bank transfer, "await PayPal email" for credit card).
  const instr = paymentInstructionsFor(p.paymentMethod)
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

  // Deadlines — always render the summary line. When the diver opted to pay
  // the deposit only we also break out the two amount/date pairs so they
  // know exactly what to send and when.
  if (p.depositDeadline || p.fullPaymentDeadline) {
    y += 4
    y = ensureY(doc, y, 16)
    doc.setFontSize(8.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...C.dark)
    const summary =
      `Pay by ${formatDeadlineLong(p.depositDeadline)} to hold your spot. ` +
      `Pay full amount by ${formatDeadlineLong(p.fullPaymentDeadline)} to complete your registration.`
    const wrapped = doc.splitTextToSize(summary, MR - ML - 2)
    for (const line of wrapped) { doc.text(line, ML + 2, y); y += 4.5 }

    if (p.payDepositOnly && typeof p.deposit === "number" && typeof p.total === "number") {
      y += 2
      const remaining = Math.max(0, p.total - p.deposit)
      doc.setFont("helvetica", "bold")
      doc.text(`Pay deposit by ${formatDeadlineLong(p.depositDeadline)}: ${p.deposit} NTD`, ML + 2, y)
      y += 4.5
      doc.text(`Pay remaining amount by ${formatDeadlineLong(p.fullPaymentDeadline)}: ${remaining} NTD`, ML + 2, y)
      y += 4.5
      doc.setFont("helvetica", "normal")
    }
  }

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
