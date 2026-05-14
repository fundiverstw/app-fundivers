// Per-event diver-info PDF. Built on the same jsPDF stack as
// _shared/pdf.ts so the visual style (logo, ocean-blue header band,
// alternating row tint) matches the rest of FunDivers' email output.
//
// The output is a single A4-portrait sheet (or more, paginated as needed)
// listing every diver booked onto a specific event, with the columns the
// dive shop needs for boat manifests and trip-leader paperwork: legal
// name, alt-script name (e.g. Chinese), DOB, nationality, ID/passport.

import { jsPDF } from "npm:jspdf@2.5.1"
import { Buffer } from "node:buffer"

const LOGO_PATH = new URL("./fd_logo.png", import.meta.url)

const C = {
  ocean:   [11, 83, 148],
  oceanBg: [238, 245, 251],
  dark:    [26, 26, 26],
  gray:    [110, 110, 110],
  white:   [255, 255, 255],
} as const

const ML = 10   // left margin (mm)
const MR = 200  // right edge (A4 width = 210mm)

export interface EventDiverRow {
  /** Primary legal name. Required — used as the row anchor. */
  name: string
  /** Optional name in another script (e.g. 中文). */
  nameAlt: string | null
  /** YYYY-MM-DD or null. */
  dob: string | null
  nationality: string | null
  idNumber: string | null
}

export interface EventDiversPdfPayload {
  eventTitle: string
  /** YYYY-MM-DD or null. */
  startDate: string | null
  /** YYYY-MM-DD or null. May equal startDate for single-day events. */
  endDate: string | null
  divers: EventDiverRow[]
}

function formatGeneratedDate(): string {
  return new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
}

// 'YYYY-MM-DD' → 'Sat, May 17, 2026'. Date-fns isn't available on the
// edge runtime, so do the formatting by hand. Falls back to the raw
// string if the input doesn't parse.
function formatDateLong(yyyyMmDd: string | null): string {
  if (!yyyyMmDd) return ""
  const d = new Date(yyyyMmDd + "T00:00:00Z")
  if (Number.isNaN(d.getTime())) return yyyyMmDd
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]
  return `${wd}, ${mo} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "(date not set)"
  if (!end || end === start) return formatDateLong(start)
  return `${formatDateLong(start)} → ${formatDateLong(end)}`
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

export async function buildEventDiversPdfBase64(p: EventDiversPdfPayload): Promise<string> {
  const doc = new jsPDF({ unit: "mm", format: "a4" })

  // ── Header ────────────────────────────────────────────
  let y = 8
  const logo = await loadLogoDataUrl()

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
  doc.text("Event Diver Manifest", 105, y, { align: "center" })
  y += 7

  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...C.dark)
  // splitTextToSize so a very long event title wraps cleanly into
  // two lines rather than running off the right edge.
  for (const line of doc.splitTextToSize(p.eventTitle, MR - ML)) {
    doc.text(line, 105, y, { align: "center" })
    y += 5
  }
  doc.setFontSize(9)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(...C.gray)
  doc.text(formatDateRange(p.startDate, p.endDate), 105, y, { align: "center" })
  y += 8

  // ── Table ────────────────────────────────────────────
  // 5 columns. Widths chosen so the row fits within the 190mm content
  // strip and ID numbers (typically 9–14 chars) don't truncate.
  const COLS = [
    { label: "Name",          w: 45 },
    { label: "Alt name",      w: 40 },
    { label: "DOB",           w: 22 },
    { label: "Nationality",   w: 30 },
    { label: "ID / Passport", w: 53 },
  ]
  const ROW_H = 7

  function drawHeader(yPos: number): number {
    doc.setFillColor(...C.ocean)
    doc.rect(ML, yPos, 190, ROW_H, "F")
    doc.setTextColor(...C.white)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    let x = ML
    for (const col of COLS) {
      doc.text(col.label, x + 1.5, yPos + 5)
      x += col.w
    }
    return yPos + ROW_H
  }

  function maybeNewPage(yPos: number): number {
    const pageH = doc.internal.pageSize.getHeight()
    if (yPos + ROW_H > pageH - 12) {
      doc.addPage()
      return drawHeader(18)
    }
    return yPos
  }

  y = drawHeader(y)

  if (p.divers.length === 0) {
    doc.setFont("helvetica", "italic")
    doc.setTextColor(...C.gray)
    doc.setFontSize(9)
    doc.text("(no divers registered for this event)", 105, y + 8, { align: "center" })
    return doc.output("datauristring").split(",")[1]
  }

  let alt = false
  for (const diver of p.divers) {
    y = maybeNewPage(y)
    if (alt) {
      doc.setFillColor(...C.oceanBg)
      doc.rect(ML, y, 190, ROW_H, "F")
    }
    alt = !alt

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(...C.dark)
    const values = [
      diver.name,
      diver.nameAlt ?? "",
      diver.dob ?? "",
      diver.nationality ?? "",
      diver.idNumber ?? "",
    ]
    let x = ML
    for (let i = 0; i < COLS.length; i++) {
      // Wrap to one line — multi-line rows make the boat manifest hard
      // to read on a single sheet. Long values get visually truncated by
      // splitTextToSize taking the first line.
      const fitted = doc.splitTextToSize(values[i], COLS[i].w - 2)[0] ?? ""
      doc.text(fitted, x + 1.5, y + 5)
      x += COLS[i].w
    }
    y += ROW_H
  }

  // Footer count.
  y += 4
  const pageH = doc.internal.pageSize.getHeight()
  if (y + 6 > pageH - 12) { doc.addPage(); y = 18 }
  doc.setFont("helvetica", "italic")
  doc.setFontSize(8.5)
  doc.setTextColor(...C.gray)
  doc.text(`${p.divers.length} diver${p.divers.length === 1 ? "" : "s"} registered`, MR, y, { align: "right" })

  return doc.output("datauristring").split(",")[1]
}
