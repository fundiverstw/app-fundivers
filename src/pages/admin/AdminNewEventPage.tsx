import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EVENT_KIND_LABELS } from '../../lib/event-kind-labels'
import { EventForm } from '../../components/admin/EventForm'
import { CreateEventVehiclePicker } from '../../components/admin/CreateEventVehiclePicker'
import { RecurrenceFields } from '../../components/admin/RecurrenceFields'
import { createEvents, seriesAnchor } from '../../lib/event-series'
import type { RecurrenceRule } from '../../lib/recurrence'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import type { FormState } from '../../components/admin/event-form-state'
import { t } from '../../i18n'

const ev = t.admin.events

// Thin wrapper: defer all field rendering to the shared EventForm, and hand the
// validated form to createEvents — one RPC that writes the event (or the whole
// recurrence batch), its room / add-on / destination junctions, its cars and the
// series row in a single transaction.
//
// The occurrences are ordinary events afterwards; the only thing marking them as
// a batch is series_id.
export function AdminNewEventPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile } = useAuth()
  // Cars picked in the form; assigned to every event the submit creates.
  const [vehicleIds, setVehicleIds] = useState<string[]>([])
  const [rule, setRule] = useState<RecurrenceRule | null>(null)
  const [seriesLabel, setSeriesLabel] = useState('')

  async function handleSubmit(form: FormState) {
    const repeating = !!rule && !!seriesAnchor(form)
    let eventIds: string[]
    try {
      const result = await createEvents({
        form,
        rule: repeating ? rule : null,
        label: seriesLabel,
        vehicleIds,
        createdBy: profile?.id ?? null,
      })
      eventIds = result.eventIds
    } catch (err) {
      // Rethrown as an authored message so EventForm shows it inline rather than
      // the raw PostgREST text. Nothing was created — the RPC is one transaction.
      throw new Error(
        repeating
          ? t.admin.recurrence.createFailed(errorMessage(err))
          : errorMessage(err),
        { cause: err },
      )
    }

    toast.success(
      repeating
        ? t.admin.recurrence.created(eventIds.length)
        : ev.created(EVENT_KIND_LABELS[form.type]),
    )
    // Land on the first occurrence: it is the event the admin just filled in,
    // and its Series section lists the rest.
    navigate(`/admin/events/${eventIds[0]}`)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">{ev.newEvent}</h1>
      <EventForm
        mode="create"
        onSubmit={handleSubmit}
        onCancel={() => navigate('/admin/events')}
        renderCreateExtras={form => (
          <>
            <CreateEventVehiclePicker onChange={setVehicleIds} />
            <RecurrenceFields
              anchor={seriesAnchor(form)}
              onChange={(next, label) => { setRule(next); setSeriesLabel(label) }}
            />
          </>
        )}
      />
    </div>
  )
}
