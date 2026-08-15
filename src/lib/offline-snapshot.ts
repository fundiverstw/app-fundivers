import { addIsoDays } from './dates'
import { EMPTY_DAY_BOARD, type DayBoardData, type DayTransportData } from './day-board'
import type { GearModelWithSizes } from './gear-sizing'
import type { Profile, Vehicle } from '../types/database'

/** How many days ahead the board is kept available with no signal. */
export const OFFLINE_DAYS = 10

/** Bumped when the stored shape changes. A snapshot from an older build is
 *  discarded rather than migrated — it is a cache, and the next sync refills
 *  it in seconds. */
export const SNAPSHOT_VERSION = 1

export interface OfflineSnapshot {
  version: number
  /** Whose session captured this. A reader whose session id differs discards
   *  it unread: RLS scoped every row below to this user, so serving them to
   *  the next person on the device would be the same leak sw-cache-policy.ts
   *  exists to prevent. */
  userId: string
  /** ISO instant the capture finished — what the board's "synced at" reads. */
  capturedAt: string
  /** The days covered, ascending, starting from the capture's today. */
  days: string[]
  /** Days with events for the "Other day" picker, over its own longer window. */
  upcomingDays: string[]
  vehicles: Vehicle[]
  gearModels: GearModelWithSizes[]
  boards: Record<string, DayBoardData>
  transport: Record<string, DayTransportData>
}

// What a diver's row keeps once it is written to a phone that leaves the shop.
//
// The board needs a name, sizes, what they own, what they are certified for and
// how to reach them. It does not need who to call if they stop breathing, their
// national ID, or their medical history — those are read off a live connection
// at the shop, and a lost phone should not carry them.
//
// Enumerated rather than deleted from a spread on purpose: a column added to
// `profiles` later fails this file's typecheck until somebody decides which
// side of the line it belongs on. A silent default is how PII ends up on
// devices nobody meant to put it on.
const REDACTED_PROFILE_FIELDS = {
  email: null,
  date_of_birth: null,
  nationality: null,
  id_number: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  medical_notes: null,
  cert_card_path: null,
  nitrox_card_path: null,
  deep_card_path: null,
  avatar_url: null,
  last_dive_date: null,
  agreed_to_terms_at: null,
  agreed_to_terms_version: null,
  application_submitted_at: null,
  parent_account: null,
} as const satisfies Partial<Profile>

/**
 * A diver's row reduced to the operational fields, for storage on-device.
 *
 * One visible consequence: `date_of_birth` is dropped, and the gear-fit lookup
 * uses it to route under-13s to the kids' sizing charts. Offline that lookup
 * falls back to the diver's recorded gender. It is a fit suggestion, not a
 * safety gate, and the alternative is every staff phone carrying every diver's
 * birth date.
 */
export function redactProfileForOffline(profile: Profile): Profile {
  return { ...profile, ...REDACTED_PROFILE_FIELDS }
}

function redactBoard(board: DayBoardData): DayBoardData {
  return { ...board, profiles: board.profiles.map(redactProfileForOffline) }
}

/** The ten day keys a capture starting on `today` covers, ascending. */
export function offlineDays(today: string): string[] {
  return Array.from({ length: OFFLINE_DAYS }, (_, i) => addIsoDays(today, i))
}

/** The reads a capture makes. Injected so the builder is testable without a
 *  network, and so the caller owns the query shapes. */
export interface SnapshotSources {
  fetchDayBoard: (day: string) => Promise<DayBoardData>
  fetchDayTransport: (day: string, eventIds: string[]) => Promise<DayTransportData>
  fetchUpcomingDays: (from: string, to: string) => Promise<string[]>
  fetchVehicles: () => Promise<Vehicle[]>
  fetchGearModels: () => Promise<GearModelWithSizes[]>
}

/**
 * Capture the next ten days.
 *
 * Days are fetched one at a time rather than in parallel: this runs in the
 * background behind whatever the user is actually looking at, and ten
 * simultaneous multi-query days would contend with the page's own reads on a
 * phone's connection for no benefit — nobody is waiting on it.
 *
 * A day that fails is stored as an empty board and the capture continues. The
 * alternative — abandoning the whole snapshot because day seven timed out — is
 * how staff end up on a boat with nothing. `capturedAt` still stamps the
 * attempt, and the board shows it, so a stale day is visible as stale rather
 * than presented as an empty one.
 */
export async function buildSnapshot(
  userId: string,
  today: string,
  now: string,
  sources: SnapshotSources,
  lookaheadDays: number,
): Promise<OfflineSnapshot> {
  const days = offlineDays(today)
  const boards: Record<string, DayBoardData> = {}
  const transport: Record<string, DayTransportData> = {}

  for (const day of days) {
    let board: DayBoardData
    try {
      board = await sources.fetchDayBoard(day)
    } catch {
      boards[day] = { ...EMPTY_DAY_BOARD }
      transport[day] = { allocations: [], rideGroups: [] }
      continue
    }
    boards[day] = redactBoard(board)
    try {
      transport[day] = await sources.fetchDayTransport(day, board.events.map(e => e.id))
    } catch {
      transport[day] = { allocations: [], rideGroups: [] }
    }
  }

  const [upcomingDays, vehicles, gearModels] = await Promise.all([
    sources.fetchUpcomingDays(today, addIsoDays(today, lookaheadDays)).catch(() => days),
    sources.fetchVehicles().catch(() => [] as Vehicle[]),
    sources.fetchGearModels().catch(() => [] as GearModelWithSizes[]),
  ])

  return {
    version: SNAPSHOT_VERSION,
    userId,
    capturedAt: now,
    days,
    upcomingDays,
    vehicles,
    gearModels,
    boards,
    transport,
  }
}

/**
 * Is this stored record usable by the signed-in user right now? Anything that
 * fails here is treated as no snapshot at all — never as a partial one.
 */
export function isUsableSnapshot(value: unknown, userId: string): value is OfflineSnapshot {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<OfflineSnapshot>
  if (s.version !== SNAPSHOT_VERSION) return false
  if (typeof s.userId !== 'string' || s.userId !== userId) return false
  if (typeof s.capturedAt !== 'string') return false
  if (!Array.isArray(s.days) || !s.boards || typeof s.boards !== 'object') return false
  return true
}

/** The stored board for a day, or null when the day is outside the window.
 *  A day inside the window that captured nothing returns its empty board —
 *  "no events that day" is an answer, and distinct from "not covered". */
export function selectDayBoard(snapshot: OfflineSnapshot, day: string): DayBoardData | null {
  return snapshot.boards[day] ?? null
}

export function selectDayTransport(snapshot: OfflineSnapshot, day: string): DayTransportData | null {
  return snapshot.transport?.[day] ?? null
}

/** Is `day` inside what this snapshot promised to cover? Used to tell "we never
 *  captured that far ahead" apart from "that day is genuinely quiet". */
export function coversDay(snapshot: OfflineSnapshot, day: string): boolean {
  return snapshot.days.includes(day)
}
