import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import type { EORoom } from '../../types/database'

const fields: CatalogField<EORoom>[] = [
  { key: 'display_name', label: 'Display name', type: 'text', required: true, placeholder: 'e.g. Twin Sea-View' },
  { key: 'title',        label: 'Internal title', type: 'text', placeholder: 'e.g. twin' },
  { key: 'added_price',  label: 'Added price (TWD)', type: 'number', placeholder: '0' },
  { key: 'currency',     label: 'Currency', type: 'text', placeholder: 'TWD' },
]

export function AdminRoomsPage() {
  return (
    <CatalogManager<EORoom>
      title="Room options"
      table="EO_rooms"
      noun="room option"
      orderBy="display_name"
      fields={fields}
      rowLabel={r => r.display_name || r.title || r._id}
      rowDetail={r => r.added_price != null ? `+${r.added_price.toLocaleString()} ${r.currency || 'TWD'}` : null}
    />
  )
}
