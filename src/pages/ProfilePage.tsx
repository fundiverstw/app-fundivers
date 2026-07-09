import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { pushSupported, getPushSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/push'
import { GEAR_ITEMS } from '../lib/gear'
import { numOrNull } from '../lib/num'
import { uploadCertCard, getCertCardSignedUrl, deleteCertCard } from '../lib/cert-card'
import { uploadNitroxCard, getNitroxCardSignedUrl, deleteNitroxCard } from '../lib/nitrox-card'
import { uploadDeepCard, getDeepCardSignedUrl, deleteDeepCard } from '../lib/deep-card'
import { isHeicFile } from '../lib/image-compress'
import { fetchDiverCreditBalance } from '../lib/credits'
import { FamilySection } from '../components/profile/FamilySection'
import { MyWaivers } from '../components/profile/MyWaivers'
import { siteConfig } from '../config/site'
import { DateField } from '../components/DateField'
import type { Profile, CertLevel } from '../types/database'
import { ShoeSizeField } from '../components/ShoeSizeField'
import { t } from '../i18n'

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
  name: z.string().min(1, t.profile.required),
  nickname: z.string().nullish(),
  date_of_birth: z.string().min(1, t.profile.required),
  nationality: z.string().min(1, t.profile.required),
  id_number: z.string().nullish(),
  emergency_contact_name: z.string().nullish(),
  emergency_contact_phone: z.string().nullish(),
  cert_status: z.enum(['certified', 'uncertified'], { message: t.profile.chooseOne }),
  cert_agency: z.string().nullish(),
  cert_level: z.string().nullish(),
  medical_notes: z.string().nullish(),
  height_cm: z.union([z.string(), z.number()]).nullish(),
  weight_kg: z.union([z.string(), z.number()]).nullish(),
  gender: z.string().min(1, t.profile.required),
  contact_method: z.string().min(1, t.profile.required),
  contact_id: z.string().min(1, t.profile.required),
  nitrox_certified: z.boolean().nullish(),
  deep_certified: z.boolean().nullish(),
  logged_dives: z
    .union([z.string(), z.number()])
    .refine(v => typeof v === 'number' || v.length > 0, { message: t.profile.required }),
  last_dive_date: z.string().nullish(),
}).superRefine((data, ctx) => {
  // A certified diver must name their level; an uncertified one leaves it blank.
  if (data.cert_status === 'certified' && !(data.cert_level ?? '').trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cert_level'], message: t.profile.required })
  }
})
type FormData = z.infer<typeof schema>

