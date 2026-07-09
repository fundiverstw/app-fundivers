import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import { t } from '../../i18n'
import type { TravelDestination } from '../../types/database'

const c = t.admin.catalog
const d = c.destinations

// The dive-location catalog (Green Island, Palau, Kenting…). Dives link to
// these via the event_destinations junction (the EventForm "Destinations"
// picker). `divetype` drives the calendar's local-vs-trip colour bucket:
// only 'Shore Diving' destinations colour a dive local (green) — see
// src/lib/event-colors.ts.
const fields: CatalogField<TravelDestination>[] = [
  { key: 'admin_title',        label: c.adminTitle, type: 'text', required: true, placeholder: d.adminTitlePh },
  { key: 'country',            label: d.country, type: 'text', placeholder: d.countryPh },
  { key: 'divetype',           label: d.diveType, type: 'text', placeholder: d.diveTypePh },
  { key: 'international',       label: d.international, type: 'boolean' },
  { key: 'tagline',            label: d.tagline, type: 'textarea', placeholder: d.taglinePh },
  { key: 'diver_requirements', label: d.diverRequirements, type: 'textarea', placeholder: d.diverRequirementsPh },
  { key: 'sort_order',         label: d.sortOrder, type: 'number', placeholder: d.sortOrderPh },
  { key: 'slug',               label: d.slug, type: 'text', placeholder: d.slugPh },
  { key: 'location_picture',   label: d.locationPicture, type: 'text', placeholder: d.picturePh },
  { key: 'background_picture', label: d.backgroundPicture, type: 'text', placeholder: d.picturePh },
]

export function AdminDestinationsPage() {
  return (
    <CatalogManager<TravelDestination>
      title={d.title}
      table="travel_destinations"
      noun={d.noun}
      orderBy="sort_order"
      fields={fields}
      rowLabel={r => r.admin_title || r.country || r.id}
      rowDetail={r => [r.country, r.divetype].filter(Boolean).join(' · ') || null}
    />
  )
}
