import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import type { EOPrice } from '../../types/database'

// EO_prices CRUD. Skips room_options (multi-FK; admins still manage that
// from the inline price-tier sub-form on the new/edit event page).
const fields: CatalogField<EOPrice>[] = [
  { key: 'admin_title',    label: 'Admin title',    type: 'text',   required: true, placeholder: 'e.g. Standard fun dive' },
  { key: 'starting_at',    label: 'Starting at',    type: 'number', placeholder: 'Total price (NTD)' },
  { key: 'deposit_amount', label: 'Deposit',        type: 'number', placeholder: 'Deposit amount (NTD)' },
  { key: 'transport',      label: 'Transport',      type: 'number', placeholder: 'NTD — leave blank or 0 if included in base' },
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
        if (r.starting_at != null)    parts.push(`total: ${r.starting_at} NTD`)
        if (r.deposit_amount != null) parts.push(`deposit: ${r.deposit_amount} NTD`)
        if (r.transport != null && r.transport > 0) parts.push(`transport: +${r.transport} NTD`)
        else                                         parts.push('transport: included')
        return parts.join(' · ')
      }}
    />
  )
}
