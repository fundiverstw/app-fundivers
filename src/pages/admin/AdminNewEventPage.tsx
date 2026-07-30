import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { EVENT_KIND_LABELS } from '../../lib/event-kind-labels'
import { EventForm } from '../../components/admin/EventForm'
import { CreateEventVehiclePicker } from '../../components/admin/CreateEventVehiclePicker'
import { RecurrenceFields } from '../../components/admin/RecurrenceFields'
import { assignVehiclesToEvent } from '../../lib/event-vehicles'
import { createEventSeries, seriesAnchor } from '../../lib/event-series'
import type { RecurrenceRule } from '../../lib/recurrence'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import {
  eventPayloadFromForm,
  type FormState,
} from '../../components/admin/event-form-state'
import { saveEventRelations } from '../../lib/event-relations'
import { t } from '../../i18n'

const ev = t.admin.events

// Thin wrapper: defer all field rendering to the shared EventForm and
// handle the create-side persistence (insert a new events row, write its
// room/add-on/destination junctions, then redirect to its admin detail page).
//
// With a recurrence rule set, the same form produces a whole batch instead —
// see lib/event-series.ts. The occurrences are ordinary events afterwards; the
// only thing that marks them as a batch is series_id.
export function AdminNewEventPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile } = useAuth()
  // Cars picked in the form; assigned to the event right after it's inserted.
  const [vehicleIds, setVehicleIds] = useState<string[]>([])
  const [rule, setRule] = useState<RecurrenceRule | null>(null)
  const [seriesLabel, setSeriesLabel] = useState('')

  async function assignCars(eventId: string, type: FormState['type']) {
    if (vehicleIds.length === 0) return
    await assignVehiclesToEvent({
      vehicleIds, event: { id: eventId, type }, createdBy: profile?.id ?? null,
    })
  }

  async function createSeries(form: FormState) {
    const result = await createEventSeries({
      form, rule: rule!, createdBy: profile?.id ?? null, label: seriesLabel,
      assignVehicles: assignCars,
    })
    toast.success(t.admin.recurrence.created(result.eventIds.length))
    if (result.relationFailures.length > 0) {
      toast.error(t.admin.recurrence.relationsIncomplete(result.relationFailures.length))
    }
    // Land on the first occurrence: it is the event the admin just filled in,
    // and its Series section lists the rest.
    navigate(`/admin/events/${result.eventIds[0]}`)
  }

  async function createOne(form: FormState) {
    const id = crypto.randomUUID()
    const { error } = await supabase
      .from('events')
      .insert({ id, ...eventPayloadFromForm(form) } as never)
    if (error) throw error
    const relError = await saveEventRelations(id, form)
    if (relError) throw relError
    // Cars are assigned to the event as a whole (event-level allocation).
    try { await assignCars(id, form.type) } catch { toast.error(ev.carAssignFailed) }
    toast.success(ev.created(EVENT_KIND_LABELS[form.type]))
    navigate(`/admin/events/${id}`)
  }

  async function handleSubmit(form: FormState) {
    if (rule && seriesAnchor(form)) {
      try {
        await createSeries(form)
      } catch (err) {
        // Rethrown as an authored message so EventForm shows it inline rather
        // than the raw PostgREST text.
        throw new Error(t.admin.recurrence.createFailed(errorMessage(err)), { cause: err })
      }
      return
    }
    await createOne(form)
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
