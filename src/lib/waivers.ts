import { supabase } from './supabase'
import { courseColor } from './event-colors'
import { usesCourseDays } from './event-kinds'
import { ANNUAL_WAIVER_VALID_DAYS, rowToWaiverDef, WAIVER_SCOPE_BY_KIND, type WaiverDef } from '../config/waivers'
import type { EventWaiver, WaiverSignature, WaiverRow, WaiverInsert, EventKind } from '../types/database'

// Waiver logic — combines the config catalog/global rules (src/config/waivers.ts)
// with the DB facts (per-diver signatures, per-event overrides) to answer "which
// waivers does this diver still need for this event?". Pure helpers are
// unit-tested; the thin fetchers wrap supabase.

/** The minimum an event must expose for the waiver rules. */
export interface WaiverEventRef {
  id: string
  type: EventKind
  title: string
}

/** The override fields the rule combiner reads (EventWaiver satisfies this). */
export type WaiverOverride = Pick<EventWaiver, 'waiver_code' | 'mode'>

const DAY_MS = 86_400_000

// Does the waiver's GLOBAL rule (before per-event overrides) cover this event?
export function globalRuleMatches(def: WaiverDef, event: WaiverEventRef): boolean {
  const scope = WAIVER_SCOPE_BY_KIND[event.type]
  if (def.appliesTo !== scope && def.appliesTo !== 'all') return false
  // Course colours narrow a course-scoped rule to particular course types;
  // they have no meaning for kinds that aren't courses.
  if (usesCourseDays(event.type) && def.courseColors && def.courseColors.length > 0) {
    return def.courseColors.includes(courseColor(event.title))
  }
  return true
}

// The waivers an event actually requires: start from the global rule, then apply
// per-event overrides — 'exempt' drops a waiver, 'require' adds one the rule
// wouldn't have. Order follows the given catalog (stable display order).
export function requiredWaiversForEvent(
  event: WaiverEventRef, overrides: WaiverOverride[], waivers: WaiverDef[],
): WaiverDef[] {
  const mode = new Map(overrides.map(o => [o.waiver_code, o.mode]))
  return waivers.filter(def => {
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
  return sig.event_id === event.id
}

// Required waivers this diver has NOT satisfied for the event.
export function missingWaivers(
  event: WaiverEventRef, overrides: WaiverOverride[], signatures: WaiverSignature[], now: Date,
  waivers: WaiverDef[],
): WaiverDef[] {
  return requiredWaiversForEvent(event, overrides, waivers).filter(
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
export function annualWaivers(waivers: WaiverDef[]): WaiverDef[] {
  return waivers.filter(w => w.cadence === 'annual')
}

// ── Data layer ───────────────────────────────────────────────────────────────

/** The active waiver catalog, mapped to the domain type. Reference data —
 *  publicly readable, admin-written (see the waivers RLS). */
export async function fetchWaivers(): Promise<WaiverDef[]> {
  const { data, error } = await supabase
    .from('waivers').select('*').eq('active', true).order('code')
  if (error) throw error
  return (Array.isArray(data) ? data : []).map(rowToWaiverDef)
}

/** Admin CRUD: every waiver row (incl. inactive), raw. */
export async function fetchAllWaivers(): Promise<WaiverRow[]> {
  const { data, error } = await supabase.from('waivers').select('*').order('code')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as WaiverRow[]
}

/** Admin CRUD: insert (no id) or update (id given). */
export async function saveWaiver(values: WaiverInsert, id?: string): Promise<void> {
  const { error } = id
    ? await supabase.from('waivers').update(values).eq('id', id)
    : await supabase.from('waivers').insert(values)
  if (error) throw error
}

export async function deleteWaiver(id: string): Promise<void> {
  const { error } = await supabase.from('waivers').delete().eq('id', id)
  if (error) throw error
}

export async function fetchEventWaiverOverrides(eventId: string | null): Promise<EventWaiver[]> {
  if (!eventId) return []
  const { data, error } = await supabase.from('event_waivers').select('*').eq('event_id', eventId)
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
    p_event_id: perEvent ? perEvent.id : null,
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
  const del = await supabase.from('event_waivers').delete().eq('event_id', event.id).eq('waiver_code', code)
  if (del.error) throw del.error
  if (mode === null) return
  const { error } = await supabase.from('event_waivers').insert({
    event_id: event.id,
    waiver_code: code,
    mode,
    created_by: createdBy,
  })
  if (error) throw error
}
