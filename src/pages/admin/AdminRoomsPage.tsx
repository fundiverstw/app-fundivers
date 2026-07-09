import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'
import type { EORoom } from '../../types/database'

const c = t.admin.catalog
const fields: CatalogField<EORoom>[] = [
  { key: 'display_title', label: c.displayTitle, type: 'text', required: true, placeholder: c.rooms.displayTitlePh },
  { key: 'admin_title',   label: c.adminTitle,   type: 'text', placeholder: c.rooms.adminTitlePh },
  { key: 'added_price',  label: c.rooms.addedPrice(siteConfig.locale.currencyLabel), type: 'number', placeholder: c.rooms.zeroPh },
  { key: 'currency',     label: c.currency, type: 'text', placeholder: siteConfig.locale.currency },
]

export function AdminRoomsPage() {
  return (
    <CatalogManager<EORoom>
      title={c.rooms.title}
      table="rooms"
      noun={c.rooms.noun}
      orderBy="admin_title"
      fields={fields}
      rowLabel={r => r.admin_title || r.display_title || r.id}
      rowDetail={r => r.added_price != null ? `+${r.added_price.toLocaleString()} ${r.currency || siteConfig.locale.currency}` : null}
    />
  )
}
