import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchTerms, invalidateTerms, type Terms } from '../../lib/terms'
import { starterTermsTemplate } from '../../lib/terms-template'
import { Markdown } from '../../components/Markdown'
import { t } from '../../i18n'

const tm = t.admin.terms

// The shop authors its own Terms of Use here (migration 20260711100000). One
// row, so this is an editor, not a CRUD list.
//
// The version is what makes every diver re-accept, so it is never bumped
// silently: the admin ticks "material change" to say this edit is substantive.
// A typo fix leaves the version alone and interrupts nobody.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminTermsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [row, setRow] = useState<Terms | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [material, setMaterial] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchTerms().then(terms => {
      if (cancelled) return
      if (terms) { setRow(terms); setTitle(terms.title); setBody(terms.body) }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  function loadTemplate() {
    if (body.trim() && !window.confirm(tm.overwriteConfirm)) return
    setBody(starterTermsTemplate())
  }

  async function save() {
    setError(null)
    if (!body.trim()) { setError(tm.bodyRequired); return }
    setSubmitting(true)
    try {
      const nextVersion = (row?.version ?? 1) + (material ? 1 : 0)
      const { error: err } = await supabase
        .from('terms')
        .update({
          title: title.trim() || tm.title,
          body,
          version: nextVersion,
          updated_by: profile?.id ?? null,
        })
        .eq('singleton', true)
      if (err) throw err

      // Drop the memoised copy so RequireCurrentTerms and /terms see the new
      // version on their next read rather than the stale one from this session.
      invalidateTerms()
      const fresh = await fetchTerms()
      if (fresh) setRow(fresh)
      setMaterial(false)
      toast.success(material ? tm.savedBumped(nextVersion) : tm.saved)
    } catch (err) {
      setError(errorMessage(err))
      toast.error(tm.saveFailed)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-sm text-white/70">{tm.loading}</p>

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">{tm.title}</h1>
        <p className="text-sm text-white/80 mt-1">{tm.intro}</p>
      </div>

      <p className="text-xs text-white/70">
        {tm.currentVersion(row?.version ?? 1)}
        {' · '}
        {row?.body.trim() ? tm.lastUpdated(new Date(row.updatedAt).toLocaleDateString()) : tm.never}
      </p>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-white/80">{tm.titleLabel}</span>
        <input className={FIELD} value={title} onChange={e => setTitle(e.target.value)} />
      </label>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-white/80">{tm.bodyLabel}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(p => !p)}
              className="text-xs font-semibold text-white/80 hover:text-white underline">
              {showPreview ? tm.edit : tm.preview}
            </button>
            <button type="button" onClick={loadTemplate}
              className="text-xs font-semibold text-amber-300 hover:text-amber-200">
              {tm.loadTemplate}
            </button>
          </div>
        </div>

        {showPreview ? (
          <div className="bg-white rounded-md p-4 text-sm text-brand-950">
            <Markdown source={body} />
          </div>
        ) : (
          <textarea
            className={`${FIELD} font-mono text-xs resize-y`}
            rows={20}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={tm.bodyPlaceholder}
          />
        )}
      </div>

      <label className="flex items-start gap-2 text-sm text-white/90">
        <input type="checkbox" checked={material} onChange={e => setMaterial(e.target.checked)}
          className="mt-1 accent-brand-900" />
        <span>
          {tm.materialChange}
          <span className="block text-xs text-white/60">{tm.materialChangeHint}</span>
        </span>
      </label>

      {error && <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>}

      <button type="button" onClick={save} disabled={submitting}
        className="w-full py-2.5 rounded-xl font-semibold bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white">
        {submitting ? tm.saving : tm.save}
      </button>
    </div>
  )
}