function strOrNull(v: unknown): string | null {
  if (v === '' || v === null || v === undefined) return null
  return String(v)
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-brand-900 font-medium mb-1 uppercase tracking-wide">
        {label}
        {required && <span className="text-red-600 ml-0.5" aria-label={t.profile.requiredAria}>*</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass = 'w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 text-sm focus:outline-none focus:border-brand-900'

export function ProfilePage() {
  const { user, profile } = useAuth()

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-white">{t.profile.title}</h1>
      {user && <CreditBalanceLine userId={user.id} />}
      <NotificationsToggle />
      {user && profile && (
        // Keying on profile.id remounts the form whenever a different
        // profile loads, so all initial state is computed lazily from
        // props at mount — no sync-state-from-prop effect needed.
        <>
          <ProfileForm key={profile.id} user={user} profile={profile} />
          <MyWaivers diverId={profile.id} />
          <FamilySection parent={profile} />
        </>
      )}
    </div>
  )
}

// Compact "you have a credit on file" panel. Hidden when the balance is
// 0 so it doesn't add visual noise to the common case. The diver-facing
// PaymentsPage shows a richer version of this; here it's a quick reminder
// so the balance is visible from anywhere in the app.
function CreditBalanceLine({ userId }: { userId: string }) {
  const [balance, setBalance] = useState<number>(0)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Includes awarded credits AND overpayments — any money the shop owes.
        const owed = await fetchDiverCreditBalance(userId)
        if (!cancelled) setBalance(owed)
      } catch {
        /* best-effort — silent on failure */
      }
    })()
    return () => { cancelled = true }
  }, [userId])
  if (balance <= 0) return null
  return (
    <div className="bg-emerald-50 border border-emerald-400 rounded-lg p-3 text-sm text-emerald-900">
      {t.profile.creditPrefix} <strong>{siteConfig.locale.currencyLabel} {balance.toLocaleString()}</strong> {t.profile.creditSuffix}
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
    defaultValues: {
      ...(profile as unknown as FormData),
      // Derive the cert-status choice: an explicit uncertified flag wins;
      // otherwise an existing cert_level means certified; a fresh profile
      // (neither) starts unchosen so the diver is forced to pick.
      cert_status: profile.uncertified
        ? 'uncertified'
        : (profile.cert_level ? 'certified' : (undefined as unknown as 'certified')),
    },
  })

  const [gearOwned, setGearOwned] = useState<string[]>(
    () => Array.isArray(profile.gear_owned) ? [...profile.gear_owned] : []
  )
  // Mirror of profiles.nitrox_card_path. Owned here so the Save button can
  // gate on it (nitrox_certified=true requires a card on file); the
  // NitroxCardSection component pushes path updates up via onPathChange
  // whenever the user uploads / removes a photo.
  const [nitroxCardPath, setNitroxCardPath] = useState<string | null>(profile.nitrox_card_path ?? null)
  // Same lift-pattern for the Deep (40m) card.
  const [deepCardPath, setDeepCardPath] = useState<string | null>(profile.deep_card_path ?? null)
  // Same lift-pattern for the main cert card: cert_level set ⇒ a photo
  // must be on file. Initial value comes from the profile so a diver who
  // has already uploaded one isn't blocked the moment they open the page.
  const [certCardPath, setCertCardPath] = useState<string | null>(profile.cert_card_path ?? null)
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
  const nitroxCertifiedWatched = useWatch({ control, name: 'nitrox_certified' }) ?? false
  const nitroxCardMissing = !!nitroxCertifiedWatched && !nitroxCardPath
  const deepCertifiedWatched = useWatch({ control, name: 'deep_certified' }) ?? false
  const deepCardMissing = !!deepCertifiedWatched && !deepCardPath
  const certStatus = useWatch({ control, name: 'cert_status' }) as 'certified' | 'uncertified' | undefined
  const isCertified = certStatus === 'certified'
  // A certified diver must have a cert-card photo on file; an uncertified one
  // never does.
  const certCardMissing = isCertified && !certCardPath
  // Distinct orgs in the order returned by the rank-sorted query (PADI rows
  // come first because they're the seed; agency rows follow). Always
  // include the saved agency so the dropdown can render it even before the
  // cert_levels fetch completes — and so the option's React key stays
  // stable across the fetch transition. Without the dedup-and-prepend,
  // the saved agency would briefly render as a no-key legacy fallback
  // then get remounted as a keyed orgs.map child, and the brief absence
  // of a matching <option> drops the (uncontrolled) select's value to "".
  const orgs = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of certLevels) {
      if (!seen.has(c.organization)) { seen.add(c.organization); out.push(c.organization) }
    }
    if (profile.cert_agency && !seen.has(profile.cert_agency)) {
      out.unshift(profile.cert_agency)
    }
    return out
  }, [certLevels, profile.cert_agency])
  // Same stable-key story as `orgs`: include the saved level when it
  // matches the selected agency. Dedup against the real list so the
  // dropdown doesn't show two "Rescue"s. The synthetic id satisfies the
  // CertLevel type and is otherwise unused — the <option>'s React key
  // is the level *name* (unique within a single-agency filter), and
  // keying by name is what keeps the DOM node stable across the
  // empty → fetched transition.
  const filteredLevels = useMemo(() => {
    const matched = certLevels.filter(c => c.organization === selectedAgency)
    const saved = profile.cert_level
    if (
      saved
      && profile.cert_agency === selectedAgency
      && !matched.some(c => c.name === saved)
    ) {
      return [
        { id: '__saved_level__', organization: selectedAgency, name: saved, rank: -1 },
        ...matched,
      ] as CertLevel[]
    }
    return matched
  }, [certLevels, selectedAgency, profile.cert_agency, profile.cert_level])

  // Canonical shoe size ('' = unset); the ShoeSizeField below owns the
  // unit/gender/value picker and reports the canonical string up.
  const [shoeSize, setShoeSize] = useState<string>(profile.shoe_size ?? '')
  const [dirtyExtras, setDirtyExtras] = useState(false)

  function toggleGearOwned(item: string) {
    setGearOwned(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])
    setDirtyExtras(true)
  }

  async function onSubmit(data: FormData) {
    if (!user) return
    const method = data.contact_method
    const shoeSizeCanonical = shoeSize.trim() || null
    // Update, not upsert: the row is created by handle_new_user at signup,
    // and there is no INSERT policy on profiles — upsert hits the INSERT
    // RLS check and 403s even when only updating an existing row.
    const { error } = await supabase.from('profiles').update({
      name: data.name,
      nickname: strOrNull(data.nickname),
      date_of_birth: strOrNull(data.date_of_birth),
      nationality: strOrNull(data.nationality),
      id_number: strOrNull(data.id_number),
      emergency_contact_name: strOrNull(data.emergency_contact_name),
      emergency_contact_phone: strOrNull(data.emergency_contact_phone),
      uncertified: data.cert_status === 'uncertified',
      cert_agency: data.cert_status === 'uncertified' ? null : strOrNull(data.cert_agency),
      cert_level: data.cert_status === 'uncertified' ? null : strOrNull(data.cert_level),
      medical_notes: strOrNull(data.medical_notes),
      height_cm: numOrNull(data.height_cm),
      weight_kg: numOrNull(data.weight_kg),
      shoe_size: shoeSizeCanonical,
      gender: strOrNull(data.gender),
      contact_method: (method === 'whatsapp' || method === 'line' || method === 'phone' || method === 'email') ? method : null,
      contact_id: strOrNull(data.contact_id),
      nitrox_certified: Boolean(data.nitrox_certified),
      deep_certified: Boolean(data.deep_certified),
      logged_dives: numOrNull(data.logged_dives) ?? 0,
      last_dive_date: strOrNull(data.last_dive_date),
      gear_owned: gearOwned,
      updated_at: new Date().toISOString(),
    }).eq('id', profile.id)
    if (error) {
      toast.error(t.profile.saveError(error.message))
      return
    }
    reset(data)
    setDirtyExtras(false)
    toast.success(t.profile.saved)
    onSaved?.()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.personalInfo}</h2>
          <Field label={t.profile.nameLabel} required>
            <input {...register('name')} className={inputClass} />
            <p className="text-xs text-brand-900/70 mt-1">
              {t.profile.nameHint}
            </p>
            {errors.name && <p className="text-red-600 text-xs mt-1">{errors.name.message}</p>}
          </Field>
          <Field label={t.profile.nicknameLabel}>
            <input
              {...register('nickname')}
              className={inputClass}
              placeholder={t.profile.nicknamePlaceholder}
            />
            {errors.nickname && <p className="text-red-600 text-xs mt-1">{errors.nickname.message}</p>}
          </Field>
          <Field label={t.profile.dobLabel} required>
            <Controller
              control={control}
              name="date_of_birth"
              render={({ field }) => (
                <DateField value={field.value ?? ''} onChange={field.onChange} className={inputClass} />
              )}
            />
            {errors.date_of_birth && <p className="text-red-600 text-xs mt-1">{errors.date_of_birth.message}</p>}
          </Field>
          <Field label={t.profile.nationalityLabel} required>
            <input {...register('nationality')} className={inputClass} />
            {errors.nationality && <p className="text-red-600 text-xs mt-1">{errors.nationality.message}</p>}
          </Field>
          <Field label={t.profile.idPassportLabel}><input {...register('id_number')} className={inputClass} /></Field>
          <Field label={t.profile.genderLabel} required>
            <select {...register('gender')} className={inputClass}>
              <option value="">—</option>
              <option value="female">{t.register.genderFemale}</option>
              <option value="male">{t.register.genderMale}</option>
              <option value="other">{t.register.genderOther}</option>
              <option value="prefer_not_to_say">{t.register.genderPreferNot}</option>
            </select>
            {errors.gender && <p className="text-red-600 text-xs mt-1">{errors.gender.message}</p>}
          </Field>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.preferredContact}</h2>
          <Field label={t.profile.methodLabel} required>
            <select
              {...register('contact_method', { onChange: () => setDirtyExtras(true) })}
              className={inputClass}
            >
              <option value="">—</option>
              <option value="whatsapp">{t.profile.contactMethod.whatsapp}</option>
              <option value="line">{t.profile.contactMethod.line}</option>
              <option value="phone">{t.profile.contactMethod.phone}</option>
              <option value="email">{t.profile.contactMethod.email}</option>
            </select>
            {errors.contact_method && <p className="text-red-600 text-xs mt-1">{errors.contact_method.message}</p>}
          </Field>
          <Field label={t.profile.handleLabel} required>
            <input
              {...register('contact_id', { onChange: () => setDirtyExtras(true) })}
              className={inputClass}
              placeholder={t.profile.contactHandlePlaceholder}
            />
            {errors.contact_id && <p className="text-red-600 text-xs mt-1">{errors.contact_id.message}</p>}
          </Field>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.sizing}</h2>
          <Field label={t.profile.heightCm}><input {...register('height_cm')} type="number" step="0.1" className={inputClass} /></Field>
          <Field label={t.profile.weightKg}><input {...register('weight_kg')} type="number" step="0.1" className={inputClass} /></Field>
          <div>
            <label className="block text-xs text-brand-900 font-medium mb-1 uppercase tracking-wide">{t.profile.shoeSize}</label>
            <ShoeSizeField
              initial={profile.shoe_size}
              onChange={c => { setShoeSize(c); setDirtyExtras(true) }}
            />
          </div>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.gearIOwn}</h2>
          <p className="text-xs text-brand-900 font-medium">
            {t.profile.gearOwnedHint}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {GEAR_ITEMS.map(item => (
              <label key={item} className="flex items-center gap-2 text-sm text-brand-900">
                <input
                  type="checkbox"
                  checked={gearOwned.includes(item)}
                  onChange={() => toggleGearOwned(item)}
                  className="accent-brand-900"
                />
                {item}
              </label>
            ))}
          </div>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.emergencyContact}</h2>
          <Field label={t.profile.nameLabel}><input {...register('emergency_contact_name')} className={inputClass} /></Field>
          <Field label={t.profile.phoneLabel}><input {...register('emergency_contact_phone')} type="tel" className={inputClass} /></Field>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.certification}</h2>
          <Field label={t.profile.certStatusLabel} required>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-brand-900">
                <input type="radio" value="certified" {...register('cert_status')} className="accent-brand-900" />
                {t.profile.haveCert}
              </label>
              <label className="flex items-center gap-2 text-sm text-brand-900">
                <input type="radio" value="uncertified" {...register('cert_status')} className="accent-brand-900" />
                {t.profile.uncertified}
              </label>
            </div>
            {errors.cert_status && <p className="text-red-600 text-xs mt-1">{errors.cert_status.message}</p>}
          </Field>

          {isCertified && (
            <>
              <Field label={t.profile.agencyLabel}>
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
                  <option value="">{t.profile.selectAgency}</option>
                  {orgs.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </Field>
              <Field label={t.profile.levelLabel} required>
                <select {...register('cert_level')} className={inputClass} disabled={!selectedAgency}>
                  <option value="">{selectedAgency ? t.profile.selectLevel : t.profile.pickAgencyFirst}</option>
                  {/* Keyed by name (unique inside a single-agency filter), not
                       by row id. The id swaps from the synthetic __saved_level__
                       to the real DB id once cert_levels fetches, and a key swap
                       would remount the option mid-transition — see filteredLevels
                       comment above. */}
                  {filteredLevels.map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
                {errors.cert_level && <p className="text-red-600 text-xs mt-1">{errors.cert_level.message}</p>}
              </Field>
            </>
          )}
          <Field label={t.profile.loggedDives} required>
            <input {...register('logged_dives')} type="number" min="0" className={inputClass} />
            {errors.logged_dives && <p className="text-red-600 text-xs mt-1">{errors.logged_dives.message}</p>}
          </Field>
          <Field label={t.profile.lastDive}>
            <Controller
              control={control}
              name="last_dive_date"
              render={({ field }) => (
                <DateField value={field.value ?? ''} onChange={field.onChange} className={inputClass} />
              )}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" {...register('nitrox_certified')} className="accent-brand-900" />
            {t.profile.nitroxCertified}
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" {...register('deep_certified')} className="accent-brand-900" />
            {t.profile.deepCertified}
          </label>
        </section>

        {nitroxCertifiedWatched && (
          <NitroxCardSection userId={profile.id} onPathChange={setNitroxCardPath} />
        )}

        {deepCertifiedWatched && (
          <DeepCardSection userId={profile.id} onPathChange={setDeepCardPath} />
        )}

        {isCertified && (
          <CertCardSection userId={profile.id} onPathChange={setCertCardPath} />
        )}

        <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.medicalNotes}</h2>
          <textarea
            {...register('medical_notes')}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder={t.profile.medicalNotesPlaceholder}
          />
        </section>

        {certCardMissing && (
          <p className="text-xs text-red-700 bg-red-50 border border-accent rounded p-2">
            {t.profile.certCardRequired}
          </p>
        )}

        {nitroxCardMissing && (
          <p className="text-xs text-red-700 bg-red-50 border border-accent rounded p-2">
            {t.profile.nitroxCardRequired}
          </p>
        )}

        {deepCardMissing && (
          <p className="text-xs text-red-700 bg-red-50 border border-accent rounded p-2">
            {t.profile.deepCardRequired}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !certStatus || certCardMissing || nitroxCardMissing || deepCardMissing || (!isDirty && !dirtyExtras)}
          className="w-full bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSubmitting ? t.profile.saving : t.profile.saveChanges}
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
      setError(e instanceof Error ? e.message : t.profile.notifications.failed)
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return null

  if (state === 'unsupported') {
    return (
      <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2" aria-label={t.profile.notifications.title}>
        <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.notifications.title}</h2>
        <p className="text-sm text-brand-900 font-medium">
          {t.profile.notifications.unsupported(siteConfig.identity.shortName)}
        </p>
      </section>
    )
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3" aria-label={t.profile.notifications.title}>
      <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.notifications.title}</h2>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm text-brand-900">{t.profile.notifications.reminders}</span>
        <input
          type="checkbox"
          aria-label={t.profile.notifications.enable}
          className="accent-brand-900 scale-125"
          disabled={busy}
          checked={state === 'on'}
          onChange={(e) => toggle(e.target.checked)}
        />
      </label>
      <p className="text-xs text-brand-950 font-medium">
        {t.profile.notifications.remindersDetail}
      </p>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </section>
  )
}

