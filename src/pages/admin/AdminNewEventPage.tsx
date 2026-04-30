import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { EventForm } from '../../components/admin/EventForm'
import { useToast } from '../../hooks/useToast'
import {
  divePayloadFromForm,
  coursePayloadFromForm,
  type FormState,
} from '../../components/admin/event-form-state'

// Thin wrapper: defer all field rendering to the shared EventForm and
// handle the create-side persistence (insert a new EO_dive / EO_course
// row, then redirect to its admin detail page).
export function AdminNewEventPage() {
  const navigate = useNavigate()
  const toast = useToast()

  async function handleSubmit(form: FormState) {
    const id = crypto.randomUUID()
    if (form.type === 'dive') {
      const { error } = await supabase
        .from('EO_dives')
        .insert({ _id: id, ...divePayloadFromForm(form) } as never)
      if (error) throw error
      toast.success('Dive created')
      navigate(`/admin/events/dive/${id}`)
    } else {
      const { error } = await supabase
        .from('EO_courses')
        .insert({ _id: id, ...coursePayloadFromForm(form) } as never)
      if (error) throw error
      toast.success('Course created')
      navigate(`/admin/events/course/${id}`)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">New event</h1>
      <EventForm
        mode="create"
        onSubmit={handleSubmit}
        onCancel={() => navigate('/admin/events')}
      />
    </div>
  )
}
