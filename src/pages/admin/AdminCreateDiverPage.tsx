import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { personName } from '../../lib/names'
import { ProfileForm } from '../ProfilePage'
import { UserPlusIcon } from '../../components/icons/UserPlusIcon'
import type { Profile } from '../../types/database'
import { INPUT, INPUT_LABEL, BTN_PRIMARY } from '../../styles/tokens'
import { t } from '../../i18n'

const cd = t.admin.createDiver
// Shared account-field labels — the same copy the on-behalf modal and the
// family panel use, so a diver's create form reads identically everywhere.
const pf = t.profile.family

// Standalone "create a diver on behalf" page, reachable from the Manage hub.
// The event-detail modal (AdminAddDiverModal) does the same account mint as a
// step before registering for one specific event; this page is the
// no-event-yet entry point for onboarding a walk-in or a diver who never
// wants to sign up themselves. Two phases:
//   1. Create the account — email + name (+ optional nickname) → the
//      admin-create-diver edge function provisions the auth user, promotes the
//      profile out of pending, and sends a courtesy email.
//   2. Fill in the rest — the same ProfileForm the diver would use, writing
//      through to the new profile via the admin RLS policy, plus quick links to
//      register them for an event or open their full directory card.
export function AdminCreateDiverPage() {
  const [created, setCreated] = useState<Profile | null>(null)

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-white" aria-hidden="true"><UserPlusIcon /></span>
        <h1 className="text-2xl font-bold text-white">{cd.title}</h1>
      </div>

      {created ? (
        <CreatedPanel profile={created} onCreateAnother={() => setCreated(null)} />
      ) : (
        <>
          <p className="text-sm text-white/85">{cd.intro}</p>
          <CreateAccountForm onCreated={setCreated} />
        </>
      )}
    </div>
  )
}

function CreateAccountForm({ onCreated }: { onCreated: (profile: Profile) => void }) {
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
          email:    trimmedEmail,
          name:     trimmedName,
          nickname: nickname.trim() || undefined,
        },
      })
      if (invokeErr) throw new Error(invokeErr.message)
      if (!data?.ok || !data.user_id) throw new Error(cd.createFailed)

      const { data: profile, error: profErr } = await supabase
        .from('profiles').select('*').eq('id', data.user_id).single()
      if (profErr || !profile) throw new Error(profErr?.message ?? cd.profileNotFound)

      const tail = data.email_sent ? pf.emailSent : pf.emailSkipped
      toast.success(cd.createdTitle(trimmedName) + tail)
      onCreated(profile as Profile)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3"
    >
      <label className="block">
        <span className={INPUT_LABEL}>{pf.emailLabel}</span>
        <input
          type="email" required autoFocus
          value={email} onChange={e => setEmail(e.target.value)}
          className={`${INPUT} text-sm`}
        />
        <span className="block text-xs text-brand-900/70 mt-1">{cd.emailHint}</span>
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
          placeholder={pf.nicknamePlaceholder}
          className={`${INPUT} text-sm`}
        />
      </label>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-accent rounded px-2 py-1">{error}</p>}

      <button type="submit" disabled={submitting} className={`w-full ${BTN_PRIMARY}`}>
        {submitting ? pf.creating : pf.createSubmit}
      </button>
    </form>
  )
}

function CreatedPanel({ profile, onCreateAnother }: {
  profile: Profile
  onCreateAnother: () => void
}) {
  // ProfileForm saves with .eq('id', profile.id); it needs a signed-in user
  // for the guard + card-upload attribution, so we pass the acting admin.
  const { user } = useAuth()
  const name = personName(profile.name, profile.nickname) || t.admin.family.diverFallback

  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-emerald-900">{cd.createdTitle(name)}</p>
        <p className="text-xs text-emerald-800 mt-1">{cd.createdIntro}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <Link
            to="/admin/events"
            className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1.5 rounded-lg"
          >
            {cd.registerForEvent}
          </Link>
          <Link
            to={`/admin/users?diver=${profile.id}`}
            className="text-xs font-semibold bg-white hover:bg-surface-100 text-brand-900 border border-surface-300 px-3 py-1.5 rounded-lg"
          >
            {cd.openInDirectory}
          </Link>
          <button
            type="button"
            onClick={onCreateAnother}
            className="text-xs font-semibold text-brand-700 hover:text-brand-900 underline px-1"
          >
            {cd.createAnother}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/80">{cd.detailsHeading}</h2>
        <p className="text-xs text-white/70">{cd.detailsOptional}</p>
      </div>
      {user && <ProfileForm key={profile.id} user={user} profile={profile} />}
    </div>
  )
}