export function CertCardSection({ userId, onPathChange }: {
  userId: string
  /** Optional callback that fires whenever the stored path changes
   *  (load, upload, remove). ProfileForm uses it to gate the Save button
   *  on cert_level ⇒ photo present. */
  onPathChange?: (path: string | null) => void
}) {
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
      onPathChange?.(p)
      setSignedUrl(p ? await getCertCardSignedUrl(p) : null)
    })()
    return () => { cancelled = true }
  // onPathChange intentionally excluded — parent passes a fresh setter
  // each render; including it would re-fetch on every parent update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (!file.type.startsWith('image/') && !isHeicFile(file)) {
      setError(t.profile.cards.chooseImage)
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
      onPathChange?.(newPath)
      setSignedUrl(await getCertCardSignedUrl(newPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.profile.cards.uploadFailed)
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
      onPathChange?.(null)
      setSignedUrl(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.profile.cards.removeFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3" aria-label={t.profile.cards.certAria}>
      <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.cards.certTitle}</h2>
      <p className="text-xs text-brand-900 font-medium">
        {t.profile.cards.certHint}
      </p>
      {signedUrl && (
        <img
          src={signedUrl}
          alt={t.profile.cards.certAlt}
          className="w-full rounded-lg border border-surface-300"
        />
      )}
      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-lg text-center transition-colors">
          <input
            type="file"
            accept="image/*,.heic,.heif"
            aria-label={t.profile.cards.certUpload}
            className="hidden"
            disabled={busy}
            onChange={onPickFile}
          />
          {busy ? t.profile.cards.working : path ? t.profile.cards.replacePhoto : t.profile.cards.uploadPhoto}
        </label>
        {path && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="bg-surface-100 hover:bg-red-100 disabled:opacity-40 text-red-700 border border-accent text-sm font-semibold py-2 px-3 rounded-lg transition-colors"
          >
            {t.profile.cards.remove}
          </button>
        )}
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </section>
  )
}

