import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { useShopProfile } from '../../hooks/useShopProfile'
import { errorMessage } from '../../lib/errors'
import { compressImage } from '../../lib/image-compress'
import { siteConfig } from '../../config/site'
import {
  BUILT_IN_LANGUAGES, SHOP_LOGO_BUCKET, configDrift, fetchStandardsOrganizations,
  logoUrlOf, saveShopProfile, standardsOrgOf,
} from '../../lib/shop-profile'
import { t } from '../../i18n'

const sp = t.admin.shopProfile

// Manage → Shop Profile. The four things a shop wants to change about its own
// identity without a developer.
//
// Two of them are honest controls and two are honest *records*. The logo and
// the training agency are read at runtime, so saving them changes the app. The
// currency and the language are compiled into the bundle — the language decides
// which message catalog is even present, and the currency is read by
// vite.config.ts and the service worker as well — so this page stores the
// choice and then says plainly that it takes a redeploy. The build reads the
// same row, so the deploy applies it with nothing to hand-edit — but between
// the save and that deploy the two really do disagree, and saying so is the
// difference between a control and a control that lies.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'
const LABEL = 'block text-xs font-semibold text-brand-900 mb-1'
const HINT = 'block text-xs text-brand-900/70 mt-1'
const CARD = 'bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3'
const BTN = 'text-xs font-semibold bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg'
const BTN_GHOST = 'text-xs font-semibold bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg'

type Field = 'org' | 'currency' | 'language'

/** Longest side, in px, the uploaded logo is scaled to. */
const LOGO_SIZES = [256, 512, 1024] as const
const MAX_UPLOAD_MB = 10

