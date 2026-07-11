import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { EventForm } from '../../components/admin/EventForm'
import { EventCarAssignment } from '../../components/admin/EventCarAssignment'
import { EventWaiverOverrides } from '../../components/admin/EventWaiverOverrides'
import {
  eventPayloadFromForm,
  formStateFromEvent,
  type FormState,
} from '../../components/admin/event-form-state'
import type { EventRow } from '../../types/database'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { notifyEventScheduleChanged } from '../../lib/reschedule'
import { fetchEventRelations, saveEventRelations } from '../../lib/event-relations'
import { t } from '../../i18n'

const ev = t.admin.events

// Normalize a day list (sort + dedupe + drop blanks) for comparison.
function normDays(days: string[]): string[] {
  return [...new Set(days.filter(Boolean))].sort()
}

// Whether the edit changed the event's date(s) — the trigger for notifying
// registered divers. Courses compare their day list; dives compare the
// start/end envelope.
function datesChanged(before: FormState, after: FormState): boolean {
  if (after.type === 'course') {
    const a = normDays(before.courseDays)
    const b = normDays(after.courseDays)
    return a.length !== b.length || a.some((d, i) => d !== b[i])
  }
  return before.start_date !== after.start_date || (before.end_date || '') !== (after.end_date || '')
}

// Edit page — load the existing dive/course row, hand the prefilled
// FormState to the shared EventForm, and on submit call .update().eq()
// against the same row. Mirrors AdminNewEventPage's structure: thin
// wrapper, all field rendering lives in the shared component.
export function AdminEditEventPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { profile } = useAuth()
  const [initial, setInitial] = useState<FormState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .eq('id', id)
          .maybeSingle()
        if (error) throw error
        if (!data) throw new Error(ev.eventNotFound)
        const rels = await fetchEventRelations(id)
        if (!cancelled) setInitial(formStateFromEvent(data as EventRow, rels))
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      }
    })()
    return () => { cancelled = true }
  }, [id])

  async function handleSubmit(form: FormState) {
    if (!id) throw new Error(ev.missingEventId)
    // Capture before the update so we can notify registrants if the dates
    // moved. `initial` is the loaded row's FormState, untouched by editing.
    const dateChange = !!initial && datesChanged(initial, form)
    const { error } = await supabase
      .from('events')
      .update(eventPayloadFromForm(form) as never)
      .eq('id', id)
    if (error) throw error
    const relError = await saveEventRelations(id, form)
    if (relError) throw relError
    if (dateChange) notifyEventScheduleChanged(id, form.type).catch(() => { /* best-effort */ })
    toast.success(form.type === 'dive' ? ev.diveUpdated : ev.courseUpdated)
    navigate(`/admin/events/${id}`)
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-3">{loadError}</p>
      </div>
    )
  }

  if (!initial) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-sm text-white/70">{ev.loadingEvent}</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">{ev.editEvent}</h1>
      <EventForm
        mode="edit"
        initial={initial}
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/admin/events/${id}`)}
      />
      {initial.type === 'dive' && id && (
        <div className="mt-6 space-y-2">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">{ev.carsHeading}</h2>
          <p className="text-xs text-white/60">{ev.carsBlurb}</p>
          <EventCarAssignment event={{ id, type: 'dive' }} isAdmin createdBy={profile?.id ?? null} />
        </div>
      )}
      {id && (
        <div className="mt-6">
          <EventWaiverOverrides
            event={{ id, type: initial.type, title: initial.display_title || initial.admin_title || initial.course_name || '' }}
            isAdmin
            createdBy={profile?.id ?? null}
          />
        </div>
      )}
    </div>
  )
}
