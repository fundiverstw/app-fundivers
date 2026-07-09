import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'
import type { EOPrice } from '../../types/database'

const CUR = siteConfig.locale.currencyLabel
const c = t.admin.catalog

// prices CRUD. Skips room_options (multi-FK; admins still manage that
// from the inline price-tier sub-form on the new/edit event page).
const fields: CatalogField<EOPrice>[] = [
  { key: 'admin_title',    label: c.adminTitle,       type: 'text',   required: true, placeholder: c.prices.adminTitlePh },
  { key: 'starting_at',    label: c.prices.startingAt, type: 'number', placeholder: c.prices.startingAtPh(CUR) },
  { key: 'deposit_amount', label: c.prices.deposit,    type: 'number', placeholder: c.prices.depositPh(CUR) },
  { key: 'transport',      label: c.prices.transport,  type: 'number', placeholder: c.prices.transportPh(CUR) },
]

export function AdminPricesPage() {
  return (
    <CatalogManager<EOPrice>
      title={c.prices.title}
      table="prices"
      noun={c.prices.noun}
      orderBy="admin_title"
      fields={fields}
      rowLabel={r => r.admin_title || r.id}
      rowDetail={r => {
        const parts: string[] = []
        if (r.starting_at != null)    parts.push(`total: ${r.starting_at} ${CUR}`)
        if (r.deposit_amount != null) parts.push(`deposit: ${r.deposit_amount} ${CUR}`)
        if (r.transport != null && r.transport > 0) parts.push(`transport: +${r.transport} ${CUR}`)
        else                                         parts.push('transport: included')
        return parts.join(' · ')
      }}
    />
  )
}
