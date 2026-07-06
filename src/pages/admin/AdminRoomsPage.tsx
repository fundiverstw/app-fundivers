import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import { siteConfig } from '../../config/site'
import type { EORoom } from '../../types/database'

const fields: CatalogField<EORoom>[] = [
  { key: 'display_title', label: 'Display title', type: 'text', required: true, placeholder: 'e.g. Twin Sea-View' },
  { key: 'admin_title',   label: 'Admin title',   type: 'text', placeholder: 'e.g. twin' },
  { key: 'added_price',  label: `Added price (${siteConfig.locale.currencyLabel})`, type: 'number', placeholder: '0' },
  { key: 'currency',     label: 'Currency', type: 'text', placeholder: siteConfig.locale.currency },
]

export function AdminRoomsPage() {
  return (
    <CatalogManager<EORoom>
      title="Room options"
      table="rooms"
      noun="room option"
      orderBy="display_title"
      fields={fields}
      rowLabel={r => r.display_title || r.admin_title || r.id}
      rowDetail={r => r.added_price != null ? `+${r.added_price.toLocaleString()} ${r.currency || siteConfig.locale.currency}` : null}
    />
  )
}
