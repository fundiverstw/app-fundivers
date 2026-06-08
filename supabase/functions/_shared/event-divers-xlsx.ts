// Serializes the diver manifest (see event-divers-manifest.ts) into an
// .xlsx workbook. SheetJS is pure JS, so Chinese text "just works" — Excel
// / Numbers / Sheets render it with the reader's own CJK fonts, with no
// font embedding (which is what made a PDF version of this sheet heavy).

import * as XLSX from "npm:xlsx@0.18.5"
import {
  buildManifestAoa,
  MANIFEST_HEADERS,
  MANIFEST_SHEET_NAME,
  type BoatManifestConfig,
  type EventDiverRow,
} from "./event-divers-manifest.ts"

export type { EventDiverRow, BoatManifestConfig }

export interface EventDiversXlsxPayload {
  divers: EventDiverRow[]
  config: BoatManifestConfig
}

// Per-column widths (Excel character units), left-to-right matching
// MANIFEST_HEADERS. The name column is widest to fit "Latin 中文" pairs.
const COL_WIDTHS = [6, 26, 18, 16, 7, 14, 12, 10, 14]

export function buildEventDiversXlsxBase64(p: EventDiversXlsxPayload): string {
  const aoa = buildManifestAoa(p.divers, p.config)
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  ws["!cols"] = COL_WIDTHS.map(wch => ({ wch }))

  // Merge the title row and every footer-note row across all columns so
  // they read as full-width banners rather than sitting in column A.
  const lastCol = MANIFEST_HEADERS.length - 1
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }]
  for (let r = 0; r < aoa.length; r++) {
    // A single-cell row past the header/diver block is a footer note.
    if (r > 1 && aoa[r].length === 1 && aoa[r][0] !== undefined && aoa[r][0] !== "") {
      merges.push({ s: { r, c: 0 }, e: { r, c: lastCol } })
    }
  }
  ws["!merges"] = merges

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, MANIFEST_SHEET_NAME)

  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string
}
