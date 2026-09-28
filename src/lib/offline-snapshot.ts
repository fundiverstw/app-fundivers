import { addIsoDays } from './dates'
import type { DayBoardData, DayTransportData } from './day-board'
import type { GearModelWithSizes } from './gear-sizing'
import type { Profile, Vehicle } from '../types/database'

// Only today is kept on the device. The capture used to hold ten days, which
// cost ~90 requests every fifteen minutes on every staff page and slowed the
// app down; the board is read with no signal on the day itself, on the boat.

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
  /** The days covered — today's date at capture time. */
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
 * Capture today's board.
 *
 * A board read that fails throws, so the caller keeps the copy it already has:
 * with one day stored, an empty board written over a good one is how staff end
 * up on a boat with nothing. A transport, fleet or chart read that fails is
 * stored empty instead — the roster is the part that has to be there.
 */
export async function buildSnapshot(
  userId: string,
  today: string,
  now: string,
  sources: SnapshotSources,
  lookaheadDays: number,
): Promise<OfflineSnapshot> {
  const board = redactBoard(await sources.fetchDayBoard(today))
  const [transport, upcomingDays, vehicles, gearModels] = await Promise.all([
    sources.fetchDayTransport(today, board.events.map(e => e.id))
      .catch((): DayTransportData => ({ allocations: [], rideGroups: [] })),
    sources.fetchUpcomingDays(today, addIsoDays(today, lookaheadDays)).catch(() => [today]),
    sources.fetchVehicles().catch(() => [] as Vehicle[]),
    sources.fetchGearModels().catch(() => [] as GearModelWithSizes[]),
  ])

  return {
    version: SNAPSHOT_VERSION,
    userId,
    capturedAt: now,
    days: [today],
    upcomingDays,
    vehicles,
    gearModels,
    boards: { [today]: board },
    transport: { [today]: transport },
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
