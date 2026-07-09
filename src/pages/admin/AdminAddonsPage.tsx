import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'
import type { EOAddon } from '../../types/database'

const c = t.admin.catalog
const fields: CatalogField<EOAddon>[] = [
  { key: 'display_title', label: c.displayTitle, type: 'text', required: true, placeholder: c.addons.displayTitlePh },
  { key: 'admin_title',   label: c.adminTitle,   type: 'text', placeholder: c.addons.adminTitlePh },
  { key: 'price',        label: c.addons.price(siteConfig.locale.currencyLabel), type: 'number', placeholder: c.addons.zeroPh },
  { key: 'currency',     label: c.currency, type: 'text', placeholder: siteConfig.locale.currency },
]

export function AdminAddonsPage() {
  return (
    <CatalogManager<EOAddon>
      title={c.addons.title}
      table="addons"
      noun={c.addons.noun}
      orderBy="display_title"
      fields={fields}
      rowLabel={r => r.display_title || r.admin_title || r.id}
      rowDetail={r => r.price != null ? `${r.price.toLocaleString()} ${r.currency || siteConfig.locale.currency}` : null}
    />
  )
}