export function AdminShopProfilePage() {
  const toast = useToast()
  const { profile, refresh } = useShopProfile()
  const fileInput = useRef<HTMLInputElement>(null)

  const [orgs, setOrgs] = useState<string[]>([])
  const [logoSize, setLogoSize] = useState<number>(512)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Only the admin's *edits* are state. Everything else is derived from the
  // saved row, falling back to what the build itself runs — so a field shows
  // the value actually in force rather than a blank that reads as "unset", and
  // a refresh after saving cannot leave the form showing something stale.
  const [edits, setEdits] = useState<Partial<Record<Field, string>>>({})
  const saved: Record<Field, string> = {
    org: standardsOrgOf(profile),
    currency: profile.currency ?? siteConfig.locale.currency,
    language: profile.language ?? siteConfig.locale.language,
  }
  const value = (field: Field): string => edits[field] ?? saved[field]
  const edit = (field: Field, next: string) => setEdits(prev => ({ ...prev, [field]: next }))

  useEffect(() => {
    let cancelled = false
    fetchStandardsOrganizations().then(list => { if (!cancelled) setOrgs(list) })
    return () => { cancelled = true }
  }, [])

  async function handleUpload(file: File) {
    if (!file.type.startsWith('image/')) return toast.error(sp.logoNotImage)
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return toast.error(sp.logoTooBig(MAX_UPLOAD_MB))

    setUploading(true)
    try {
      // PNG, not the helper's default JPEG: a logo without an alpha channel
      // arrives with a black box behind it, and PNG is also what the PDF
      // builder can embed.
      const blob = await compressImage(file, { maxDimension: logoSize, mimeType: 'image/png' })
      // Named by the moment it was uploaded so a replacement never collides
      // with a cached copy of the one before it.
      const path = `logo-${Date.now()}.png`
      const { error } = await supabase.storage
        .from(SHOP_LOGO_BUCKET)
        .upload(path, blob, { contentType: 'image/png', upsert: true })
      if (error) throw error

      const previous = profile.logoPath
      await saveShopProfile({ logoPath: path })
      // Only after the row points at the new file: a delete that ran first
      // would leave every surface with a broken image if the save failed.
      if (previous) await supabase.storage.from(SHOP_LOGO_BUCKET).remove([previous])

      await refresh()
      toast.success(sp.saved)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function handleRemoveLogo() {
    setUploading(true)
    try {
      const previous = profile.logoPath
      await saveShopProfile({ logoPath: null })
      if (previous) await supabase.storage.from(SHOP_LOGO_BUCKET).remove([previous])
      await refresh()
      toast.success(sp.logoRemoved)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveShopProfile({
        standardsOrg: value('org') || null,
        currency: value('currency').trim() || null,
        language: value('language') || null,
      })
      setEdits({})
      await refresh()
      toast.success(sp.saved)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const drift = configDrift(profile)

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">{sp.title}</h1>
      <p className="text-sm text-white/80">{sp.intro}</p>

      {/* ── Logo ─────────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-lg font-bold text-brand-900">{sp.logoHeading}</h2>
        <p className="text-sm text-brand-900/70">{sp.logoIntro}</p>

        <div className="flex items-center gap-4">
          {/* Checkerboard behind it, so a transparent logo reads as
              transparent rather than as white-on-white. */}
          <div
            className="shrink-0 w-28 h-20 rounded-md border border-surface-300 grid place-items-center overflow-hidden"
            style={{
              backgroundImage:
                'linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)',
              backgroundSize: '12px 12px',
              backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
            }}
          >
            <img src={logoUrlOf(profile)} alt={sp.logoCurrent} className="max-w-full max-h-full object-contain" />
          </div>
          <p className="text-xs text-brand-900/70">
            {profile.logoPath ? sp.logoUploaded : sp.logoDefault}
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="logo-size">{sp.logoSize}</label>
          <select id="logo-size" aria-describedby="logo-size-hint" className={FIELD}
            value={logoSize} onChange={e => setLogoSize(Number(e.target.value))}>
            {LOGO_SIZES.map(px => <option key={px} value={px}>{px} px</option>)}
          </select>
          <span id="logo-size-hint" className={HINT}>{sp.logoSizeHint(logoSize)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-label={sp.logoChoose}
            disabled={uploading}
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f) }}
            className="text-xs text-brand-900"
          />
          {uploading && <span className="text-xs text-brand-900/70">{sp.logoUploading}</span>}
          {profile.logoPath && !uploading && (
            <button type="button" className={BTN_GHOST} onClick={() => void handleRemoveLogo()}>
              {sp.logoRemove}
            </button>
          )}
        </div>
      </section>

      {/* ── Certification standards ──────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-lg font-bold text-brand-900">{sp.standardsHeading}</h2>
        <p className="text-sm text-brand-900/70">{sp.standardsIntro}</p>

        <div>
          <label className={LABEL} htmlFor="standards-org">{sp.standardsOrg}</label>
          <select id="standards-org" className={FIELD}
            value={value('org')} onChange={e => edit('org', e.target.value)}>
            {orgs.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        <Link to="/admin/cert-equivalence" className="inline-block text-xs font-semibold text-brand-700 underline">
          {sp.standardsChart}
        </Link>
      </section>

      {/* ── Compiled-in settings ─────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-lg font-bold text-brand-900">{sp.buildHeading}</h2>
        <p className="text-sm text-brand-900/70">{sp.buildIntro}</p>

        <div>
          <label className={LABEL} htmlFor="currency">{sp.currency}</label>
          <input id="currency" aria-describedby="currency-hint" className={FIELD}
            value={value('currency')} onChange={e => edit('currency', e.target.value)} />
          <span id="currency-hint" className={HINT}>{sp.currencyHint}</span>
        </div>

        <div>
          <label className={LABEL} htmlFor="app-language">{sp.language}</label>
          <select id="app-language" className={FIELD}
            value={value('language')} onChange={e => edit('language', e.target.value)}>
            {BUILT_IN_LANGUAGES.map(code => <option key={code} value={code}>{code}</option>)}
          </select>
        </div>

        {drift.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-900">{sp.driftHeading}</p>
            <p className="text-xs text-amber-900">{sp.driftBody}</p>
            <ul className="text-xs text-amber-900 space-y-1">
              {drift.map(d => <li key={d.field}>{sp.driftRow(d.field, d.chosen, d.running)}</li>)}
            </ul>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button type="button" className={BTN} disabled={saving} onClick={() => void handleSave()}>
          {saving ? sp.saving : sp.save}
        </button>
      </div>
    </div>
  )
}
