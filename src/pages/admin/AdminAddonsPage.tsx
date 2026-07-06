import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import { siteConfig } from '../../config/site'
import type { EOAddon } from '../../types/database'

const fields: CatalogField<EOAddon>[] = [
  { key: 'display_title', label: 'Display title', type: 'text', required: true, placeholder: 'e.g. SMB Rental' },
  { key: 'admin_title',   label: 'Admin title',   type: 'text', placeholder: 'e.g. smb' },
  { key: 'price',        label: `Price (${siteConfig.locale.currencyLabel})`, type: 'number', placeholder: '0' },
  { key: 'currency',     label: 'Currency', type: 'text', placeholder: siteConfig.locale.currency },
]

export function AdminAddonsPage() {
  return (
    <CatalogManager<EOAddon>
      title="Add-ons"
      table="addons"
      noun="add-on"
      orderBy="display_title"
      fields={fields}
      rowLabel={r => r.display_title || r.admin_title || r.id}
      rowDetail={r => r.price != null ? `${r.price.toLocaleString()} ${r.currency || siteConfig.locale.currency}` : null}
    />
  )
}