// Same upload pattern as CertCardSection but for the nitrox-cards bucket.
// onPathChange lifts the current path up so ProfileForm can gate the Save
// button on nitrox_certified ⇒ photo present.
export function NitroxCardSection({ userId, onPathChange }: {
  userId: string
  onPathChange?: (path: string | null) => void
}) {
  const [path, setPath] = useState<string | null>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('nitrox_card_path')
        .eq('id', userId)
        .maybeSingle()
      if (cancelled) return
      const p = data?.nitrox_card_path ?? null
      setPath(p)
      onPathChange?.(p)
      setSignedUrl(p ? await getNitroxCardSignedUrl(p) : null)
    })()
    return () => { cancelled = true }
  // onPathChange intentionally excluded — parent passes a fresh setter each
  // render; including it would re-fetch on every parent update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') && !isHeicFile(file)) {
      setError(t.profile.cards.chooseImage)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const newPath = await uploadNitroxCard(userId, file)
      if (path && path !== newPath) {
        try { await deleteNitroxCard(path) } catch { /* ignore */ }
      }
      await supabase.from('profiles').update({ nitrox_card_path: newPath }).eq('id', userId)
      setPath(newPath)
      onPathChange?.(newPath)
      setSignedUrl(await getNitroxCardSignedUrl(newPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.profile.cards.uploadFailed)
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      await deleteNitroxCard(path)
      await supabase.from('profiles').update({ nitrox_card_path: null }).eq('id', userId)
      setPath(null)
      onPathChange?.(null)
      setSignedUrl(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.profile.cards.removeFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3" aria-label={t.profile.cards.nitroxAria}>
      <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.cards.nitroxTitle}</h2>
      <p className="text-xs text-brand-900 font-medium">
        {t.profile.cards.nitroxHint}
      </p>
      {signedUrl && (
        <img
          src={signedUrl}
          alt={t.profile.cards.nitroxAlt}
          className="w-full rounded-lg border border-surface-300"
        />
      )}
      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-lg text-center transition-colors">
          <input
            type="file"
            accept="image/*,.heic,.heif"
            aria-label={t.profile.cards.nitroxUpload}
            className="hidden"
            disabled={busy}
            onChange={onPickFile}
          />
          {busy ? t.profile.cards.working : path ? t.profile.cards.replacePhoto : t.profile.cards.uploadPhoto}
        </label>
        {path && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="bg-surface-100 hover:bg-red-100 disabled:opacity-40 text-red-700 border border-accent text-sm font-semibold py-2 px-3 rounded-lg transition-colors"
          >
            {t.profile.cards.remove}
          </button>
        )}
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </section>
  )
}

