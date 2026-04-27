import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { EventForm } from '../../components/admin/EventForm'
import {
  divePayloadFromForm,
  coursePayloadFromForm,
  formStateFromDive,
  formStateFromCourse,
  type FormState,
} from '../../components/admin/event-form-state'
import type { EOCourse, EODive } from '../../types/database'

// Edit page — load the existing dive/course row, hand the prefilled
// FormState to the shared EventForm, and on submit call .update().eq()
// against the same row. Mirrors AdminNewEventPage's structure: thin
// wrapper, all field rendering lives in the shared component.
export function AdminEditEventPage() {
  const { type, id } = useParams<{ type: 'dive' | 'course'; id: string }>()
  const navigate = useNavigate()
  const [initial, setInitial] = useState<FormState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!type || !id) return
    let cancelled = false
    ;(async () => {
      try {
        if (type === 'dive') {
          const { data, error } = await supabase
            .from('EO_dives')
            .select('*')
            .eq('_id', id)
            .maybeSingle()
          if (error) throw error
          if (!data) throw new Error('Dive not found.')
          if (!cancelled) setInitial(formStateFromDive(data as EODive))
        } else if (type === 'course') {
          const { data, error } = await supabase
            .from('EO_courses')
            .select('*')
            .eq('_id', id)
            .maybeSingle()
          if (error) throw error
          if (!data) throw new Error('Course not found.')
          if (!cancelled) setInitial(formStateFromCourse(data as EOCourse))
        } else {
          throw new Error(`Unknown event type: ${type}`)
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => { cancelled = true }
  }, [type, id])

  async function handleSubmit(form: FormState) {
    if (!id) throw new Error('Missing event id.')
    if (form.type === 'dive') {
      const { error } = await supabase
        .from('EO_dives')
        .update(divePayloadFromForm(form) as never)
        .eq('_id', id)
      if (error) throw error
      navigate(`/admin/events/dive/${id}`)
    } else {
      const { error } = await supabase
        .from('EO_courses')
        .update(coursePayloadFromForm(form) as never)
        .eq('_id', id)
      if (error) throw error
      navigate(`/admin/events/course/${id}`)
    }
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-sm text-red-200 bg-red-900/50 border border-red-500 rounded-md p-3">{loadError}</p>
      </div>
    )
  }

  if (!initial) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-sm text-white/70">Loading event…</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">Edit event</h1>
      <EventForm
        mode="edit"
        initial={initial}
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/admin/events/${type}/${id}`)}
      />
    </div>
  )
}
