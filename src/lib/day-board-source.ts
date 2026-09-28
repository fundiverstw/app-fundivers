import {
  fetchDayBoard, fetchDayTransport,
  type DayBoardData, type DayTransportData,
} from './day-board'
import { coversDay, selectDayBoard, selectDayTransport, type OfflineSnapshot } from './offline-snapshot'

/**
 * The fallback shape every supporting read on the board uses: the fleet, the
 * sizing charts, the day picker. Try the network, and take what the device
 * holds when it can't answer — whether because the browser says there is no
 * connection or because the read failed anyway.
 *
 * A declared-offline read is skipped rather than attempted, because a failed
 * fetch is not the only way to get an unusable answer: supabase-js resolves a
 * query against an unreachable host as an *error result*, not a rejection, in
 * enough cases that catching alone would silently hand the board an empty
 * fleet and call it fact.
 */
export async function liveOrStored<T>(
  online: boolean,
  live: () => Promise<T>,
  stored: () => T,
): Promise<T> {
  if (online) {
    try {
      return await live()
    } catch {
      // fall through to the device
    }
  }
  return stored()
}

/** Where the rows on screen came from. The board says so out loud — a roster
 *  captured this morning and one read just now look identical otherwise, and
 *  staff act on the difference. */
export type DayBoardSource = 'live' | 'snapshot'

export interface DayBoardResult {
  data: DayBoardData
  source: DayBoardSource
}

/**
 * One day's board, live if the network can supply it and from this device if it
 * cannot.
 *
 * `navigator.onLine` is only consulted to skip a read that is certain to fail;
 * a browser reporting a connection can still be behind a captive portal or one
 * bar of signal, so a *failed* live read falls back exactly like a declared
 * offline does. That is the case this feature exists for — nobody standing on a
 * boat gets to toggle a flag first.
 *
 * Returns null when there is nothing to show: no network and either no snapshot
 * or a snapshot that never covered this day. Null is deliberately distinct from
 * an empty board, which means "captured, and that day is quiet".
 */
export async function loadDayBoard(
  day: string,
  snapshot: OfflineSnapshot | null,
  online: boolean,
): Promise<DayBoardResult | null> {
  if (online) {
    try {
      return { data: await fetchDayBoard(day), source: 'live' }
    } catch {
      // fall through to the device
    }
  }
  if (!snapshot || !coversDay(snapshot, day)) return null
  const stored = selectDayBoard(snapshot, day)
  return stored ? { data: stored, source: 'snapshot' } : null
}

/** Cars and ride groupings, same fallback. Transport is advisory next to the
 *  roster, so a miss returns empty rather than null — an offline board with no
 *  car plan is still the board. */
export async function loadDayTransport(
  day: string,
  eventIds: string[],
  snapshot: OfflineSnapshot | null,
  online: boolean,
): Promise<DayTransportData> {
  if (online) {
    try {
      return await fetchDayTransport(day, eventIds)
    } catch {
      // fall through to the device
    }
  }
  return (snapshot && selectDayTransport(snapshot, day)) ?? { allocations: [], rideGroups: [] }
}
