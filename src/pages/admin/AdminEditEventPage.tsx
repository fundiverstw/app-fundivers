import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { EventForm } from '../../components/admin/EventForm'
import { EventCarAssignment } from '../../components/admin/EventCarAssignment'
import { EventWaiverOverrides } from '../../components/admin/EventWaiverOverrides'
import { moveDiveCarAllocations } from '../../lib/event-vehicles'
import {
  divePayloadFromForm,
  coursePayloadFromForm,
  formStateFromDive,
  formStateFromCourse,
  type FormState,
} from '../../components/admin/event-form-state'
import type { EOCourse, EODive } from '../../types/database'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { notifyEventScheduleChanged } from '../../lib/reschedule'

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
  const { type, id } = useParams<{ type: 'dive' | 'course'; id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { profile } = useAuth()
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
        if (!cancelled) setLoadError(errorMessage(err))
      }
    })()
    return () => { cancelled = true }
  }, [type, id])

  async function handleSubmit(form: FormState) {
    if (!id) throw new Error('Missing event id.')
    // Capture before the update so we can notify registrants if the dates
    // moved. `initial` is the loaded row's FormState, untouched by editing.
    const dateChange = !!initial && datesChanged(initial, form)
    if (form.type === 'dive') {
      const { error } = await supabase
        .from('EO_dives')
        .update(divePayloadFromForm(form) as never)
        .eq('_id', id)
      if (error) throw error
      if (dateChange) notifyEventScheduleChanged(id, 'dive').catch(() => { /* best-effort */ })
      // Car allocations are keyed by the dive's start_date — carry them to the
      // new day when it moves so they don't strand on the old date.
      if (initial && initial.start_date !== form.start_date && initial.start_date && form.start_date) {
        try {
          const { moved, dropped } = await moveDiveCarAllocations(id, initial.start_date, form.start_date)
          if (dropped > 0) toast.info(`Moved ${moved} car${moved === 1 ? '' : 's'} to the new date; ${dropped} couldn't move (already booked elsewhere that day) and were unassigned.`)
          else if (moved > 0) toast.success(`Moved ${moved} assigned car${moved === 1 ? '' : 's'} to the new date.`)
        } catch { toast.error('The dive date changed but its car assignments could not be moved — check them on the Transportation tab.') }
      }
      toast.success('Dive updated')
      navigate(`/admin/events/dive/${id}`)
    } else {
      const { error } = await supabase
        .from('EO_courses')
        .update(coursePayloadFromForm(form) as never)
        .eq('_id', id)
      if (error) throw error
      if (dateChange) notifyEventScheduleChanged(id, 'course').catch(() => { /* best-effort */ })
      toast.success('Course updated')
      navigate(`/admin/events/course/${id}`)
    }
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
      {type === 'dive' && id && (
        <div className="mt-6 space-y-2">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Cars for this dive</h2>
          <p className="text-xs text-white/60">
            Allocations are tied to the dive's start date and feed the ride-seat limit on the
            registration form. Changing the date above moves them to the new day on save.
          </p>
          <EventCarAssignment eventId={id} isAdmin createdBy={profile?.id ?? null} />
        </div>
      )}
      {id && type && (
        <div className="mt-6">
          <EventWaiverOverrides
            event={{ id, type, title: initial.display_title || initial.admin_title || initial.course_name || '' }}
            isAdmin
            createdBy={profile?.id ?? null}
          />
        </div>
      )}
    </div>
  )
}
