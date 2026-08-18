/**
 * Almanac page — crowdsourced environmental observations for events.
 *
 * Divers can submit observations (air/water temp, visibility, current,
 * weather, wildlife, coral health, mountaineering details). Staff/admin
 * can approve or reject pending records. Approved records appear on the
 * event detail and the almanac page.
 *
 * The page shows:
 * 1. A summary card of approved observations (averages, counts)
 * 2. A form to submit a new observation
 * 3. A list of past events with their observations
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { t } from '../i18n'
import {
  ALMANAC_CURRENT_STRENGTHS,
  ALMANAC_WEATHERS,
  ALMANAC_CORAL_HEALTHS,
  ALMANAC_ROUTE_CONDITIONS,
  type AlmanacCurrentStrength,
  type AlmanacWeather,
  type AlmanacCoralHealth,
  type AlmanacRouteCondition,
  type AlmanacEventRecord,
} from '../types/database'
import {
  usesDateEnvelope,
  type EventKind,
} from '../lib/event-kinds'
import { fetchEventsInRange, formatEventSpan, isPastEvent } from '../lib/events'
import { todayIso, addIsoDays } from '../lib/dates'
import { supabase } from '../lib/supabase'
import {
  CARD,
  TEXT_BODY,
  TEXT_SUBTLE,
  TEXT_HEADING,
} from '../styles/tokens'
import { CalendarIcon } from '../components/icons/CalendarIcon'
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon'
import { ChevronUpIcon } from '../components/icons/ChevronUpIcon'

// ─── Types ───────────────────────────────────────────────────────────────────

interface EventWithObservations {
  id: string
  title: string
  start_time: string
  kind: EventKind
  is_past: boolean
  observations: AlmanacEventRecord[]
}

interface AlmanacFormState {
  event_id: string
  obs_date: string
  air_temp_c: string
  water_temp_c: string
  visibility_m: string
  current_strength: AlmanacCurrentStrength | ''
  wave_height_m: string
  wave_period_s: string
  weather: AlmanacWeather | ''
  wildlife: string
  coral_health: AlmanacCoralHealth | ''
  elevation_m: string
  route_condition: AlmanacRouteCondition | ''
  summit_visible: boolean | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const emptyForm: AlmanacFormState = {
  event_id: '',
  obs_date: '',
  air_temp_c: '',
  water_temp_c: '',
  visibility_m: '',
  current_strength: '',
  wave_height_m: '',
  wave_period_s: '',
  weather: '',
  wildlife: '',
  coral_health: '',
  elevation_m: '',
  route_condition: '',
  summit_visible: null,
}

function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function parseNum(v: string): number | null {
  if (!v) return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function formatNum(v: number | null, decimals: number = 1): string {
  return v === null ? '—' : v.toFixed(decimals)
}

function formatEventDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Single observation row in the historical list. */
function ObservationRow({
  record,
  diverName,
  diverNickname,
}: {
  record: AlmanacEventRecord
  diverName: string | null
  diverNickname: string | null
}) {
  const label = diverNickname
    ? `${diverName} · ${t.almanac.recordsFromNickname(diverName)}`
    : t.almanac.recordsFrom(diverName ?? '—')

  return (
    <div className={`${CARD} border border-white/10 rounded-lg p-3`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs ${TEXT_SUBTLE}`}>
          {t.almanac.recordsDate(localDate(new Date(record.obs_date)))}
        </span>
        <span className={`text-[10px] uppercase tracking-wide ${TEXT_SUBTLE}`}>
          {label}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {record.air_temp_c !== null && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.airTemp}</span>
            <span>{formatNum(record.air_temp_c, 1)}°C</span>
          </>
        )}
        {record.water_temp_c !== null && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.waterTemp}</span>
            <span>{formatNum(record.water_temp_c, 1)}°C</span>
          </>
        )}
        {record.visibility_m !== null && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.visibility}</span>
            <span>{formatNum(record.visibility_m, 1)}m</span>
          </>
        )}
        {record.current_strength && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.current}</span>
            <span>{t.almanac.currentStrengths[record.current_strength as AlmanacCurrentStrength]}</span>
          </>
        )}
        {record.weather && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.weather}</span>
            <span>{t.almanac.weathers[record.weather as AlmanacWeather]}</span>
          </>
        )}
        {record.wave_height_m !== null && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.waveHeight}</span>
            <span>{formatNum(record.wave_height_m, 1)}m</span>
          </>
        )}
        {record.coral_health && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.coralHealth}</span>
            <span>{t.almanac.coralHealths[record.coral_health as AlmanacCoralHealth]}</span>
          </>
        )}
        {record.wildlife && record.wildlife.length > 0 && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.wildlife}</span>
            <span>{record.wildlife.join(', ')}</span>
          </>
        )}
        {record.elevation_m !== null && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.elevation}</span>
            <span>{record.elevation_m}m</span>
          </>
        )}
        {record.route_condition && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.routeCondition}</span>
            <span>{t.almanac.routeConditions[record.route_condition as AlmanacRouteCondition]}</span>
          </>
        )}
        {record.summit_visible !== null && (
          <>
            <span className={TEXT_SUBTLE}>{t.almanac.summitVisible}</span>
            <span>{record.summit_visible ? '✓' : '✗'}</span>
          </>
        )}
      </div>
    </div>
  )
}

/** Summary statistics for a set of approved observations. */
function ObservationSummary({ records }: { records: AlmanacEventRecord[] }) {
  if (records.length === 0) return null

  const airTemps = records.map(r => r.air_temp_c).filter((v): v is number => v !== null)
  const waterTemps = records.map(r => r.water_temp_c).filter((v): v is number => v !== null)
  const visibilities = records.map(r => r.visibility_m).filter((v): v is number => v !== null)

  return (
    <div className={`${CARD} border border-white/10 rounded-lg p-3`}>
      <h4 className={`text-xs font-semibold ${TEXT_HEADING}`}>
        {t.almanac.recordsHeading}
      </h4>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        {airTemps.length > 0 && (
          <div>
            <div className={TEXT_SUBTLE}>{t.almanac.airTemp}</div>
            <div className={`font-semibold ${TEXT_BODY}`}>
              {formatNum(airTemps.reduce((a, b) => a + b, 0) / airTemps.length, 1)}°C
            </div>
          </div>
        )}
        {waterTemps.length > 0 && (
          <div>
            <div className={TEXT_SUBTLE}>{t.almanac.waterTemp}</div>
            <div className={`font-semibold ${TEXT_BODY}`}>
              {formatNum(waterTemps.reduce((a, b) => a + b, 0) / waterTemps.length, 1)}°C
            </div>
          </div>
        )}
        {visibilities.length > 0 && (
          <div>
            <div className={TEXT_SUBTLE}>{t.almanac.visibility}</div>
            <div className={`font-semibold ${TEXT_BODY}`}>
              {formatNum(visibilities.reduce((a, b) => a + b, 0) / visibilities.length, 1)}m
            </div>
          </div>
        )}
      </div>
      <div className={`mt-1 text-center text-[10px] ${TEXT_SUBTLE}`}>
        {records.length} observation{records.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

/** Collapsible event card showing its observations. */
function EventCard({
  event,
}: {
  event: EventWithObservations
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`${CARD} border border-white/10 rounded-lg`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex w-full items-center justify-between gap-2 p-3 text-left transition-colors hover:bg-gray-50`}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <CalendarIcon />
          <div>
            <div className={`text-sm font-medium ${TEXT_BODY}`}>{event.title}</div>
            <div className={`text-xs ${TEXT_SUBTLE}`}>
              {formatEventSpan({
                start_time: event.start_time,
                end_time: null,
                start_time_hhmm: null,
              }, { style: 'short' })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
            event.observations.length > 0
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {event.observations.length}
          </span>
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </div>
      </button>
      {expanded && (
        <div className="border-t px-3 pb-3">
          <ObservationSummary records={event.observations} />
          <div className="mt-2 space-y-2">
            {event.observations.map(r => (
              <ObservationRow
                key={r.id}
                record={r}
                diverName={r.diver_name}
                diverNickname={r.diver_nickname}
              />
            ))}
            {event.observations.length === 0 && (
              <div className={`py-4 text-center text-sm ${TEXT_SUBTLE}`}>
                {t.almanac.recordsNoneForEvent}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Form for submitting a new almanac observation. */
function AlmanacForm({
  events,
  profile,
  onSubmit,
}: {
  events: EventWithObservations[]
  profile: { role: string } | null
  onSubmit: (form: AlmanacFormState) => Promise<void>
}) {
  const [form, setForm] = useState<AlmanacFormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isStaff = profile?.role === 'staff' || profile?.role === 'admin'

  const updateField = (field: keyof AlmanacFormState, value: string | boolean | null) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.obs_date) {
      setError(t.almanac.obsDateRequired)
      return
    }
    if (!form.event_id) {
      setError(t.almanac.submitFailed)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(form)
      setForm(emptyForm)
    } catch {
      setError(t.almanac.submitFailed)
    } finally {
      setSubmitting(false)
    }
  }

  const handleClear = () => {
    setForm(emptyForm)
    setError(null)
  }

  const selectClass = `w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm ${TEXT_BODY} focus:border-brand-500 focus:outline-none`
  const inputClass = `w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm ${TEXT_BODY} focus:border-brand-500 focus:outline-none`

  return (
    <form onSubmit={handleSubmit} className={`${CARD} border border-white/10 rounded-lg p-4`}>
      <h3 className={`text-sm font-semibold ${TEXT_HEADING}`}>
        {t.almanac.submit}
      </h3>

      {/* Event selector */}
      <div className="mt-3">
        <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>
          {t.almanac.title} {isStaff ? `(${t.almanac.moderation})` : ''}
        </label>
        <select
          value={form.event_id}
          onChange={e => updateField('event_id', e.target.value)}
          className={selectClass}
        >
          <option value="">{t.almanac.noRecordsYet}</option>
          {events
            .filter(ev => ev.is_past)
            .map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.title} ({formatEventDate(new Date(ev.start_time))})
              </option>
            ))}
        </select>
      </div>

      {/* Date */}
      <div className="mt-3">
        <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>
          {t.almanac.obsDate}
        </label>
        <input
          type="date"
          value={form.obs_date}
          onChange={e => updateField('obs_date', e.target.value)}
          className={inputClass}
          required
        />
      </div>

      {/* Temperature & visibility — 3-up on desktop */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.airTemp}</label>
          <input
            type="number"
            step="0.1"
            placeholder={t.almanac.airTempPh}
            value={form.air_temp_c}
            onChange={e => updateField('air_temp_c', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.waterTemp}</label>
          <input
            type="number"
            step="0.1"
            placeholder={t.almanac.waterTempPh}
            value={form.water_temp_c}
            onChange={e => updateField('water_temp_c', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.visibility}</label>
          <input
            type="number"
            step="0.1"
            placeholder={t.almanac.visibilityPh}
            value={form.visibility_m}
            onChange={e => updateField('visibility_m', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Current & Weather */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.current}</label>
          <select
            value={form.current_strength}
            onChange={e => updateField('current_strength', e.target.value as AlmanacCurrentStrength | '')}
            className={selectClass}
          >
            <option value="">—</option>
            {ALMANAC_CURRENT_STRENGTHS.map(s => (
              <option key={s} value={s}>{t.almanac.currentStrengths[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.weather}</label>
          <select
            value={form.weather}
            onChange={e => updateField('weather', e.target.value as AlmanacWeather | '')}
            className={selectClass}
          >
            <option value="">—</option>
            {ALMANAC_WEATHERS.map(w => (
              <option key={w} value={w}>{t.almanac.weathers[w]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Wave height & period */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.waveHeight}</label>
          <input
            type="number"
            step="0.1"
            placeholder={t.almanac.waveHeightPh}
            value={form.wave_height_m}
            onChange={e => updateField('wave_height_m', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.wavePeriod}</label>
          <input
            type="number"
            step="0.1"
            placeholder={t.almanac.wavePeriodPh}
            value={form.wave_period_s}
            onChange={e => updateField('wave_period_s', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Coral health */}
      <div className="mt-3">
        <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.coralHealth}</label>
        <select
          value={form.coral_health}
          onChange={e => updateField('coral_health', e.target.value as AlmanacCoralHealth | '')}
          className={selectClass}
        >
          <option value="">—</option>
          {ALMANAC_CORAL_HEALTHS.map(c => (
            <option key={c} value={c}>{t.almanac.coralHealths[c]}</option>
          ))}
        </select>
      </div>

      {/* Wildlife */}
      <div className="mt-3">
        <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.wildlife}</label>
        <input
          type="text"
          placeholder="e.g. turtle, manta ray, whale shark"
          value={form.wildlife}
          onChange={e => updateField('wildlife', e.target.value)}
          className={inputClass}
        />
      </div>

      {/* Adventure fields — only show for adventure events */}
      {form.event_id && (() => {
        const selectedEvent = events.find(ev => ev.id === form.event_id)
        if (!selectedEvent || !usesDateEnvelope(selectedEvent.kind)) return null
        if (selectedEvent.kind !== 'adventure') return null
        return (
          <>
            <div className="mt-4 border-t pt-3">
              <h4 className={`text-xs font-semibold ${TEXT_HEADING}`}>
                {t.almanac.title} — {t.calendar.typeAdventure}
              </h4>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.elevation}</label>
                <input
                  type="number"
                  placeholder={t.almanac.elevationPh}
                  value={form.elevation_m}
                  onChange={e => updateField('elevation_m', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={`mb-1 block text-xs ${TEXT_SUBTLE}`}>{t.almanac.routeCondition}</label>
                <select
                  value={form.route_condition}
                  onChange={e => updateField('route_condition', e.target.value as AlmanacRouteCondition | '')}
                  className={selectClass}
                >
                  <option value="">—</option>
                  {ALMANAC_ROUTE_CONDITIONS.map(rc => (
                    <option key={rc} value={rc}>{t.almanac.routeConditions[rc]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.summit_visible === true}
                  onChange={e => updateField('summit_visible', e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className={`text-xs ${TEXT_BODY}`}>{t.almanac.summitVisible}</span>
              </label>
            </div>
          </>
        )
      })()}

      {/* Error & actions */}
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-600">
          {error}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className={`flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50`}
        >
          {submitting ? t.almanac.submitting : t.almanac.submitRecord}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className={`rounded-lg border border-white/15 px-4 py-2 text-sm font-medium ${TEXT_BODY} transition-colors hover:bg-gray-50`}
        >
          {t.almanac.clearForm}
        </button>
      </div>
    </form>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function AlmanacPage() {
  const { user, profile, loading: authLoading } = useAuth()
  const [events, setEvents] = useState<EventWithObservations[]>([])
  const [loading, setLoading] = useState(true)
  const [submitStatus, setSubmitStatus] = useState<string | null>(null)

  // Fetch events with their almanac records
  useEffect(() => {
    if (!user) return

    const fetchAlmanac = async () => {
      setLoading(true)
      try {
        // Fetch recent events (past 30 days + upcoming 90 days)
        const from = addIsoDays(todayIso(), -30)
        const to = addIsoDays(todayIso(), 90)
        const eventsList = await fetchEventsInRange(from, to)

        const enriched: EventWithObservations[] = []

        // Fetch almanac records for each event (best-effort)
        for (const evt of eventsList) {
          const { data: records, error: recordsError } = await supabase
            .rpc('almanac_event_records', { p_event_id: evt.id })

          if (recordsError) {
            console.error('Failed to fetch almanac records:', recordsError)
            continue
          }

          enriched.push({
            id: evt.id,
            title: evt.title,
            start_time: evt.start_time,
            kind: evt.type,
            is_past: isPastEvent(evt),
            observations: (records as AlmanacEventRecord[]) || [],
          })
        }

        setEvents(enriched)
      } catch (err) {
        console.error('Failed to fetch almanac data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchAlmanac()
  }, [user])

  const handleSubmit = async (form: AlmanacFormState) => {
    if (!user) return

    try {
      await supabase.rpc('submit_almanac_record', {
        p_event_id: form.event_id,
        p_obs_date: form.obs_date,
        p_air_temp_c: parseNum(form.air_temp_c),
        p_water_temp_c: parseNum(form.water_temp_c),
        p_visibility_m: parseNum(form.visibility_m),
        p_current_strength: form.current_strength || null,
        p_wave_height_m: parseNum(form.wave_height_m),
        p_wave_period_s: parseNum(form.wave_period_s),
        p_weather: form.weather || null,
        p_wildlife: form.wildlife.trim()
          ? form.wildlife.split(',').map(s => s.trim()).filter(Boolean)
          : null,
        p_coral_health: form.coral_health || null,
        p_elevation_m: parseNum(form.elevation_m),
        p_route_condition: form.route_condition || null,
        p_summit_visible: form.summit_visible,
      })

      setSubmitStatus(t.almanac.submitted)
      setTimeout(() => setSubmitStatus(null), 3000)

      // Refresh the event list
      const { data: records } = await supabase.rpc('almanac_event_records', {
        p_event_id: form.event_id,
      })
      setEvents(prev =>
        prev.map(ev =>
          ev.id === form.event_id ? { ...ev, observations: records as AlmanacEventRecord[] } : ev
        )
      )
    } catch (err) {
      console.error('Failed to submit almanac record:', err)
      setSubmitStatus(t.almanac.submitFailed)
      setTimeout(() => setSubmitStatus(null), 3000)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className={`text-sm ${TEXT_SUBTLE}`}>Loading almanac…</div>
      </div>
    )
  }

  return (
    <div className="relative -m-4 min-h-[calc(100vh-3rem)] overflow-hidden">
      <div className="relative z-10 mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-6 pb-28">
        {/* Header */}
        <div>
          <h1 className={`text-xl font-bold ${TEXT_HEADING}`}>{t.almanac.title}</h1>
          <p className={`mt-1 text-sm ${TEXT_SUBTLE}`}>{t.almanac.blurb}</p>
        </div>

        {/* Submit form */}
        <AlmanacForm
          events={events}
          profile={profile}
          onSubmit={handleSubmit}
        />

        {/* Submit status */}
        {submitStatus && (
          <div className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">
            {submitStatus}
          </div>
        )}

        {/* Historical events */}
        <div>
          <h2 className={`mb-2 text-sm font-semibold ${TEXT_HEADING}`}>
            {t.almanac.recordsHeading}
          </h2>
          {events.length === 0 ? (
            <div className={`rounded-lg ${CARD} p-4 text-center text-sm ${TEXT_SUBTLE}`}>
              {t.almanac.noRecordsYet}
            </div>
          ) : (
            <div className="space-y-2">
              {events
                .filter(ev => ev.is_past)
                .map(ev => (
                  <EventCard key={ev.id} event={ev} />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
