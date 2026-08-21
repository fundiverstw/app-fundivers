/**
 * Coral surveys — structured coral-condition monitoring against the CoralWatch
 * Coral Health Chart.
 *
 * Distinct from the almanac's single `coral_health` field, which asks one diver
 * once per site-day how the coral looked. A survey records a set of colonies,
 * each matched to the printed chart at its palest and its darkest shade, with
 * the depth, water temperature and time of day the match was made under.
 *
 * Three sections, mirroring the three roles: the review queue (staff only), the
 * submission form, and the approved history.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { t } from '../i18n'
import {
  CORAL_HUES, CORAL_LEVELS, CORAL_TYPES, CORAL_SURVEY_METHODS, MAX_COLONIES,
  colonyProblem, colonyFromDraft, emptyColonyDraft, summarizeSurvey, headerProblem,
  type ColonyDraft, type CoralSurveyMethod, type CoralType,
} from '../lib/coral-survey'
import {
  submitCoralSurvey, fetchCoralSurveys, fetchPendingCoralSurveys, moderateCoralSurvey,
} from '../lib/coral-surveys'
import { fetchDiveSites } from '../lib/dive-sites'
import { todayIso, addIsoDays } from '../lib/dates'
import { numOrNull } from '../lib/num'
import type { CoralSurveyRow, DiveSite } from '../types/database'
import {
  CARD, TEXT_BODY, TEXT_SUBTLE, TEXT_HEADING, INPUT, INPUT_LABEL,
  BTN_PRIMARY, BTN_XS_PRIMARY, BTN_XS_GHOST, BTN_XS_DANGER, ERROR_NOTE_LIGHT,
} from '../styles/tokens'

const LOOKBACK_DAYS = 90

const tc = t.coral

const TYPE_LABEL: Record<CoralType, string> = {
  branching: tc.typeBranching,
  boulder: tc.typeBoulder,
  plate: tc.typePlate,
  soft: tc.typeSoft,
}

const METHOD_LABEL: Record<CoralSurveyMethod, string> = {
  random: tc.methodRandom,
  transect: tc.methodTransect,
  quadrat: tc.methodQuadrat,
}

interface SurveyFormState {
  site_id: string
  surveyed_on: string
  surveyed_at: string
  depth_m: string
  water_temp_c: string
  method: CoralSurveyMethod
  transect_length_m: string
  notes: string
  colonies: ColonyDraft[]
}

const blankForm = (): SurveyFormState => ({
  site_id: '',
  surveyed_on: todayIso(),
  surveyed_at: '',
  depth_m: '',
  water_temp_c: '',
  method: 'random',
  transect_length_m: '',
  notes: '',
  colonies: [emptyColonyDraft()],
})

/** The figures a survey reduces to, rendered the same way in the queue and the
 *  history so a staff member and a diver read the same summary. */
function SurveySummaryLine({ survey }: { survey: CoralSurveyRow }) {
  const summary = summarizeSurvey(survey.colonies)
  if (summary.count === 0) return null
  return (
    <p className={`text-xs ${TEXT_SUBTLE}`}>
      {tc.summaryColonies(summary.count)}
      {' · '}
      {tc.summaryMean(summary.meanScore!.toFixed(1))}
      {' · '}
      {tc.summaryBleached(summary.bleachedCount, Math.round(summary.bleachedFraction! * 100))}
    </p>
  )
}

