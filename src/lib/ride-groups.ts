import { supabase } from './supabase'
import type { EventRideGroup, EventRideGroupInsert } from '../types/database'

// Which of a day's events travel together (table `event_ride_groups`, added by
// 20260724000000: staff read, admin write). Events at one site can share a van;
// events at different sites can't, and no derivable field says which is which —
// so the shop states it, per day, and every seat calculation follows.
//
// A group is just a shared group_id. There's no parent row: the last member
// leaving takes the group with it, and a group left with a single member is
// indistinguishable from riding alone (see pruneLoneMember).

/** Every grouping row for one day, for the events shown. */
export async function fetchRideGroups(day: string, eventIds: string[]): Promise<EventRideGroup[]> {
  if (!day || eventIds.length === 0) return []
  const { data, error } = await supabase
    .from('event_ride_groups').select('*').eq('ride_day', day).in('event_id', eventIds)
  if (error) throw error
  return (data ?? []) as EventRideGroup[]
}

/** event_id → group_id for the rows given. */
export function groupIdByEvent(rows: EventRideGroup[]): Map<string, string> {
  return new Map(rows.map(r => [r.event_id, r.group_id]))
}

/**
 * The day's runs, in the order the events were given: one entry per ride group
 * plus one per ungrouped event. A group's position is that of its first member.
 * Pure — the shape the planner consumes.
 */
export function buildRuns(
  eventIds: string[],
  groups: Map<string, string>,
): Array<{ key: string; eventIds: string[] }> {
  const out: Array<{ key: string; eventIds: string[] }> = []
  const at = new Map<string, number>()
  for (const id of eventIds) {
    const gid = groups.get(id)
    const key = gid ? `group:${gid}` : `event:${id}`
    const seen = at.get(key)
    if (seen === undefined) {
      at.set(key, out.length)
      out.push({ key, eventIds: [id] })
    } else {
      out[seen].eventIds.push(id)
    }
  }
  return out
}

/**
 * Titles of the events that share a run with this one, on any day — for the
 * event's own pages, which know nothing about the day view's grouping. Empty
 * when the event travels alone. Reads events directly (staff+admin surfaces
 * only, matching the table's RLS).
 */
export async function fetchRidePartnerTitles(eventId: string): Promise<string[]> {
  const { data: mine } = await supabase
    .from('event_ride_groups').select('ride_day, group_id').eq('event_id', eventId)
  if (!mine?.length) return []
  const { data: peers } = await supabase
    .from('event_ride_groups')
    .select('event_id, ride_day, group_id')
    .in('group_id', [...new Set(mine.map(r => r.group_id))])
  const peerIds = [...new Set((peers ?? [])
    .filter(p => p.event_id !== eventId)
    .map(p => p.event_id))]
  if (!peerIds.length) return []
  const { data: events } = await supabase
    .from('events').select('id, calendar_title, display_title, admin_title').in('id', peerIds)
  return (events ?? []).map(e => e.calendar_title || e.display_title || e.admin_title || e.id)
}

/**
 * Put `eventId` on the same run as `withEventId`. Joins that event's existing
 * group, or starts a new one carrying them both. Upserting on the (ride_day,
 * event_id) primary key means moving an event between runs needs no delete.
 */
export async function shareRideWith(args: {
  day: string
  eventId: string
  withEventId: string
  rows: EventRideGroup[]
  createdBy: string | null
}): Promise<void> {
  const existing = args.rows.find(r => r.event_id === args.withEventId)?.group_id
  const groupId = existing ?? crypto.randomUUID()
  const inserts: EventRideGroupInsert[] = [
    { ride_day: args.day, event_id: args.eventId, group_id: groupId, created_by: args.createdBy },
  ]
  if (!existing) {
    inserts.push({ ride_day: args.day, event_id: args.withEventId, group_id: groupId, created_by: args.createdBy })
  }
  const { error } = await supabase
    .from('event_ride_groups').upsert(inserts, { onConflict: 'ride_day,event_id' })
  if (error) throw error
}

/**
 * Take `eventId` off its run. A group left with one member is deleted too — a
 * lone member is riding alone, and leaving the row behind would make the next
 * "rides with" pick look like it joined a run that doesn't exist.
 */
export async function rideAlone(args: {
  day: string
  eventId: string
  rows: EventRideGroup[]
}): Promise<void> {
  const mine = args.rows.find(r => r.event_id === args.eventId)
  if (!mine) return
  const leftovers = args.rows.filter(r => r.group_id === mine.group_id && r.event_id !== args.eventId)
  const drop = [args.eventId, ...(leftovers.length === 1 ? [leftovers[0].event_id] : [])]
  const { error } = await supabase
    .from('event_ride_groups').delete().eq('ride_day', args.day).in('event_id', drop)
  if (error) throw error
}