// Same upload pattern as NitroxCardSection but for the deep-cards bucket.
export function DeepCardSection({ userId, onPathChange }: {
  userId: string
  onPathChange?: (path: string | null) => void
}) {
  const [path, setPath] = useState<string | null>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('deep_card_path')
        .eq('id', userId)
        .maybeSingle()
      if (cancelled) return
      const p = data?.deep_card_path ?? null
      setPath(p)
      onPathChange?.(p)
      setSignedUrl(p ? await getDeepCardSignedUrl(p) : null)
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') && !isHeicFile(file)) {
      setError(t.profile.cards.chooseImage)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const newPath = await uploadDeepCard(userId, file)
      if (path && path !== newPath) {
        try { await deleteDeepCard(path) } catch { /* ignore */ }
      }
      await supabase.from('profiles').update({ deep_card_path: newPath }).eq('id', userId)
      setPath(newPath)
      onPathChange?.(newPath)
      setSignedUrl(await getDeepCardSignedUrl(newPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.profile.cards.uploadFailed)
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      await deleteDeepCard(path)
      await supabase.from('profiles').update({ deep_card_path: null }).eq('id', userId)
      setPath(null)
      onPathChange?.(null)
      setSignedUrl(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.profile.cards.removeFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3" aria-label={t.profile.cards.deepAria}>
      <h2 className="text-sm font-semibold text-brand-900 uppercase tracking-wider">{t.profile.cards.deepTitle}</h2>
      <p className="text-xs text-brand-900 font-medium">
        {t.profile.cards.deepHint}
      </p>
      {signedUrl && (
        <img
          src={signedUrl}
          alt={t.profile.cards.deepAlt}
          className="w-full rounded-lg border border-surface-300"
        />
      )}
      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-lg text-center transition-colors">
          <input
            type="file"
            accept="image/*,.heic,.heif"
            aria-label={t.profile.cards.deepUpload}
            className="hidden"
            disabled={busy}
            onChange={onPickFile}
          />
          {busy ? t.profile.cards.working : path ? t.profile.cards.replacePhoto : t.profile.cards.uploadPhoto}
        </label>
        {path && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="bg-surface-100 hover:bg-red-100 disabled:opacity-40 text-red-700 border border-accent text-sm font-semibold py-2 px-3 rounded-lg transition-colors"
          >
            {t.profile.cards.remove}
          </button>
        )}
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </section>
  )
}
