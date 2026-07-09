import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { ProfileForm } from '../../pages/ProfilePage'
import type { Profile } from '../../types/database'
import { BTN_SECONDARY } from '../../styles/tokens'
import { t } from '../../i18n'

// Diver-facing "Family" panel on /profile. Lets a top-level diver (one
// whose own parent_account is null) see + create child accounts they
// manage. The child accounts are real diver profiles — a child can also
// log in directly if they ever want to. Parent rights flow through the
// parent_account FK + the matching RLS policies in
// 20260514030000_parent_child_accounts.sql.
export function FamilySection({ parent }: { parent: Profile }) {
  // Only top-level divers (parent_account === null) can themselves be
  // parents — the one-level family-tree rule. Children see no panel.
  if (parent.parent_account) return null
  if (parent.status !== 'active') return null

  return <FamilyPanel parent={parent} />
}

function FamilyPanel({ parent }: { parent: Profile }) {
  const [children, setChildren] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  // Which child's full profile editor is currently expanded (null = none).
  const [editingId, setEditingId] = useState<string | null>(null)
  // Bumped after a successful create so the effect refires. Keeps the
  // fetch inline (no separate refresh() helper) which sidesteps the
  // react-hooks/set-state-in-effect lint rule.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .eq('parent_account', parent.id)
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setChildren((data ?? []) as Profile[])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [parent.id, refreshKey])

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3" aria-label={t.profile.family.title}>
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-brand-900">{t.profile.family.title}</h2>
      </header>
      <p className="text-xs text-brand-900 font-medium">
        {t.profile.family.intro}
      </p>

      {loading ? (
        <div className="flex justify-center py-2">
          <div className="w-5 h-5 border-2 border-brand-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : children.length === 0 ? (
        <p className="text-sm text-brand-950 font-medium italic">{t.profile.family.noChildren}</p>
      ) : (
        <ul className="space-y-1">
          {children.map(c => (
            <li key={c.id} className="bg-surface-50 border border-surface-200 rounded-lg px-3 py-2 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-900">
                    {c.name ?? t.profile.family.noName}
                    {c.nickname && <span className="text-brand-900/80"> ({c.nickname})</span>}
                  </p>
                  <p className="text-xs text-brand-900/70">
                    {c.cert_agency && c.cert_level ? `${c.cert_agency} ${c.cert_level}` : t.profile.family.uncertified}
                    {c.status && c.status !== 'active' && (
                      <span className="ml-2 uppercase tracking-wider text-red-700">{c.status}</span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(prev => prev === c.id ? null : c.id)}
                  aria-expanded={editingId === c.id}
                  className="shrink-0 text-xs font-semibold text-brand-900 border border-surface-300 rounded-lg px-3 py-1 hover:bg-surface-100"
                >
                  {editingId === c.id ? t.profile.family.close : t.profile.family.edit}
                </button>
              </div>
              {editingId === c.id && (
                <div className="border-t border-surface-200 pt-2">
                  {/* Full profile editor — parent updates the child's row
                      directly (RLS + storage policies scope it to children). */}
                  <ProfileForm
                    key={c.id}
                    user={{ id: parent.id }}
                    profile={c}
                    onSaved={() => { setEditingId(null); setRefreshKey(k => k + 1) }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <CreateChildForm
          onCancel={() => setCreating(false)}
          onCreated={() => { setCreating(false); setRefreshKey(k => k + 1) }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full text-sm bg-emerald-900/80 hover:bg-emerald-900 text-white font-semibold px-3 py-2 rounded-lg"
        >
          {t.profile.family.createAccount}
        </button>
      )}
    </section>
  )
}

function CreateChildForm({
  onCancel, onCreated,
}: {
  onCancel: () => void
  onCreated: () => void
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
    const trimmedName  = fullName.trim()
    if (!trimmedEmail || !trimmedName) {
      setError(t.profile.family.emailNameRequired)
      return
    }
    setSubmitting(true)
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        ok: boolean
        user_id: string
        email_sent: boolean
      }>('create-child-account', {
        body: {
          email:        trimmedEmail,
          name:    trimmedName,
          nickname: nickname.trim() || undefined,
        },
      })
      if (invokeErr) throw new Error(invokeErr.message)
      if (!data?.ok || !data.user_id) throw new Error(t.profile.family.createFailed)

      const tail = data.email_sent ? t.profile.family.emailSent : t.profile.family.emailSkipped
      toast.success(t.profile.family.created(tail))
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border-t border-surface-200 pt-3">
      <p className="text-xs text-brand-900 font-medium">
        {t.profile.family.createIntro}
      </p>
      <label className="block">
        <span className="text-xs font-medium text-brand-900">{t.profile.family.emailLabel}</span>
        <input
          type="email" required autoFocus
          value={email} onChange={e => setEmail(e.target.value)}
          className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 text-sm focus:outline-none focus:border-brand-900"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-brand-900">{t.profile.family.nameLabel}</span>
        <input
          type="text" required
          value={fullName} onChange={e => setFullName(e.target.value)}
          className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 text-sm focus:outline-none focus:border-brand-900"
        />
        <span className="block text-xs text-brand-900/70 mt-1">
          {t.profile.family.nameHint}
        </span>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-brand-900">{t.profile.family.nicknameLabel}</span>
        <input
          type="text"
          value={nickname} onChange={e => setNickname(e.target.value)}
          placeholder={t.profile.family.nicknamePlaceholder}
          className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 text-sm focus:outline-none focus:border-brand-900"
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
          className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50"
        >
          {submitting ? t.profile.family.creating : t.profile.family.createSubmit}
        </button>
      </div>
    </form>
  )
}
