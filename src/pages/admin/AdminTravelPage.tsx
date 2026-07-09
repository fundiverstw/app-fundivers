import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import { t } from '../../i18n'
import type { TripTemplateEntry } from '../../types/database'

const c = t.admin.catalog
const tr = c.travel
const fields: CatalogField<TripTemplateEntry>[] = [
  { key: 'admin_title',    label: c.adminTitle, type: 'text', required: true, placeholder: tr.adminTitlePh },
  { key: 'tagline_text',   label: tr.tagline,  type: 'textarea', placeholder: tr.taglinePh },
  { key: 'included',       label: tr.included, type: 'textarea', placeholder: tr.includedPh },
  { key: 'not_included',   label: tr.notIncluded, type: 'textarea', placeholder: tr.notIncludedPh },
  { key: 'transportation', label: tr.transportation, type: 'textarea', placeholder: tr.transportationPh },
  { key: 'itinerary',      label: tr.itinerary, type: 'textarea', placeholder: tr.itineraryPh },
  { key: 'prerequisites',  label: tr.prerequisites, type: 'textarea', placeholder: tr.prerequisitesPh },
]

export function AdminTravelPage() {
  return (
    <CatalogManager<TripTemplateEntry>
      title={tr.title}
      table="trip_templates"
      noun={tr.noun}
      orderBy="admin_title"
      fields={fields}
      rowLabel={r => r.admin_title || r.id}
    />
  )
}
