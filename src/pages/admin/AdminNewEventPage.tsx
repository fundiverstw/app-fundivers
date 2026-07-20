import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { EVENT_KIND_LABELS } from '../../lib/event-kind-labels'
import { EventForm } from '../../components/admin/EventForm'
import { CreateEventVehiclePicker } from '../../components/admin/CreateEventVehiclePicker'
import { assignVehiclesToEvent } from '../../lib/event-vehicles'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
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
export function AdminNewEventPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile } = useAuth()
  // Cars picked in the form; assigned to the event right after it's inserted.
  const [vehicleIds, setVehicleIds] = useState<string[]>([])

  async function handleSubmit(form: FormState) {
    const id = crypto.randomUUID()
    const { error } = await supabase
      .from('events')
      .insert({ id, ...eventPayloadFromForm(form) } as never)
    if (error) throw error
    const relError = await saveEventRelations(id, form)
    if (relError) throw relError
    // Cars are assigned to the event as a whole (event-level allocation).
    if (vehicleIds.length > 0) {
      try {
        await assignVehiclesToEvent({
          vehicleIds, event: { id, type: form.type }, createdBy: profile?.id ?? null,
        })
      } catch { toast.error(ev.carAssignFailed) }
    }
    toast.success(ev.created(EVENT_KIND_LABELS[form.type]))
    navigate(`/admin/events/${id}`)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">{ev.newEvent}</h1>
      <EventForm
        mode="create"
        onSubmit={handleSubmit}
        onCancel={() => navigate('/admin/events')}
        renderCreateExtras={() => <CreateEventVehiclePicker onChange={setVehicleIds} />}
      />
    </div>
  )
}
