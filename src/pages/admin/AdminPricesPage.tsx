import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import { siteConfig } from '../../config/site'
import type { EOPrice } from '../../types/database'

const CUR = siteConfig.locale.currencyLabel

// EO_prices CRUD. Skips room_options (multi-FK; admins still manage that
// from the inline price-tier sub-form on the new/edit event page).
const fields: CatalogField<EOPrice>[] = [
  { key: 'admin_title',    label: 'Admin title',    type: 'text',   required: true, placeholder: 'e.g. Standard fun dive' },
  { key: 'starting_at',    label: 'Starting at',    type: 'number', placeholder: `Total price (${CUR})` },
  { key: 'deposit_amount', label: 'Deposit',        type: 'number', placeholder: `Deposit amount (${CUR})` },
  { key: 'transport',      label: 'Transport',      type: 'number', placeholder: `${CUR} — leave blank or 0 if included in base` },
]

export function AdminPricesPage() {
  return (
    <CatalogManager<EOPrice>
      title="Price tiers"
      table="EO_prices"
      noun="price tier"
      orderBy="admin_title"
      fields={fields}
      rowLabel={r => r.admin_title || r._id}
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
