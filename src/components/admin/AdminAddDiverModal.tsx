import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { RegisterFormBody } from '../register/RegisterForm'
import type { AppEvent, Profile } from '../../types/database'
import { MODAL_BACKDROP, TEXT_HEADING, TEXT_BODY, INPUT } from '../../styles/tokens'

// Two-step "register a diver on behalf" modal:
//   1. pick which diver — search profiles by name / display name / contact
//   2. fill out the same RegisterFormBody the diver would see, but with
//      `actingOnBehalfOf` set so the booking lands on that user instead
//      of the admin's own id.
//
// Step 2 reuses the diver-side form unchanged (the modal lives at the
// admin level and just selects a target). The form invokes the
// create-registration edge function exactly as the diver would, so
// the same PDF + confirmation email is sent.
export function AdminAddDiverModal({
  event,
  onClose,
  onAdded,
}: {
  event: AppEvent
  onClose: () => void
  onAdded: () => void
}) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState<Profile | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setProfiles((data ?? []) as Profile[])
      })
    return () => { cancelled = true }
  }, [])

  const visible = profiles.filter(p => {
    if (!filter) return true
    const haystack = [p.full_name, p.display_name, p.name_alt, p.contact_id, p.phone]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(filter.toLowerCase())
  })

  return (
    <div
      className={`${MODAL_BACKDROP} flex items-start justify-center p-4 pt-8 overflow-y-auto`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-diver-title"
      onClick={onClose}
    >
      <div
        className="bg-white/80 backdrop-blur-md border border-red-500 rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 id="add-diver-title" className={`text-lg ${TEXT_HEADING}`}>
            {target ? `Register ${target.display_name ?? target.full_name}` : 'Add diver to event'}
          </h2>
          <button onClick={onClose} className="text-blue-900 font-medium text-xl leading-none" aria-label="Close">×</button>
        </header>

        {target ? (
          <>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="text-xs text-blue-900 hover:underline"
            >
              ‹ pick a different diver
            </button>
            <RegisterFormBody
              event={event}
              profile={target}
              userId={target.id}
              actingOnBehalfOf={target.id}
              onSubmitSuccess={() => { onAdded(); onClose() }}
              onCancel={onClose}
            />
          </>
        ) : (
          <>
            <p className={`text-sm ${TEXT_BODY}`}>
              Pick a diver to register for <span className="font-semibold">{event.title}</span>. The same
              confirmation PDF and email the diver gets when they self-register will be sent to them.
            </p>
            <input
              type="text"
              autoFocus
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search by name, display name, contact…"
              className={`${INPUT} text-sm`}
            />
            <ul className="space-y-1 max-h-80 overflow-y-auto">
              {visible.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setTarget(p)}
                    className="w-full text-left bg-white/70 hover:bg-sky-100 border border-sky-200 rounded-lg px-3 py-2"
                  >
                    <p className="text-sm font-medium text-blue-900">
                      {p.full_name ?? '(no name)'}
                      {p.display_name && <span className="text-blue-900/80"> “{p.display_name}”</span>}
                      {p.name_alt && <span className="text-blue-900/80"> ({p.name_alt})</span>}
                    </p>
                    <p className="text-xs text-blue-900/70">
                      {p.cert_agency && p.cert_level && `${p.cert_agency} ${p.cert_level}`}
                      {(p.cert_agency || p.cert_level) && (p.contact_id || p.phone) && ' · '}
                      {p.contact_id ?? p.phone ?? ''}
                      {p.status && p.status !== 'active' && (
                        <span className="ml-2 uppercase tracking-wider text-red-700">{p.status}</span>
                      )}
                    </p>
                  </button>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="text-sm text-blue-900/80 italic px-1">No matching divers.</li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
