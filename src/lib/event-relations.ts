import { supabase } from './supabase'
import type { EventRelations } from '../components/admin/event-form-state'

// An event's related catalog ids live in the junction tables (event_rooms,
// event_addons, event_destinations) — the single source of truth. These helpers
// load them for editing/preload and write them back transactionally via the
// set_event_relations RPC. Courses simply carry no rooms/destinations.

/** Load an event's room / add-on / destination ids from the junction tables. */
export async function fetchEventRelations(id: string): Promise<EventRelations> {
  const [rooms, addons, dests] = await Promise.all([
    supabase.from('event_rooms').select('room_id').eq('event_id', id),
    supabase.from('event_addons').select('addon_id').eq('event_id', id),
    supabase.from('event_destinations').select('destination_id').eq('event_id', id),
  ])
  return {
    roomIds: (rooms.data ?? []).map(r => r.room_id),
    addonIds: (addons.data ?? []).map(r => r.addon_id),
    destinationIds: (dests.data ?? []).map(r => r.destination_id),
  }
}

/**
 * Reconcile an event's junction rows to `rels` in one transaction. Call after
 * the events row insert/update succeeds. Returns the RPC error (if any).
 */
export async function saveEventRelations(id: string, rels: EventRelations) {
  const { error } = await supabase.rpc('set_event_relations', {
    p_event_id: id,
    p_room_ids: rels.roomIds,
    p_addon_ids: rels.addonIds,
    p_destination_ids: rels.destinationIds,
  })
  return error
}
