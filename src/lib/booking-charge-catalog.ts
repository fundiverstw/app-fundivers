import { supabase } from './supabase'
import type { BookingDetails } from '../types/database'

export interface ChargeCatalog {
  roomPrices: Map<string, { label: string; amount: number }>
  addonPrices: Map<string, { label: string; amount: number }>
}

interface RoomRow { _id: string; display_title: string | null; admin_title: string | null; added_price: number | null }
interface AddonRow { _id: string; display_title: string | null; admin_title: string | null; price: number | null }

/**
 * Fetch current room / add-on prices for the ids referenced by a batch of
 * booking details. Only needed to recompute an itemized breakdown for bookings
 * created before details.charges was snapshotted (see resolveCharges); newer
 * bookings carry their own frozen lines and ignore these maps. Returns empty
 * maps when nothing is referenced, so callers can pass it through unconditionally.
 */
export async function fetchChargeCatalog(
  detailsList: Array<BookingDetails | null | undefined>,
): Promise<ChargeCatalog> {
  const roomIds = [...new Set(detailsList.map(d => d?.room?.option_id).filter((x): x is string => !!x))]
  const addonIds = [...new Set(detailsList.flatMap(d => d?.add_ons ?? []).filter((x): x is string => !!x))]

  const [roomRes, addonRes] = await Promise.all([
    roomIds.length
      ? supabase.from('EO_rooms').select('_id, display_title, admin_title, added_price').in('_id', roomIds)
      : Promise.resolve({ data: [] as RoomRow[] }),
    addonIds.length
      ? supabase.from('Other_Addons').select('_id, display_title, admin_title, price').in('_id', addonIds)
      : Promise.resolve({ data: [] as AddonRow[] }),
  ])

  const roomPrices = new Map(
    ((roomRes.data ?? []) as RoomRow[]).map(r => [r._id, { label: r.display_title || r.admin_title || r._id, amount: r.added_price ?? 0 }]),
  )
  const addonPrices = new Map(
    ((addonRes.data ?? []) as AddonRow[]).map(a => [a._id, { label: a.display_title || a.admin_title || a._id, amount: a.price ?? 0 }]),
  )
  return { roomPrices, addonPrices }
}
