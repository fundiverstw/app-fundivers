import { supabase } from './supabase'
import { personName } from './names'

// Who did this?
//
// Every money row already carries the id of whoever wrote it -- payments.
// recorded_by, credits.created_by / settled_by, booking_amendments.created_by,
// bookings.cancelled_by / cancellation_settled_by -- but a uuid on screen
// tells an admin nothing. The accounting views resolve those ids to names so a
// figure someone disputes can be traced to the person who entered it, rather
// than to "the app".
//
// Ids arrive from several tables at once and repeat heavily (one admin records
// most of a season's payments), so callers collect them all and resolve in one
// round trip.

export type ActorNames = ReadonlyMap<string, string>

/** Resolve profile ids to display names, ignoring nulls and duplicates.
 *  Returns an empty map when there is nothing to look up. */
export async function fetchActorNames(
  ids: ReadonlyArray<string | null | undefined>,
): Promise<ActorNames> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (!unique.length) return new Map()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, nickname')
    .in('id', unique)
  if (error) throw error
  return new Map((data ?? []).map(p => [p.id, personName(p.name, p.nickname)]))
}

/**
 * Name for one actor id, for display next to the thing they did.
 *
 * A null id is not a missing name -- it means no session was attributed at
 * all, which is what a database trigger, a migration or the push worker looks
 * like from here. `systemLabel` names that case honestly instead of blaming a
 * person. An id we cannot resolve (a deleted profile) keeps its first octet so
 * two different unknowns stay distinguishable.
 */
export function actorLabel(
  names: ActorNames,
  id: string | null | undefined,
  labels: { system: string; unknown: (short: string) => string },
): string {
  if (!id) return labels.system
  return names.get(id) ?? labels.unknown(id.slice(0, 8))
}