function ColonyTable({ survey }: { survey: CoralSurveyRow }) {
  if (survey.colonies.length === 0) return null
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs table-fixed">
        <colgroup>
          <col className="w-10" />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-20" />
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr className={TEXT_SUBTLE}>
            <th className="text-left font-medium py-1">#</th>
            <th className="text-left font-medium py-1">{tc.coralType}</th>
            <th className="text-left font-medium py-1">{tc.lightest}</th>
            <th className="text-left font-medium py-1">{tc.darkest}</th>
            <th className="text-left font-medium py-1">{tc.diameter}</th>
          </tr>
        </thead>
        <tbody>
          {survey.colonies.map(colony => (
            <tr key={colony.ordinal} className={TEXT_BODY}>
              <td className="py-1">{colony.ordinal}</td>
              <td className="py-1">{TYPE_LABEL[colony.coral_type]}</td>
              <td className="py-1">{colony.lightest_hue}{colony.lightest_level}</td>
              <td className="py-1">{colony.darkest_hue}{colony.darkest_level}</td>
              <td className="py-1">{colony.diameter_cm == null ? '—' : `${colony.diameter_cm} cm`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SurveyHeaderLine({ survey }: { survey: CoralSurveyRow }) {
  const parts = [
    survey.surveyed_on,
    survey.surveyed_at ? survey.surveyed_at.slice(0, 5) : null,
    survey.depth_m == null ? null : `${survey.depth_m} m`,
    survey.water_temp_c == null ? null : `${survey.water_temp_c} °C`,
    METHOD_LABEL[survey.survey_method],
  ].filter(Boolean)
  return <p className={`text-xs ${TEXT_SUBTLE}`}>{parts.join(' · ')}</p>
}

/**
 * One survey as both lists show it. The queue passes its review controls as
 * children; the history passes none.
 */
function SurveyItem({ survey, children }: {
  survey: CoralSurveyRow
  children?: React.ReactNode
}) {
  return (
    <li className="border-t border-surface-200 pt-3 first:border-t-0 first:pt-0">
      <p className={`text-sm font-semibold ${TEXT_BODY}`}>
        {survey.site_name}
        {survey.diver_display ? ` — ${survey.diver_display}` : ''}
      </p>
      <SurveyHeaderLine survey={survey} />
      <SurveySummaryLine survey={survey} />
      <ColonyTable survey={survey} />
      {survey.notes && <p className={`text-xs ${TEXT_BODY} mt-1`}>{survey.notes}</p>}
      {children}
    </li>
  )
}

function ModerationQueue({
  surveys,
  onModerate,
}: {
  surveys: CoralSurveyRow[]
  onModerate: (id: string, status: 'approved' | 'rejected', notes: string) => Promise<void>
}) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rule = async (id: string, status: 'approved' | 'rejected') => {
    setBusy(id)
    setError(null)
    try {
      await onModerate(id, status, notes[id] ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : tc.moderateFailed)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={`${CARD} p-4`} aria-label={tc.queue}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>{tc.queue}</h2>
      {error && <p className={ERROR_NOTE_LIGHT}>{error}</p>}
      {surveys.length === 0 ? (
        <p className={`text-xs ${TEXT_SUBTLE} mt-2`}>{tc.queueEmpty}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {surveys.map(survey => (
            <SurveyItem key={survey.id} survey={survey}>
              <input
                className={`${INPUT} mt-2`}
                placeholder={tc.staffNotesPlaceholder}
                value={notes[survey.id] ?? ''}
                onChange={e => setNotes(prev => ({ ...prev, [survey.id]: e.target.value }))}
                aria-label={tc.staffNotesFor(survey.site_name)}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  className={BTN_XS_PRIMARY}
                  disabled={busy === survey.id}
                  onClick={() => rule(survey.id, 'approved')}
                >
                  {tc.approve}
                </button>
                <button
                  type="button"
                  className={BTN_XS_DANGER}
                  disabled={busy === survey.id}
                  onClick={() => rule(survey.id, 'rejected')}
                >
                  {tc.reject}
                </button>
              </div>
            </SurveyItem>
          ))}
        </ul>
      )}
    </section>
  )
}

function ColonyRow({
  draft,
  index,
  onChange,
  onRemove,
  removable,
}: {
  draft: ColonyDraft
  index: number
  onChange: (next: ColonyDraft) => void
  onRemove: () => void
  removable: boolean
}) {
  const set = <K extends keyof ColonyDraft>(field: K, value: ColonyDraft[K]) =>
    onChange({ ...draft, [field]: value })

  const label = tc.colonyN(index + 1)

  return (
    <li className="border-t border-surface-200 pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${TEXT_BODY}`}>{label}</span>
        {removable && (
          <button type="button" className={BTN_XS_GHOST} onClick={onRemove}>
            {tc.removeColony}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        <label className="block">
          <span className={INPUT_LABEL}>{tc.coralType}</span>
          <select
            className={INPUT}
            value={draft.coral_type}
            onChange={e => set('coral_type', e.target.value as CoralType | '')}
            aria-label={`${label} ${tc.coralType}`}
          >
            <option value="">{tc.choose}</option>
            {CORAL_TYPES.map(type => (
              <option key={type} value={type}>{TYPE_LABEL[type]}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={INPUT_LABEL}>{tc.diameter}</span>
          <input
            className={INPUT}
            type="number"
            step="any"
            inputMode="decimal"
            value={draft.diameter_cm}
            onChange={e => set('diameter_cm', e.target.value)}
            aria-label={`${label} ${tc.diameter}`}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        <label className="block">
          <span className={INPUT_LABEL}>{tc.lightestHue}</span>
          <select
            className={INPUT}
            value={draft.lightest_hue}
            onChange={e => set('lightest_hue', e.target.value as ColonyDraft['lightest_hue'])}
            aria-label={`${label} ${tc.lightestHue}`}
          >
            <option value="">{tc.choose}</option>
            {CORAL_HUES.map(hue => <option key={hue} value={hue}>{hue}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{tc.lightestLevel}</span>
          <select
            className={INPUT}
            value={draft.lightest_level}
            onChange={e => set('lightest_level', e.target.value)}
            aria-label={`${label} ${tc.lightestLevel}`}
          >
            <option value="">{tc.choose}</option>
            {CORAL_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{tc.darkestHue}</span>
          <select
            className={INPUT}
            value={draft.darkest_hue}
            onChange={e => set('darkest_hue', e.target.value as ColonyDraft['darkest_hue'])}
            aria-label={`${label} ${tc.darkestHue}`}
          >
            <option value="">{tc.choose}</option>
            {CORAL_HUES.map(hue => <option key={hue} value={hue}>{hue}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{tc.darkestLevel}</span>
          <select
            className={INPUT}
            value={draft.darkest_level}
            onChange={e => set('darkest_level', e.target.value)}
            aria-label={`${label} ${tc.darkestLevel}`}
          >
            <option value="">{tc.choose}</option>
            {CORAL_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
      </div>
    </li>
  )
}

function SurveyForm({
  sites,
  onSubmit,
}: {
  sites: DiveSite[]
  onSubmit: (form: SurveyFormState) => Promise<void>
}) {
  const [form, setForm] = useState<SurveyFormState>(blankForm)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const update = <K extends keyof SurveyFormState>(field: K, value: SurveyFormState[K]) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
    setSubmitted(false)
  }

  const setColony = (index: number, next: ColonyDraft) => {
    setForm(prev => ({
      ...prev,
      colonies: prev.colonies.map((c, i) => (i === index ? next : c)),
    }))
    setError(null)
    setSubmitted(false)
  }

  const addColony = () =>
    setForm(prev => prev.colonies.length >= MAX_COLONIES
      ? prev
      : { ...prev, colonies: [...prev.colonies, emptyColonyDraft()] })

  const removeColony = (index: number) =>
    setForm(prev => ({ ...prev, colonies: prev.colonies.filter((_, i) => i !== index) }))

  // A dive site, not an adventure location: coral is a question about reefs.
  const diveSites = sites.filter(site => site.active && site.kind === 'dive')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.site_id) { setError(tc.siteRequired); return }
    if (!form.surveyed_on) { setError(tc.dateRequired); return }

    const badField = headerProblem({
      depth_m: numOrNull(form.depth_m),
      water_temp_c: numOrNull(form.water_temp_c),
      transect_length_m: form.method === 'transect' ? numOrNull(form.transect_length_m) : null,
    })
    if (badField) {
      setError(
        badField === 'depth_m' ? tc.problemDepth
          : badField === 'water_temp_c' ? tc.problemWaterTemp
            : tc.problemTransectLength,
      )
      return
    }

    // Report the first bad row by number. "Something is wrong somewhere" in a
    // form of twenty colonies is not a message anybody can act on.
    for (const [index, draft] of form.colonies.entries()) {
      const problem = colonyProblem(draft)
      if (problem === null) continue
      const which = tc.colonyN(index + 1)
      setError(
        problem === 'shade_order' ? tc.problemShadeOrder(which)
          : problem === 'diameter' ? tc.problemDiameter(which)
            : tc.problemIncomplete(which),
      )
      return
    }

    setSubmitting(true)
    setError(null)
    setSubmitted(false)
    try {
      await onSubmit(form)
      setForm(blankForm())
      // A filed survey is pending, so it appears in neither the diver's
      // approved history nor (for a diver) the review queue. Without this the
      // form simply blanks itself, which reads as the submission being lost.
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : tc.submitFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} p-4`}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>{tc.submit}</h2>
      <p className={`text-xs ${TEXT_SUBTLE} mt-1`}>{tc.chartHint}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        <label className="block">
          <span className={INPUT_LABEL}>{tc.site}</span>
          <select
            className={INPUT}
            value={form.site_id}
            onChange={e => update('site_id', e.target.value)}
            aria-label={tc.site}
          >
            <option value="">{tc.choose}</option>
            {diveSites.map(site => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={INPUT_LABEL}>{tc.date}</span>
          <input
            className={INPUT}
            type="date"
            max={todayIso()}
            value={form.surveyed_on}
            onChange={e => update('surveyed_on', e.target.value)}
            aria-label={tc.date}
          />
        </label>

        <label className="block">
          <span className={INPUT_LABEL}>{tc.time}</span>
          <input
            className={INPUT}
            type="time"
            value={form.surveyed_at}
            onChange={e => update('surveyed_at', e.target.value)}
            aria-label={tc.time}
          />
        </label>

        <label className="block">
          <span className={INPUT_LABEL}>{tc.depth}</span>
          <input
            className={INPUT}
            type="number"
            step="any"
            inputMode="decimal"
            value={form.depth_m}
            onChange={e => update('depth_m', e.target.value)}
            aria-label={tc.depth}
          />
        </label>

        <label className="block">
          <span className={INPUT_LABEL}>{tc.waterTemp}</span>
          <input
            className={INPUT}
            type="number"
            step="any"
            inputMode="decimal"
            value={form.water_temp_c}
            onChange={e => update('water_temp_c', e.target.value)}
            aria-label={tc.waterTemp}
          />
        </label>

        <label className="block">
          <span className={INPUT_LABEL}>{tc.method}</span>
          <select
            className={INPUT}
            value={form.method}
            onChange={e => update('method', e.target.value as CoralSurveyMethod)}
            aria-label={tc.method}
          >
            {CORAL_SURVEY_METHODS.map(method => (
              <option key={method} value={method}>{METHOD_LABEL[method]}</option>
            ))}
          </select>
        </label>

        {form.method === 'transect' && (
          <label className="block">
            <span className={INPUT_LABEL}>{tc.transectLength}</span>
            <input
              className={INPUT}
              type="number"
              step="any"
              inputMode="decimal"
              value={form.transect_length_m}
              onChange={e => update('transect_length_m', e.target.value)}
              aria-label={tc.transectLength}
            />
          </label>
        )}
      </div>

      <h3 className={`text-xs ${TEXT_HEADING} mt-4`}>{tc.colonies}</h3>
      <p className={`text-xs ${TEXT_SUBTLE}`}>{tc.colonyBlurb}</p>
      <ul className="mt-2 space-y-3">
        {form.colonies.map((draft, index) => (
          <ColonyRow
            key={index}
            draft={draft}
            index={index}
            removable={form.colonies.length > 1}
            onChange={next => setColony(index, next)}
            onRemove={() => removeColony(index)}
          />
        ))}
      </ul>
      <button
        type="button"
        className={`${BTN_XS_GHOST} mt-2`}
        onClick={addColony}
        disabled={form.colonies.length >= MAX_COLONIES}
      >
        {tc.addColony}
      </button>

      <label className="block mt-3">
        <span className={INPUT_LABEL}>{tc.notes}</span>
        <textarea
          className={INPUT}
          rows={2}
          value={form.notes}
          onChange={e => update('notes', e.target.value)}
          aria-label={tc.notes}
        />
      </label>

      {error && <p className={ERROR_NOTE_LIGHT}>{error}</p>}
      {submitted && <p className={`text-xs ${TEXT_SUBTLE} mt-2`}>{tc.submitted}</p>}

      <button type="submit" className={`${BTN_PRIMARY} mt-3`} disabled={submitting}>
        {submitting ? tc.submitting : tc.submitButton}
      </button>
    </form>
  )
}

function HistoryList({ surveys }: { surveys: CoralSurveyRow[] }) {
  return (
    <section className={`${CARD} p-4`} aria-label={tc.history}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>{tc.history}</h2>
      {surveys.length === 0 ? (
        <p className={`text-xs ${TEXT_SUBTLE} mt-2`}>{tc.historyEmpty}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {surveys.map(survey => (
            <SurveyItem key={survey.id} survey={survey} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function CoralPage() {
  const { profile } = useAuth()
  const isStaff = profile?.role === 'staff' || profile?.role === 'admin'

  const [sites, setSites] = useState<DiveSite[]>([])
  const [approved, setApproved] = useState<CoralSurveyRow[]>([])
  const [pending, setPending] = useState<CoralSurveyRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadApproved = useCallback(async () => {
    const to = todayIso()
    setApproved(await fetchCoralSurveys(addIsoDays(to, -LOOKBACK_DAYS), to))
  }, [])

  // Staff-only RPC, so a diver never calls it at all.
  const loadPending = useCallback(async () => {
    if (!isStaff) return
    setPending(await fetchPendingCoralSurveys())
  }, [isStaff])

  const loadSites = useCallback(async () => {
    setSites(await fetchDiveSites())
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        await Promise.all([loadSites(), loadApproved(), loadPending()])
      } catch (err) {
        console.error('Failed to load coral surveys:', err)
        if (!cancelled) setLoadError(tc.loadFailed)
      }
    }
    load()
    return () => { cancelled = true }
  }, [loadSites, loadApproved, loadPending])

  const handleSubmit = async (form: SurveyFormState) => {
    const colonies = form.colonies
      .map(colonyFromDraft)
      .filter((c): c is NonNullable<typeof c> => c !== null)
    await submitCoralSurvey({
      siteId: form.site_id,
      surveyedOn: form.surveyed_on,
      colonies,
      surveyedAt: form.surveyed_at || null,
      depthM: numOrNull(form.depth_m),
      waterTempC: numOrNull(form.water_temp_c),
      method: form.method,
      transectLengthM: form.method === 'transect' ? numOrNull(form.transect_length_m) : null,
      notes: form.notes.trim() || null,
    })
    await loadPending()
  }

  const handleModerate = async (id: string, status: 'approved' | 'rejected', notes: string) => {
    await moderateCoralSurvey(id, status, notes.trim() || null)
    await Promise.all([loadPending(), loadApproved()])
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className={`text-lg ${TEXT_HEADING}`}>{tc.title}</h1>
        <p className={`text-xs ${TEXT_SUBTLE} mt-1`}>{tc.blurb}</p>
      </header>

      {loadError && <p className={ERROR_NOTE_LIGHT}>{loadError}</p>}

      {isStaff && <ModerationQueue surveys={pending} onModerate={handleModerate} />}

      <SurveyForm sites={sites} onSubmit={handleSubmit} />

      <HistoryList surveys={approved} />
    </div>
  )
}
