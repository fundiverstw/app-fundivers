import { supabase } from './supabase'
import { courseColor } from './event-colors'
import { WAIVERS, ANNUAL_WAIVER_VALID_DAYS, type WaiverDef } from '../config/waivers'
import type { EventWaiver, WaiverSignature } from '../types/database'

// Waiver logic — combines the config catalog/global rules (src/config/waivers.ts)
// with the DB facts (per-diver signatures, per-event overrides) to answer "which
// waivers does this diver still need for this event?". Pure helpers are
// unit-tested; the thin fetchers wrap supabase.

/** The minimum an event must expose for the waiver rules. */
export interface WaiverEventRef {
  id: string
  type: 'dive' | 'course'
  title: string
}

/** The override fields the rule combiner reads (EventWaiver satisfies this). */
export type WaiverOverride = Pick<EventWaiver, 'waiver_code' | 'mode'>

const DAY_MS = 86_400_000

// Does the waiver's GLOBAL rule (before per-event overrides) cover this event?
export function globalRuleMatches(def: WaiverDef, event: WaiverEventRef): boolean {
  if (event.type === 'dive') return def.appliesTo === 'dives' || def.appliesTo === 'all'
  // course
  if (def.appliesTo !== 'courses' && def.appliesTo !== 'all') return false
  if (def.courseColors && def.courseColors.length > 0) {
    return def.courseColors.includes(courseColor(event.title))
  }
  return true
}

// The waivers an event actually requires: start from the global rule, then apply
// per-event overrides — 'exempt' drops a waiver, 'require' adds one the rule
// wouldn't have. Order follows the config (stable display order).
export function requiredWaiversForEvent(
  event: WaiverEventRef, overrides: WaiverOverride[],
): WaiverDef[] {
  const mode = new Map(overrides.map(o => [o.waiver_code, o.mode]))
  return WAIVERS.filter(def => {
    const ov = mode.get(def.code)
    if (ov === 'exempt') return false
    return ov === 'require' || globalRuleMatches(def, event)
  })
}

// Is this signature a CURRENT acknowledgment of `def` for `event`?
//   - version must be at least the config version (a bump invalidates old sigs).
//   - annual: signed within the validity window, regardless of event.
//   - per_event: tied to this exact event.
export function isSignatureCurrent(
  def: WaiverDef, sig: WaiverSignature, event: WaiverEventRef, now: Date,
): boolean {
  if (sig.waiver_code !== def.code) return false
  if (sig.waiver_version < def.version) return false
  if (def.cadence === 'annual') {
    const ageMs = now.getTime() - new Date(sig.signed_at).getTime()
    return ageMs <= ANNUAL_WAIVER_VALID_DAYS * DAY_MS
  }
  const eventId = event.type === 'dive' ? sig.eo_dive_id : sig.eo_course_id
  return eventId === event.id
}

// Required waivers this diver has NOT satisfied for the event.
export function missingWaivers(
  event: WaiverEventRef, overrides: WaiverOverride[], signatures: WaiverSignature[], now: Date,
): WaiverDef[] {
  return requiredWaiversForEvent(event, overrides).filter(
    def => !signatures.some(sig => isSignatureCurrent(def, sig, event, now)),
  )
}

export type AnnualWaiverState = 'signed' | 'expired' | 'outdated' | 'unsigned'

export interface AnnualWaiverStatus {
  state: AnnualWaiverState
  signedAt: string | null
  /** ISO date the current signature stays valid until (state === 'signed'). */
  validUntil: string | null
}

// Status of an annual waiver for the My Waivers panel — derived from the diver's
// latest signature of that code.
export function annualWaiverStatus(
  def: WaiverDef, signatures: WaiverSignature[], now: Date,
): AnnualWaiverStatus {
  const latest = signatures
    .filter(s => s.waiver_code === def.code)
    .sort((a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime())[0]
  if (!latest) return { state: 'unsigned', signedAt: null, validUntil: null }
  if (latest.waiver_version < def.version) {
    return { state: 'outdated', signedAt: latest.signed_at, validUntil: null }
  }
  const signedMs = new Date(latest.signed_at).getTime()
  const expiresMs = signedMs + ANNUAL_WAIVER_VALID_DAYS * DAY_MS
  if (now.getTime() > expiresMs) {
    return { state: 'expired', signedAt: latest.signed_at, validUntil: null }
  }
  return { state: 'signed', signedAt: latest.signed_at, validUntil: new Date(expiresMs).toISOString() }
}

/** The annual, diver-level waivers (the ones the profile page manages). */
export function annualWaivers(): WaiverDef[] {
  return WAIVERS.filter(w => w.cadence === 'annual')
}

// ── Data layer ───────────────────────────────────────────────────────────────

export async function fetchEventWaiverOverrides(
  event: { dive_id?: string | null; course_id?: string | null },
): Promise<EventWaiver[]> {
  const col = event.dive_id ? 'eo_dive_id' : 'eo_course_id'
  const val = event.dive_id ?? event.course_id
  if (!val) return []
  const { data, error } = await supabase.from('event_waivers').select('*').eq(col, val)
  if (error) throw error
  return (Array.isArray(data) ? data : []) as EventWaiver[]
}

export async function fetchDiverSignatures(diverId: string): Promise<WaiverSignature[]> {
  const { data, error } = await supabase
    .from('waiver_signatures').select('*').eq('diver_id', diverId)
  if (error) throw error
  return (Array.isArray(data) ? data : []) as WaiverSignature[]
}

export async function fetchSignaturesForDivers(diverIds: string[]): Promise<WaiverSignature[]> {
  if (diverIds.length === 0) return []
  const { data, error } = await supabase
    .from('waiver_signatures').select('*').in('diver_id', diverIds)
  if (error) throw error
  return (Array.isArray(data) ? data : []) as WaiverSignature[]
}

// Record a signature via the server-stamped RPC. Per-event waivers pass the
// event; annual waivers omit it. Returns the new signature id.
export async function signWaiver(args: {
  def: WaiverDef
  signedName: string
  event?: WaiverEventRef
}): Promise<string> {
  const { def, signedName, event } = args
  const perEvent = def.cadence === 'per_event' ? event : undefined
  const { data, error } = await supabase.rpc('sign_waiver', {
    p_code: def.code,
    p_version: def.version,
    p_signed_name: signedName,
    p_dive_id: perEvent?.type === 'dive' ? perEvent.id : null,
    p_course_id: perEvent?.type === 'course' ? perEvent.id : null,
  })
  if (error) throw error
  return data as string
}

// Admin: set or clear a per-event override. `mode = null` removes any override
// for that waiver on the event (reverting to the global rule).
export async function setEventWaiverOverride(args: {
  event: WaiverEventRef
  code: string
  mode: 'require' | 'exempt' | null
  createdBy: string | null
}): Promise<void> {
  const { event, code, mode, createdBy } = args
  const col = event.type === 'dive' ? 'eo_dive_id' : 'eo_course_id'
  const del = await supabase.from('event_waivers').delete().eq(col, event.id).eq('waiver_code', code)
  if (del.error) throw del.error
  if (mode === null) return
  const { error } = await supabase.from('event_waivers').insert({
    eo_dive_id: event.type === 'dive' ? event.id : null,
    eo_course_id: event.type === 'course' ? event.id : null,
    waiver_code: code,
    mode,
    created_by: createdBy,
  })
  if (error) throw error
}
