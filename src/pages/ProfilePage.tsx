import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { pushSupported, getPushSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/push'
import { GEAR_ITEMS } from '../lib/gear'
import { uploadCertCard, getCertCardSignedUrl, deleteCertCard } from '../lib/cert-card'
import { FamilySection } from '../components/profile/FamilySection'
import type { Profile, CertLevel } from '../types/database'
import {
  SHOE_UNITS,
  SHOE_GENDERS,
  convertShoeSize,
  formatShoeSize,
  parseShoeSize,
  shoeSizesFor,
  type ShoeGender,
  type ShoeUnit,
} from '../lib/shoe-size'

// Schema intentionally matches what the HTML form emits (strings for text +
// number inputs, booleans for checkboxes). Numeric/enum coercion happens in
// onSubmit so the input and output types of this schema are identical, which
// keeps react-hook-form happy.
// Optional text fields use `.nullish()` (string | null | undefined) so
// that pre-existing NULLs from a freshly-created profile don't fail
// validation — react-hook-form passes them through as `null`, and the
// previous `.optional()` (string | undefined) rejected null silently,
// which surfaced as a save that only worked once the user typed into
// every empty field.
const schema = z.object({
  full_name: z.string().min(1, 'Required'),
  display_name: z.string().min(1, 'Required'),
  name_alt: z.string().nullish(),
  phone: z.string().nullish(),
  date_of_birth: z.string().min(1, 'Required'),
  nationality: z.string().nullish(),
  id_number: z.string().nullish(),
  emergency_contact_name: z.string().nullish(),
  emergency_contact_phone: z.string().nullish(),
  cert_agency: z.string().nullish(),
  cert_level: z.string().min(1, 'Required'),
  medical_notes: z.string().nullish(),
  height_cm: z.union([z.string(), z.number()]).nullish(),
  weight_kg: z.union([z.string(), z.number()]).nullish(),
  gender: z.string().nullish(),
  contact_method: z.string().min(1, 'Required'),
  contact_id: z.string().min(1, 'Required'),
  nitrox_certified: z.boolean().nullish(),
  logged_dives: z
    .union([z.string(), z.number()])
    .refine(v => typeof v === 'number' || v.length > 0, { message: 'Required' }),
  last_dive_date: z.string().nullish(),
})
type FormData = z.infer<typeof schema>

function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
function strOrNull(v: unknown): string | null {
  if (v === '' || v === null || v === undefined) return null
  return String(v)
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-blue-900 font-medium mb-1 uppercase tracking-wide">
        {label}
        {required && <span className="text-red-600 ml-0.5" aria-label="required">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass = 'w-full bg-white border border-sky-300 rounded-lg px-3 py-2 text-blue-900 text-sm focus:outline-none focus:border-blue-900'

export function ProfilePage() {
  const { user, profile } = useAuth()

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-white">My Profile</h1>
      <NotificationsToggle />
      {user && profile && (
        // Keying on profile.id remounts the form whenever a different
        // profile loads, so all initial state is computed lazily from
        // props at mount — no sync-state-from-prop effect needed.
        <>
          <ProfileForm key={profile.id} user={user} profile={profile} />
          <FamilySection parent={profile} />
        </>
      )}
    </div>
  )
}

export function ProfileForm({ user, profile, onSaved }: {
  user: { id: string }
  profile: Profile
  /** Fires after a successful save. PendingPage uses it to flip to a
   *  "waiting for approval" screen once the diver has submitted their
   *  required info. Optional — the regular /profile page ignores it. */
  onSaved?: () => void
}) {
  const toast = useToast()
  const { register, handleSubmit, reset, control, setValue, formState: { errors, isSubmitting, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: profile as unknown as FormData,
  })

  const [gearOwned, setGearOwned] = useState<string[]>(
    () => Array.isArray(profile.gear_owned) ? [...profile.gear_owned] : []
  )
  // Agency + cert level dropdowns both pull from public.cert_levels (RLS
  // public-read). Each row carries an `organization` ('PADI' | 'BSAC' | …)
  // so we can derive the agency list and filter the level list by the
  // currently-selected agency. Fetched once on mount.
  const [certLevels, setCertLevels] = useState<CertLevel[]>([])
  useEffect(() => {
    let cancelled = false
    supabase
      .from('cert_levels')
      .select('*')
      .order('rank')
      .then(({ data }) => {
        if (cancelled) return
        // Defensive: tests mock supabase.from with a single shared builder that
        // can return shapes other than an array. Narrow before using map().
        setCertLevels(Array.isArray(data) ? (data as CertLevel[]) : [])
      })
    return () => { cancelled = true }
  }, [])

  // useWatch (not the watch() function from useForm) — useWatch is the
  // React-Compiler-safe API for reading a live form value.
  const selectedAgency = useWatch({ control, name: 'cert_agency' }) ?? ''
  // Distinct orgs in the order returned by the rank-sorted query (PADI rows
  // come first because they're the seed; agency rows follow).
  const orgs = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of certLevels) {
      if (!seen.has(c.organization)) { seen.add(c.organization); out.push(c.organization) }
    }
    return out
  }, [certLevels])
  const filteredLevels = useMemo(
    () => certLevels.filter(c => c.organization === selectedAgency),
    [certLevels, selectedAgency],
  )

  const initialShoe = useMemo(() => parseShoeSize(profile.shoe_size), [profile.shoe_size])
  const [shoeUnit, setShoeUnit] = useState<ShoeUnit>(() => initialShoe?.unit ?? 'eu')
  const [shoeGender, setShoeGender] = useState<ShoeGender>(() => initialShoe?.gender ?? 'm')
  const [shoeValue, setShoeValue] = useState<string>(() => initialShoe ? String(initialShoe.value) : '')
  const [dirtyExtras, setDirtyExtras] = useState(false)

  const shoeOptions = useMemo(() => shoeSizesFor(shoeUnit, shoeGender), [shoeUnit, shoeGender])
  const jpHint = useMemo(() => {
    if (!shoeValue || shoeUnit === 'jp') return null
    const converted = convertShoeSize(parseFloat(shoeValue), shoeUnit, 'jp', shoeGender)
    return converted != null ? `JP: ${converted}` : null
  }, [shoeValue, shoeUnit, shoeGender])

  function toggleGearOwned(item: string) {
    setGearOwned(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])
    setDirtyExtras(true)
  }

  // Switching unit/gender snaps the current size to the nearest row in the new
  // unit so the user's selection isn't lost when they change the selector.
  function handleUnitChange(next: ShoeUnit) {
    if (shoeValue) {
      const converted = convertShoeSize(parseFloat(shoeValue), shoeUnit, next, shoeGender)
      if (converted != null) setShoeValue(String(converted))
    }
    setShoeUnit(next)
    setDirtyExtras(true)
  }
  function handleGenderChange(next: ShoeGender) {
    if (shoeValue) {
      // Map through JP (body reference) so the physical size is preserved.
      const asJp = convertShoeSize(parseFloat(shoeValue), shoeUnit, 'jp', shoeGender)
      if (asJp != null) {
        const back = convertShoeSize(asJp, 'jp', shoeUnit, next)
        if (back != null) setShoeValue(String(back))
      }
    }
    setShoeGender(next)
    setDirtyExtras(true)
  }

  async function onSubmit(data: FormData) {
    if (!user) return
    const method = data.contact_method
    const shoeSizeCanonical = shoeValue
      ? formatShoeSize(parseFloat(shoeValue), shoeUnit, shoeGender)
      : null
    // Update, not upsert: the row is created by handle_new_user at signup,
    // and there is no INSERT policy on profiles — upsert hits the INSERT
    // RLS check and 403s even when only updating an existing row.
    const { error } = await supabase.from('profiles').update({
      full_name: data.full_name,
      display_name: strOrNull(data.display_name),
      name_alt: strOrNull(data.name_alt),
      phone: strOrNull(data.phone),
      date_of_birth: strOrNull(data.date_of_birth),
      nationality: strOrNull(data.nationality),
      id_number: strOrNull(data.id_number),
      emergency_contact_name: strOrNull(data.emergency_contact_name),
      emergency_contact_phone: strOrNull(data.emergency_contact_phone),
      cert_agency: strOrNull(data.cert_agency),
      cert_level: strOrNull(data.cert_level),
      medical_notes: strOrNull(data.medical_notes),
      height_cm: numOrNull(data.height_cm),
      weight_kg: numOrNull(data.weight_kg),
      shoe_size: shoeSizeCanonical,
      gender: strOrNull(data.gender),
      contact_method: (method === 'whatsapp' || method === 'line' || method === 'phone' || method === 'email') ? method : null,
      contact_id: strOrNull(data.contact_id),
      nitrox_certified: Boolean(data.nitrox_certified),
      logged_dives: numOrNull(data.logged_dives) ?? 0,
      last_dive_date: strOrNull(data.last_dive_date),
      gear_owned: gearOwned,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id)
    if (error) {
      toast.error(`Could not save profile: ${error.message}`)
      return
    }
    reset(data)
    setDirtyExtras(false)
    toast.success('Profile saved')
    onSaved?.()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Personal Info</h2>
          <Field label="Full name" required>
            <input {...register('full_name')} className={inputClass} />
            {errors.full_name && <p className="text-red-600 text-xs mt-1">{errors.full_name.message}</p>}
          </Field>
          <Field label="Display name" required>
            <input {...register('display_name')} className={inputClass} />
            {errors.display_name && <p className="text-red-600 text-xs mt-1">{errors.display_name.message}</p>}
          </Field>
          <Field label="Name in another script (optional)">
            <input
              {...register('name_alt')}
              className={inputClass}
              placeholder="e.g. 陳大文 / 山田太郎 / 김민수"
            />
          </Field>
          <Field label="Phone"><input {...register('phone')} type="tel" className={inputClass} /></Field>
          <Field label="Date of birth" required>
            <input {...register('date_of_birth')} type="date" className={inputClass} />
            {errors.date_of_birth && <p className="text-red-600 text-xs mt-1">{errors.date_of_birth.message}</p>}
          </Field>
          <Field label="Nationality"><input {...register('nationality')} className={inputClass} /></Field>
          <Field label="ID / Passport number"><input {...register('id_number')} className={inputClass} /></Field>
          <Field label="Gender">
            <select {...register('gender')} className={inputClass}>
              <option value="">—</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </Field>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Preferred contact</h2>
          <Field label="Method" required>
            <select
              {...register('contact_method', { onChange: () => setDirtyExtras(true) })}
              className={inputClass}
            >
              <option value="">—</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="line">Line</option>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
            </select>
            {errors.contact_method && <p className="text-red-600 text-xs mt-1">{errors.contact_method.message}</p>}
          </Field>
          <Field label="Handle / number" required>
            <input
              {...register('contact_id', { onChange: () => setDirtyExtras(true) })}
              className={inputClass}
              placeholder="e.g. +886-900… or a Line ID"
            />
            {errors.contact_id && <p className="text-red-600 text-xs mt-1">{errors.contact_id.message}</p>}
          </Field>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Sizing</h2>
          <Field label="Height (cm)"><input {...register('height_cm')} type="number" step="0.1" className={inputClass} /></Field>
          <Field label="Weight (kg)"><input {...register('weight_kg')} type="number" step="0.1" className={inputClass} /></Field>
          <div>
            <label className="block text-xs text-blue-900 font-medium mb-1 uppercase tracking-wide">Shoe size</label>
            <div className="flex gap-1.5">
              <select
                aria-label="Shoe size unit"
                value={shoeUnit}
                onChange={e => handleUnitChange(e.target.value as ShoeUnit)}
                className="shrink-0 w-16 bg-white border border-sky-300 rounded-lg px-1.5 py-2 text-blue-900 text-sm focus:outline-none focus:border-blue-900"
              >
                {SHOE_UNITS.map(u => <option key={u} value={u}>{u.toUpperCase()}</option>)}
              </select>
              <select
                aria-label="Shoe size gender"
                value={shoeGender}
                onChange={e => handleGenderChange(e.target.value as ShoeGender)}
                className="shrink-0 w-14 bg-white border border-sky-300 rounded-lg px-1.5 py-2 text-blue-900 text-sm focus:outline-none focus:border-blue-900"
              >
                {SHOE_GENDERS.map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}
              </select>
              <select
                aria-label="Shoe size value"
                value={shoeValue}
                onChange={e => { setShoeValue(e.target.value); setDirtyExtras(true) }}
                className={`${inputClass} flex-1 min-w-0`}
              >
                <option value="">—</option>
                {shoeOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {jpHint && <p className="text-xs text-red-600 mt-1">{jpHint}</p>}
          </div>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Gear I own</h2>
          <p className="text-xs text-blue-900 font-medium">
            Checked items will be skipped when you choose à-la-carte rental at registration.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {GEAR_ITEMS.map(item => (
              <label key={item} className="flex items-center gap-2 text-sm text-blue-900">
                <input
                  type="checkbox"
                  checked={gearOwned.includes(item)}
                  onChange={() => toggleGearOwned(item)}
                  className="accent-blue-900"
                />
                {item}
              </label>
            ))}
          </div>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Emergency Contact</h2>
          <Field label="Name"><input {...register('emergency_contact_name')} className={inputClass} /></Field>
          <Field label="Phone"><input {...register('emergency_contact_phone')} type="tel" className={inputClass} /></Field>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Certification</h2>
          <Field label="Agency">
            <select
              // Clearing cert_level on agency change keeps the user from
              // saving a cert level that belongs to a different org. We do
              // it here on the register-level onChange (not via watch())
              // so it only fires for user-initiated edits — not for the
              // initial defaultValues hydration.
              {...register('cert_agency', {
                onChange: () => setValue('cert_level', '', { shouldDirty: true }),
              })}
              className={inputClass}
            >
              <option value="">— select agency —</option>
              {/* Preserve any legacy free-text agency on the existing profile
                   so opening the form doesn't silently drop it. */}
              {profile.cert_agency
                && !orgs.includes(profile.cert_agency)
                && <option value={profile.cert_agency}>{profile.cert_agency}</option>}
              {orgs.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>
          <Field label="Level" required>
            <select {...register('cert_level')} className={inputClass} disabled={!selectedAgency}>
              <option value="">{selectedAgency ? '— select level —' : '— pick agency first —'}</option>
              {/* Preserve a legacy free-text level if the current selection
                   isn't in the filtered list — only when the agency matches. */}
              {profile.cert_level
                && profile.cert_agency === selectedAgency
                && !filteredLevels.some(c => c.name === profile.cert_level)
                && <option value={profile.cert_level}>{profile.cert_level}</option>}
              {filteredLevels.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
            {errors.cert_level && <p className="text-red-600 text-xs mt-1">{errors.cert_level.message}</p>}
          </Field>
          <Field label="Logged dives" required>
            <input {...register('logged_dives')} type="number" min="0" className={inputClass} />
            {errors.logged_dives && <p className="text-red-600 text-xs mt-1">{errors.logged_dives.message}</p>}
          </Field>
          <Field label="Last dive"><input {...register('last_dive_date')} type="date" className={inputClass} /></Field>
          <label className="flex items-center gap-2 text-sm text-blue-900">
            <input type="checkbox" {...register('nitrox_certified')} className="accent-blue-900" />
            Nitrox certified
          </label>
        </section>

        {user && (
          <CertCardSection userId={user.id} />
        )}

        <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Medical Notes</h2>
          <textarea
            {...register('medical_notes')}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="Allergies, conditions, medications…"
          />
        </section>

        <button
          type="submit"
          disabled={isSubmitting || (!isDirty && !dirtyExtras)}
          className="w-full bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition-colors"
        >
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </button>
    </form>
  )
}

type PushState = 'loading' | 'unsupported' | 'on' | 'off'

export function NotificationsToggle() {
  const [state, setState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!pushSupported()) { if (!cancelled) setState('unsupported'); return }
      const sub = await getPushSubscription()
      if (!cancelled) setState(sub ? 'on' : 'off')
    })()
    return () => { cancelled = true }
  }, [])

  async function toggle(on: boolean) {
    setError(null)
    setBusy(true)
    try {
      if (on) { await subscribeToPush();   setState('on') }
      else    { await unsubscribeFromPush(); setState('off') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update notifications.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return null

  if (state === 'unsupported') {
    return (
      <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-2" aria-label="Push Notifications">
        <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Push Notifications</h2>
        <p className="text-sm text-blue-900 font-medium">
          Your device doesn't support push notifications in this browser.
          On iPhone/iPad, install FunDivers to your Home Screen
          (Share → Add to Home Screen), open the app from there, and the toggle will appear.
        </p>
      </section>
    )
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3" aria-label="Push Notifications">
      <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Push Notifications</h2>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm text-blue-900">Event &amp; payment reminders</span>
        <input
          type="checkbox"
          aria-label="Enable push notifications"
          className="accent-blue-900 scale-125"
          disabled={busy}
          checked={state === 'on'}
          onChange={(e) => toggle(e.target.checked)}
        />
      </label>
      <p className="text-xs text-blue-950 font-medium">
        Reminders fire 1 week and 1 day before each event, plus payment nudges
        at 3 / 2 / 1 weeks and 3 / 1 days before. iOS requires installing the
        app to your Home Screen.
      </p>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </section>
  )
}

export function CertCardSection({ userId }: { userId: string }) {
  const [path, setPath] = useState<string | null>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load current path from the profile + refresh signed URL when it changes.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('cert_card_path')
        .eq('id', userId)
        .maybeSingle()
      if (cancelled) return
      const p = data?.cert_card_path ?? null
      setPath(p)
      setSignedUrl(p ? await getCertCardSignedUrl(p) : null)
    })()
    return () => { cancelled = true }
  }, [userId])

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const newPath = await uploadCertCard(userId, file)
      if (path && path !== newPath) {
        // Best-effort cleanup of the previous version.
        try { await deleteCertCard(path) } catch { /* ignore */ }
      }
      await supabase.from('profiles').update({ cert_card_path: newPath }).eq('id', userId)
      setPath(newPath)
      setSignedUrl(await getCertCardSignedUrl(newPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      await deleteCertCard(path)
      await supabase.from('profiles').update({ cert_card_path: null }).eq('id', userId)
      setPath(null)
      setSignedUrl(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3" aria-label="Certification Card">
      <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Cert card photo</h2>
      <p className="text-xs text-blue-900 font-medium">
        Photo of your certification card. Images are compressed before upload
        so they take up minimal space while keeping the key details readable.
      </p>
      {signedUrl && (
        <img
          src={signedUrl}
          alt="Your certification card"
          className="w-full rounded-lg border border-sky-300"
        />
      )}
      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-lg text-center transition-colors">
          <input
            type="file"
            accept="image/*"
            aria-label="Upload certification card"
            className="hidden"
            disabled={busy}
            onChange={onPickFile}
          />
          {busy ? 'Working…' : path ? 'Replace photo' : 'Upload photo'}
        </label>
        {path && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="bg-sky-100 hover:bg-red-100 disabled:opacity-40 text-red-700 border border-red-500 text-sm font-semibold py-2 px-3 rounded-lg transition-colors"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </section>
  )
}
