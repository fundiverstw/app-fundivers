import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import type { DiveTravelEntry } from '../../types/database'

const fields: CatalogField<DiveTravelEntry>[] = [
  { key: 'admin_title',    label: 'Admin title', type: 'text', required: true, placeholder: 'e.g. Green Island' },
  { key: 'included',       label: 'Included', type: 'textarea', placeholder: 'What the price includes…' },
  { key: 'not_included',   label: 'Not included', type: 'textarea', placeholder: 'What the price does NOT include…' },
  { key: 'transportation', label: 'Transportation', type: 'textarea', placeholder: 'How divers reach the site…' },
]

export function AdminTravelPage() {
  return (
    <CatalogManager<DiveTravelEntry>
      title="DiveTravel"
      table="DiveTravel"
      noun="DiveTravel entry"
      orderBy="admin_title"
      fields={fields}
      rowLabel={r => r.admin_title || r._id}
    />
  )
}
