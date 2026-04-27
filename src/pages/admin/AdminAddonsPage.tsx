import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import type { EOAddon } from '../../types/database'

const fields: CatalogField<EOAddon>[] = [
  { key: 'display_name', label: 'Display name', type: 'text', required: true, placeholder: 'e.g. SMB Rental' },
  { key: 'title',        label: 'Internal title', type: 'text', placeholder: 'e.g. smb' },
  { key: 'price',        label: 'Price (TWD)', type: 'number', placeholder: '0' },
  { key: 'currency',     label: 'Currency', type: 'text', placeholder: 'TWD' },
]

export function AdminAddonsPage() {
  return (
    <CatalogManager<EOAddon>
      title="Add-ons"
      table="Other_Addons"
      noun="add-on"
      orderBy="display_name"
      fields={fields}
      rowLabel={r => r.display_name || r.title || r._id}
      rowDetail={r => r.price != null ? `${r.price.toLocaleString()} ${r.currency || 'TWD'}` : null}
    />
  )
}
