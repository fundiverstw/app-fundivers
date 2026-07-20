import type { CourseColor } from '../lib/event-colors'
import type { WaiverRow } from '../types/database'
import type { EventKind } from '../lib/event-kinds'

// ─────────────────────────────────────────────────────────────────────────────
// Waiver domain types.
//
// The waiver CATALOG now lives in the `waivers` DB table — shop owners author
// their own (free-form text OR an uploaded PDF, in whatever language they need)
// from admin → Manage → Waivers, and attach them to events. This module holds
// the shared types the app reads through, plus the row→domain mapper. The rules
// that combine these with per-event overrides + signatures are in
// src/lib/waivers.ts.
//
// `code` + integer `version` remain the stable keys: `waiver_signatures` and
// `event_waivers` reference a waiver by its code, and a version bump forces a
// re-sign (mirrors public.terms.version for the Terms of Use).
// ─────────────────────────────────────────────────────────────────────────────

export type WaiverCadence =
  /** One signature covers every qualifying event for a year from signing. */
  | 'annual'
  /** A fresh signature is required for each event (tied to that dive/course). */
  | 'per_event'

// 'none' keeps a waiver in the catalog — voluntarily signable, and requirable on
// individual events via an event_waivers 'require' override — without any global
// rule auto-requiring it.
export type WaiverAppliesTo = 'dives' | 'courses' | 'adventures' | 'all' | 'none'

// The `applies_to` value that names each kind. A full Record so a new kind has
// to be given a scope: the old shape read "dive, else course", which silently
// scoped any third kind under the course rules — including the course-colour
// filter, which it can never match.
export const WAIVER_SCOPE_BY_KIND: Record<EventKind, WaiverAppliesTo> = {
  dive:   'dives',
  course: 'courses',
  adventure: 'adventures',
}


export interface WaiverDef {
  /** Stable identifier stored on signatures/overrides — never reuse for a
   *  different waiver. */
  code: string
  title: string
  cadence: WaiverCadence
  /** Bump to force everyone to re-sign the next time they hit a qualifying
   *  event or open My Waivers. */
  version: number
  appliesTo: WaiverAppliesTo
  /** When courses are in scope, restrict to these classifier buckets (from
   *  courseColor()). Omit to apply to every course. Ignored for `dives`. */
  courseColors?: CourseColor[]
  /** Free-form label for the shop's own organisation ('en', 'zh-TW', 日本語…).
   *  Not tied to the app locale — the shop attaches the right waiver by hand. */
  language?: string | null
  /** The text form shown before signing. Null when the waiver is a PDF. */
  body?: string | null
  /** Object path in the `waiver-pdfs` bucket. Null when the waiver is text. */
  pdfPath?: string | null
}

/** How long an `annual` signature stays valid. */
export const ANNUAL_WAIVER_VALID_DAYS = 365

/** Map a `waivers` table row into the camelCase domain type the app uses. */
export function rowToWaiverDef(row: WaiverRow): WaiverDef {
  return {
    code: row.code,
    title: row.title,
    cadence: row.cadence,
    version: row.version,
    appliesTo: row.applies_to,
    courseColors: (row.course_colors ?? undefined) as CourseColor[] | undefined,
    language: row.language,
    body: row.body,
    pdfPath: row.pdf_path,
  }
}
