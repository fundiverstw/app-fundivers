import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { createDiverAccount } from '../../lib/create-diver'
import { personName } from '../../lib/names'
import { ProfileForm } from '../ProfilePage'
import { UserPlusIcon } from '../../components/icons/UserPlusIcon'
import type { Profile } from '../../types/database'
import { t } from '../../i18n'

const cd = t.admin.createDiver
// Shared account-field labels — the same copy the on-behalf modal and the
// family panel use, so a diver's create form reads identically everywhere.
const pf = t.profile.family

// Light-card input / label styling — admin pages render dark text on the white
// frosted cards (matching AdminNotificationsPage). The INPUT/BTN_PRIMARY tokens
// are near-white, tuned for the dark diver-facing chrome, so they'd vanish here.
const LABEL = 'text-xs font-medium text-brand-900'
const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'
const HINT = 'block text-xs text-brand-900/70'

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
    const trimmedName = fullName.trim()
    if (!email.trim() || !trimmedName) {
      setError(pf.emailNameRequired)
      return
    }
    setSubmitting(true)
    try {
      const { profile, emailSent } = await createDiverAccount({
        email,
        name: fullName,
        nickname,
      })
      const tail = emailSent ? pf.emailSent : pf.emailSkipped
      toast.success(cd.createdTitle(trimmedName) + tail)
      onCreated(profile)
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
      <label className="block space-y-1">
        <span className={LABEL}>{pf.emailLabel}</span>
        <input
          type="email" required autoFocus
          value={email} onChange={e => setEmail(e.target.value)}
          className={FIELD}
        />
        <span className={HINT}>{cd.emailHint}</span>
      </label>
      <label className="block space-y-1">
        <span className={LABEL}>{pf.nameLabel}</span>
        <input
          type="text" required
          value={fullName} onChange={e => setFullName(e.target.value)}
          className={FIELD}
        />
        <span className={HINT}>{pf.nameHint}</span>
      </label>
      <label className="block space-y-1">
        <span className={LABEL}>{pf.nicknameLabel}</span>
        <input
          type="text"
          value={nickname} onChange={e => setNickname(e.target.value)}
          placeholder={pf.nicknamePlaceholder}
          className={FIELD}
        />
      </label>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-accent rounded px-2 py-1">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-2 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50"
      >
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
            to={`/admin/events?diver=${profile.id}`}
            className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1.5 rounded-lg"
          >
            {cd.registerForEvent}
          </Link>
          <Link
            to={`/admin/users?diver=${profile.id}`}
            className="text-xs font-semibold bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300 px-3 py-1.5 rounded-lg"
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
