import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { personName } from '../../lib/names'
import { RegisterFormBody } from '../register/RegisterForm'
import type { AppEvent, Profile } from '../../types/database'
import { MODAL_BACKDROP, TEXT_HEADING, TEXT_BODY, INPUT, INPUT_LABEL, BTN_PRIMARY, BTN_SECONDARY } from '../../styles/tokens'
import { t } from '../../i18n'

const ad = t.admin.addDiver
const pf = t.profile.family

// Three-step "register a diver on behalf" modal:
//   1. pick which diver — search profiles by name / nickname / contact,
//      or click "Create new diver account" to mint a fresh profile.
//   2. (optional) create-new-account form — admin fills minimal identity,
//      edge function provisions the auth user + emails a one-time link
//      the diver uses to pick their own password.
//   3. fill out the same RegisterFormBody the diver would see, with
//      `actingOnBehalfOf` set so the booking lands on the diver's id.
//
// Step 3 reuses the diver-side form unchanged. The form invokes the
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
  const [creatingNew, setCreatingNew] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setProfiles((data ?? []) as Profile[])
      })
    return () => { cancelled = true }
  }, [])

  const visible = profiles.filter(p => {
    if (!filter) return true
    const haystack = [p.name, p.nickname, p.contact_id]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(filter.toLowerCase())
  })

  const title = target
    ? ad.registerFor(personName(target.name, target.nickname) || t.admin.family.diverFallback)
    : creatingNew
      ? ad.createNewAccountTitle
      : ad.addDiverToEvent

  return (
    <div
      className={`${MODAL_BACKDROP} flex items-start justify-center p-4 pt-8 overflow-y-auto`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-diver-title"
      onClick={onClose}
    >
      <div
        className="bg-white/80 backdrop-blur-md border border-accent rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 id="add-diver-title" className={`text-lg ${TEXT_HEADING}`}>{title}</h2>
          <button onClick={onClose} className="text-brand-900 font-medium text-xl leading-none" aria-label={ad.close}>×</button>
        </header>

        {target ? (
          <>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="text-xs text-brand-900 hover:underline"
            >
              {ad.pickDifferentDiver}
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
        ) : creatingNew ? (
          <CreateNewDiverForm
            eventTitle={event.title}
            onCancel={() => setCreatingNew(false)}
            onCreated={profile => {
              setProfiles(prev => [profile, ...prev])
              setTarget(profile)
              setCreatingNew(false)
            }}
          />
        ) : (
          <>
            <p className={`text-sm ${TEXT_BODY}`}>
              {ad.pickDiverPrefix}<span className="font-semibold">{event.title}</span>{ad.pickDiverSuffix}
            </p>
            <button
              type="button"
              onClick={() => setCreatingNew(true)}
              className="w-full text-sm bg-emerald-900/80 hover:bg-emerald-900 text-white font-semibold px-3 py-2 rounded-lg"
            >
              {pf.createAccount}
            </button>
            <input
              type="text"
              autoFocus
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={ad.searchPlaceholder}
              className={`${INPUT} text-sm`}
            />
            <ul className="space-y-1 max-h-80 overflow-y-auto">
              {visible.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setTarget(p)}
                    className="w-full text-left bg-white/70 hover:bg-surface-100 border border-surface-200 rounded-lg px-3 py-2"
                  >
                    <p className="text-sm font-medium text-brand-900">
                      {p.name ?? pf.noName}
                      {p.nickname && <span className="text-brand-900/80"> ({p.nickname})</span>}
                    </p>
                    <p className="text-xs text-brand-900/70">
                      {p.cert_agency && p.cert_level && `${p.cert_agency} ${p.cert_level}`}
                      {(p.cert_agency || p.cert_level) && p.contact_id && ' · '}
                      {p.contact_id ?? ''}
                      {p.status && p.status !== 'active' && (
                        <span className="ml-2 uppercase tracking-wider text-red-700">{p.status}</span>
                      )}
                    </p>
                  </button>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="text-sm text-brand-900/80 italic px-1">{ad.noMatchingDivers}</li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function CreateNewDiverForm({
  onCancel,
  onCreated,
  eventTitle,
}: {
  onCancel: () => void
  onCreated: (profile: Profile) => void
  eventTitle: string
}) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [nickname, setNickname] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedName = fullName.trim()
    if (!trimmedEmail || !trimmedName) {
      setError(pf.emailNameRequired)
      return
    }
    setSubmitting(true)
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        ok: boolean
        user_id: string
        email_sent: boolean
      }>('admin-create-diver', {
        body: {
          email:        trimmedEmail,
          name:    trimmedName,
          nickname: nickname.trim() || undefined,
          event_title:  eventTitle,
        },
      })
      if (invokeErr) throw new Error(invokeErr.message)
      if (!data?.ok || !data.user_id) throw new Error(ad.createFailed)

      // Fetch the newly created (and admin-updated) profile so step 3 has a
      // real Profile to register against.
      const { data: profile, error: profErr } = await supabase
        .from('profiles').select('*').eq('id', data.user_id).single()
      if (profErr || !profile) throw new Error(profErr?.message ?? ad.profileNotFound)

      const tail = data.email_sent ? pf.emailSent : pf.emailSkipped
      toast.success(ad.accountCreated(tail))
      onCreated(profile as Profile)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-brand-900 hover:underline"
      >
        {ad.backToList}
      </button>
      <p className={`text-sm ${TEXT_BODY}`}>{ad.createIntro}</p>

      <label className="block">
        <span className={INPUT_LABEL}>{pf.emailLabel}</span>
        <input
          type="email" required autoFocus
          value={email} onChange={e => setEmail(e.target.value)}
          className={`${INPUT} text-sm`}
        />
      </label>
      <label className="block">
        <span className={INPUT_LABEL}>{pf.nameLabel}</span>
        <input
          type="text" required
          value={fullName} onChange={e => setFullName(e.target.value)}
          className={`${INPUT} text-sm`}
        />
        <span className="block text-xs text-brand-900/70 mt-1">{pf.nameHint}</span>
      </label>
      <label className="block">
        <span className={INPUT_LABEL}>{pf.nicknameLabel}</span>
        <input
          type="text"
          value={nickname} onChange={e => setNickname(e.target.value)}
          placeholder={ad.nicknamePlaceholder}
          className={`${INPUT} text-sm`}
        />
      </label>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-accent rounded px-2 py-1">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className={`flex-1 ${BTN_SECONDARY}`}
        >
          {t.common.cancel}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={`flex-1 ${BTN_PRIMARY}`}
        >
          {submitting ? pf.creating : pf.createSubmit}
        </button>
      </div>
    </form>
  )
}
