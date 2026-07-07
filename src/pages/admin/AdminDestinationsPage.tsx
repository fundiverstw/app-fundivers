import { CatalogManager, type CatalogField } from '../../components/admin/CatalogManager'
import type { TravelDestination } from '../../types/database'

// The dive-location catalog (Green Island, Palau, Kenting…). Dives link to
// these via the event_destinations junction (the EventForm "Destinations"
// picker). `divetype` drives the calendar's local-vs-trip colour bucket:
// only 'Shore Diving' destinations colour a dive local (green) — see
// src/lib/event-colors.ts.
const fields: CatalogField<TravelDestination>[] = [
  { key: 'admin_title',        label: 'Admin title', type: 'text', required: true, placeholder: 'e.g. Green Island' },
  { key: 'country',            label: 'Country', type: 'text', placeholder: 'e.g. Taiwan' },
  { key: 'divetype',           label: 'Dive type', type: 'text', placeholder: "'Shore Diving' = local (green); anything else = trip (yellow)" },
  { key: 'international',       label: 'International', type: 'boolean' },
  { key: 'tagline',            label: 'Tagline', type: 'textarea', placeholder: 'Short one-line hook…' },
  { key: 'diver_requirements', label: 'Diver requirements', type: 'textarea', placeholder: 'Certification level, experience…' },
  { key: 'sort_order',         label: 'Sort order', type: 'number', placeholder: 'Lower shows first' },
  { key: 'slug',               label: 'Slug', type: 'text', placeholder: 'URL slug used by the public site' },
  { key: 'location_picture',   label: 'Location picture (URL)', type: 'text', placeholder: 'wix:image://… or https://…' },
  { key: 'background_picture', label: 'Background picture (URL)', type: 'text', placeholder: 'wix:image://… or https://…' },
]

export function AdminDestinationsPage() {
  return (
    <CatalogManager<TravelDestination>
      title="Destinations"
      table="travel_destinations"
      noun="destination"
      orderBy="sort_order"
      fields={fields}
      rowLabel={r => r.admin_title || r.country || r.id}
      rowDetail={r => [r.country, r.divetype].filter(Boolean).join(' · ') || null}
    />
  )
}
