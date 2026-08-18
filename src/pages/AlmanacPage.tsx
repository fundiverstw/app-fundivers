/**
 * Almanac — crowdsourced environmental observations attached to past events.
 *
 * A diver files what they saw on the day (temperatures, visibility, current,
 * weather, wildlife, coral, and terrain readings for the kinds that climb);
 * staff rule on each submission; approved records are what the crowd reads.
 *
 * The three sections mirror those three roles: the review queue (staff only),
 * the submission form, and the approved history grouped by event.
 */
import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
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
  type AlmanacStatus,
  type AlmanacEventRecord,
  type AlmanacPendingRecord,
} from '../types/database'
import { hasTerrainConditions, type EventKind } from '../lib/event-kinds'
import { fetchEventsInRange, formatEventSpan, isPastEvent } from '../lib/events'
import { todayIso, addIsoDays, parseIsoDate, shopDayIso } from '../lib/dates'
import { supabase } from '../lib/supabase'
import {
  CARD,
  TEXT_BODY,
  TEXT_SUBTLE,
  TEXT_HEADING,
  INPUT,
  INPUT_LABEL,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_XS_PRIMARY,
  BTN_XS_DANGER,
  ERROR_NOTE_LIGHT,
} from '../styles/tokens'
import { CalendarIcon } from '../components/icons/CalendarIcon'
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon'
import { ChevronUpIcon } from '../components/icons/ChevronUpIcon'

// How far back the page looks. Only past events can be observed, so there is
// no reason to fetch the upcoming half of the calendar at all.
const LOOKBACK_DAYS = 90

interface PastEvent {
  id: string
  title: string
  start_time: string
  end_time: string | null
  start_time_hhmm: string | null
  kind: EventKind
  observations: AlmanacEventRecord[]
}

/** A submission of the signed-in diver's that the crowd cannot see yet. */
interface OwnSubmission {
  id: string
  event_id: string
  obs_date: string
  status: AlmanacStatus
  staff_notes: string | null
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
  summit_visible: boolean
}

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
  summit_visible: false,
}

function parseNum(v: string): number | null {
  if (!v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function formatNum(v: number | null, decimals = 1): string {
  return v === null ? '—' : v.toFixed(decimals)
}

/** A `date` column rendered as the day it stores, not a UTC-shifted one. */
function formatObsDate(iso: string): string {
  return format(parseIsoDate(iso), 'MMM d, yyyy')
}

function parseWildlife(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

// ─── Readings ────────────────────────────────────────────────────────────────

/** The readings a record carries, as label/value pairs — blank ones dropped. */
type Reading = { label: string; value: string }

function readingsOf(record: AlmanacEventRecord | AlmanacPendingRecord): Reading[] {
  const readings: Reading[] = []
  const push = (label: string, value: string | null) => {
    if (value !== null) readings.push({ label, value })
  }
  push(t.almanac.airTemp, record.air_temp_c === null ? null : `${formatNum(record.air_temp_c)}°C`)
  push(t.almanac.waterTemp, record.water_temp_c === null ? null : `${formatNum(record.water_temp_c)}°C`)
  push(t.almanac.visibility, record.visibility_m === null ? null : `${formatNum(record.visibility_m)}m`)
  push(t.almanac.current, record.current_strength && t.almanac.currentStrengths[record.current_strength])
  push(t.almanac.weather, record.weather && t.almanac.weathers[record.weather])
  push(t.almanac.waveHeight, record.wave_height_m === null ? null : `${formatNum(record.wave_height_m)}m`)
  push(t.almanac.wavePeriod, record.wave_period_s === null ? null : `${formatNum(record.wave_period_s)}s`)
  push(t.almanac.coralHealth, record.coral_health && t.almanac.coralHealths[record.coral_health])
  push(t.almanac.wildlife, record.wildlife?.length ? record.wildlife.join(', ') : null)
  push(t.almanac.elevation, record.elevation_m === null ? null : `${record.elevation_m}m`)
  push(t.almanac.routeCondition, record.route_condition && t.almanac.routeConditions[record.route_condition])
  push(t.almanac.summitVisible, record.summit_visible === null
    ? null
    : record.summit_visible ? t.almanac.yes : t.almanac.no)
  return readings
}

function ReadingGrid({ readings }: { readings: Reading[] }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {readings.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt className={TEXT_SUBTLE}>{label}</dt>
          <dd className={TEXT_BODY}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ─── Approved history ────────────────────────────────────────────────────────

function ObservationRow({ record }: { record: AlmanacEventRecord }) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${TEXT_SUBTLE}`}>{formatObsDate(record.obs_date)}</span>
        <span className={`text-[10px] uppercase tracking-wide ${TEXT_SUBTLE}`}>
          {t.almanac.recordsFrom(record.diver_display ?? '—')}
        </span>
      </div>
      <ReadingGrid readings={readingsOf(record)} />
    </div>
  )
}

/** Averages across an event's approved observations. */
function ObservationSummary({ records }: { records: AlmanacEventRecord[] }) {
  const mean = (values: (number | null)[]): number | null => {
    const present = values.filter((v): v is number => v !== null)
    return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length
  }
  const averages: Reading[] = []
  const airTemp = mean(records.map(r => r.air_temp_c))
  const waterTemp = mean(records.map(r => r.water_temp_c))
  const visibility = mean(records.map(r => r.visibility_m))
  if (airTemp !== null) averages.push({ label: t.almanac.airTemp, value: `${formatNum(airTemp)}°C` })
  if (waterTemp !== null) averages.push({ label: t.almanac.waterTemp, value: `${formatNum(waterTemp)}°C` })
  if (visibility !== null) averages.push({ label: t.almanac.visibility, value: `${formatNum(visibility)}m` })
  if (averages.length === 0) return null

  return (
    <div className="rounded-lg border border-white/10 p-3">
      <h4 className={`text-xs ${TEXT_HEADING}`}>{t.almanac.averages}</h4>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        {averages.map(({ label, value }) => (
          <div key={label}>
            <div className={TEXT_SUBTLE}>{label}</div>
            <div className={`font-semibold ${TEXT_BODY}`}>{value}</div>
          </div>
        ))}
      </div>
      <div className={`mt-1 text-center text-[10px] ${TEXT_SUBTLE}`}>
        {t.almanac.observationCount(records.length)}
      </div>
    </div>
  )
}

function EventCard({ event }: { event: PastEvent }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <CalendarIcon />
          <div>
            <div className={`text-sm ${TEXT_BODY}`}>{event.title}</div>
            <div className={`text-xs ${TEXT_SUBTLE}`}>
              {formatEventSpan(event, { style: 'short' })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            event.observations.length > 0
              ? 'bg-emerald-500/20 text-emerald-200'
              : `bg-white/10 ${TEXT_SUBTLE}`
          }`}>
            {event.observations.length}
          </span>
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </div>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-white/10 px-3 pt-3 pb-3">
          <ObservationSummary records={event.observations} />
          {event.observations.map(r => <ObservationRow key={r.id} record={r} />)}
          {event.observations.length === 0 && (
            <div className={`py-4 text-center text-sm ${TEXT_SUBTLE}`}>
              {t.almanac.recordsNoneForEvent}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Staff review queue ──────────────────────────────────────────────────────

function ModerationQueue({
  records,
  onModerate,
}: {
  records: AlmanacPendingRecord[]
  onModerate: (id: string, status: 'approved' | 'rejected', notes: string) => Promise<void>
}) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rule = async (id: string, status: 'approved' | 'rejected') => {
    setBusyId(id)
    setError(null)
    try {
      await onModerate(id, status, notes[id] ?? '')
    } catch {
      setError(t.almanac.moderationFailed)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className={`${CARD} p-4`}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>
        {t.almanac.moderation} ({records.length})
      </h2>
      {error && <p className={`mt-2 ${ERROR_NOTE_LIGHT}`}>{error}</p>}
      {records.length === 0 ? (
        <p className={`mt-2 text-sm ${TEXT_SUBTLE}`}>{t.almanac.queueEmpty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {records.map(record => (
            <li key={record.id} className="rounded-lg border border-white/10 p-3">
              <div className={`text-sm ${TEXT_BODY}`}>{record.event_title ?? '—'}</div>
              <div className={`text-xs ${TEXT_SUBTLE}`}>
                {formatObsDate(record.obs_date)} · {t.almanac.recordsFrom(record.diver_display ?? '—')}
              </div>
              <ReadingGrid readings={readingsOf(record)} />
              <label className="mt-3 block">
                <span className={INPUT_LABEL}>{t.almanac.staffNotes}</span>
                <input
                  type="text"
                  className={INPUT}
                  value={notes[record.id] ?? ''}
                  onChange={e => setNotes(prev => ({ ...prev, [record.id]: e.target.value }))}
                />
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={BTN_XS_PRIMARY}
                  disabled={busyId === record.id}
                  onClick={() => rule(record.id, 'approved')}
                >
                  {t.almanac.approve}
                </button>
                <button
                  type="button"
                  className={BTN_XS_DANGER}
                  disabled={busyId === record.id}
                  onClick={() => rule(record.id, 'rejected')}
                >
                  {t.almanac.reject}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── Submission form ─────────────────────────────────────────────────────────

function AlmanacForm({
  events,
  onSubmit,
}: {
  events: PastEvent[]
  onSubmit: (form: AlmanacFormState) => Promise<void>
}) {
  const [form, setForm] = useState<AlmanacFormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const updateField = <K extends keyof AlmanacFormState>(field: K, value: AlmanacFormState[K]) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
  }

  // Picking the event fills the date with the day it ran — the answer the
  // diver would have typed by hand almost every time.
  const selectEvent = (eventId: string) => {
    const picked = events.find(ev => ev.id === eventId)
    setForm(prev => ({
      ...prev,
      event_id: eventId,
      obs_date: picked ? shopDayIso(picked.start_time) : '',
    }))
    setError(null)
  }

  const selectedEvent = events.find(ev => ev.id === form.event_id)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.event_id) {
      setError(t.almanac.eventRequired)
      return
    }
    if (!form.obs_date) {
      setError(t.almanac.obsDateRequired)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(form)
      setForm(emptyForm)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.almanac.submitFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} p-4`}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>{t.almanac.submit}</h2>

      <label className="mt-3 block">
        <span className={INPUT_LABEL}>{t.almanac.event}</span>
        <select className={INPUT} value={form.event_id} onChange={e => selectEvent(e.target.value)}>
          <option value="">{t.almanac.eventPlaceholder}</option>
          {events.map(ev => (
            <option key={ev.id} value={ev.id}>
              {ev.title} — {formatEventSpan(ev, { style: 'compact' })}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className={INPUT_LABEL}>{t.almanac.obsDate}</span>
        <input
          type="date"
          className={INPUT}
          max={todayIso()}
          value={form.obs_date}
          onChange={e => updateField('obs_date', e.target.value)}
        />
      </label>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={INPUT_LABEL}>{t.almanac.airTemp}</span>
          <input
            type="number" step="any" className={INPUT}
            placeholder={t.almanac.airTempPh}
            value={form.air_temp_c}
            onChange={e => updateField('air_temp_c', e.target.value)}
          />
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{t.almanac.waterTemp}</span>
          <input
            type="number" step="any" className={INPUT}
            placeholder={t.almanac.waterTempPh}
            value={form.water_temp_c}
            onChange={e => updateField('water_temp_c', e.target.value)}
          />
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{t.almanac.visibility}</span>
          <input
            type="number" step="any" className={INPUT}
            placeholder={t.almanac.visibilityPh}
            value={form.visibility_m}
            onChange={e => updateField('visibility_m', e.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={INPUT_LABEL}>{t.almanac.current}</span>
          <select
            className={INPUT}
            value={form.current_strength}
            onChange={e => updateField('current_strength', e.target.value as AlmanacCurrentStrength | '')}
          >
            <option value="">—</option>
            {ALMANAC_CURRENT_STRENGTHS.map(s => (
              <option key={s} value={s}>{t.almanac.currentStrengths[s]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{t.almanac.weather}</span>
          <select
            className={INPUT}
            value={form.weather}
            onChange={e => updateField('weather', e.target.value as AlmanacWeather | '')}
          >
            <option value="">—</option>
            {ALMANAC_WEATHERS.map(w => (
              <option key={w} value={w}>{t.almanac.weathers[w]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={INPUT_LABEL}>{t.almanac.waveHeight}</span>
          <input
            type="number" step="any" className={INPUT}
            placeholder={t.almanac.waveHeightPh}
            value={form.wave_height_m}
            onChange={e => updateField('wave_height_m', e.target.value)}
          />
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{t.almanac.wavePeriod}</span>
          <input
            type="number" step="any" className={INPUT}
            placeholder={t.almanac.wavePeriodPh}
            value={form.wave_period_s}
            onChange={e => updateField('wave_period_s', e.target.value)}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className={INPUT_LABEL}>{t.almanac.coralHealth}</span>
        <select
          className={INPUT}
          value={form.coral_health}
          onChange={e => updateField('coral_health', e.target.value as AlmanacCoralHealth | '')}
        >
          <option value="">—</option>
          {ALMANAC_CORAL_HEALTHS.map(c => (
            <option key={c} value={c}>{t.almanac.coralHealths[c]}</option>
          ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className={INPUT_LABEL}>{t.almanac.wildlife}</span>
        <input
          type="text" className={INPUT}
          placeholder={t.almanac.wildlifePh}
          value={form.wildlife}
          onChange={e => updateField('wildlife', e.target.value)}
        />
      </label>

      {selectedEvent && hasTerrainConditions(selectedEvent.kind) && (
        <>
          <h3 className={`mt-4 border-t border-white/10 pt-3 text-xs ${TEXT_HEADING}`}>
            {t.almanac.terrainHeading}
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={INPUT_LABEL}>{t.almanac.elevation}</span>
              <input
                type="number" step="1" className={INPUT}
                placeholder={t.almanac.elevationPh}
                value={form.elevation_m}
                onChange={e => updateField('elevation_m', e.target.value)}
              />
            </label>
            <label className="block">
              <span className={INPUT_LABEL}>{t.almanac.routeCondition}</span>
              <select
                className={INPUT}
                value={form.route_condition}
                onChange={e => updateField('route_condition', e.target.value as AlmanacRouteCondition | '')}
              >
                <option value="">—</option>
                {ALMANAC_ROUTE_CONDITIONS.map(rc => (
                  <option key={rc} value={rc}>{t.almanac.routeConditions[rc]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={form.summit_visible}
              onChange={e => updateField('summit_visible', e.target.checked)}
            />
            <span className={`text-sm ${TEXT_BODY}`}>{t.almanac.summitVisible}</span>
          </label>
        </>
      )}

      {error && <p className={`mt-3 ${ERROR_NOTE_LIGHT}`}>{error}</p>}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={submitting} className={`flex-1 ${BTN_PRIMARY}`}>
          {submitting ? t.almanac.submitting : t.almanac.submitRecord}
        </button>
        <button
          type="button"
          className={`px-4 ${BTN_SECONDARY}`}
          onClick={() => { setForm(emptyForm); setError(null) }}
        >
          {t.almanac.clearForm}
        </button>
      </div>
    </form>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AlmanacStatus, string> = {
  pending: t.almanac.statusPending,
  approved: t.almanac.statusApproved,
  rejected: t.almanac.statusRejected,
}

export function AlmanacPage() {
  const { user, profile, loading: authLoading } = useAuth()
  const [events, setEvents] = useState<PastEvent[]>([])
  const [ownSubmissions, setOwnSubmissions] = useState<OwnSubmission[]>([])
  const [pending, setPending] = useState<AlmanacPendingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitStatus, setSubmitStatus] = useState<string | null>(null)

  const isStaff = profile?.role === 'staff' || profile?.role === 'admin'
  // The id, not the object: an auth context that hands back a fresh user
  // object each render would otherwise re-run the whole load on every render.
  const userId = user?.id ?? null

  const loadQueue = useCallback(async () => {
    if (!isStaff) return
    const { data, error } = await supabase.rpc('almanac_pending_records')
    // Thrown rather than logged: a staff member whose queue failed to load
    // would otherwise see an empty queue and read it as "nothing to review".
    if (error) throw error
    setPending(data ?? [])
  }, [isStaff])

  const loadOwnSubmissions = useCallback(async () => {
    if (!userId) return
    // Approved records already show in the history below; this list exists to
    // tell a diver about the ones the crowd cannot see yet.
    const { data, error } = await supabase
      .from('almanac_records')
      .select('id, event_id, obs_date, status, staff_notes')
      .eq('diver_id', userId)
      .neq('status', 'approved')
      .order('obs_date', { ascending: false })
    if (error) {
      console.error('Failed to load your almanac submissions:', error)
      return
    }
    setOwnSubmissions(data ?? [])
  }, [userId])

  const loadEvents = useCallback(async () => {
    const today = todayIso()
    const past = (await fetchEventsInRange(addIsoDays(today, -LOOKBACK_DAYS), today))
      .filter(ev => isPastEvent(ev))
    if (past.length === 0) {
      setEvents([])
      return
    }
    const { data, error } = await supabase.rpc('almanac_records_for_events', {
      p_event_ids: past.map(ev => ev.id),
    })
    if (error) throw error
    const byEvent = new Map<string, AlmanacEventRecord[]>()
    for (const record of data ?? []) {
      const bucket = byEvent.get(record.event_id)
      if (bucket) bucket.push(record)
      else byEvent.set(record.event_id, [record])
    }
    setEvents(past
      .map(ev => ({
        id: ev.id,
        title: ev.title,
        start_time: ev.start_time,
        end_time: ev.end_time,
        start_time_hhmm: ev.start_time_hhmm,
        kind: ev.type,
        observations: byEvent.get(ev.id) ?? [],
      }))
      .sort((a, b) => b.start_time.localeCompare(a.start_time)))
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        await Promise.all([loadEvents(), loadOwnSubmissions(), loadQueue()])
      } catch (err) {
        console.error('Failed to load the almanac:', err)
        if (!cancelled) setLoadError(t.almanac.recordsFailed)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId, loadEvents, loadOwnSubmissions, loadQueue])

  const handleSubmit = async (form: AlmanacFormState) => {
    const selected = events.find(ev => ev.id === form.event_id)
    const terrain = selected ? hasTerrainConditions(selected.kind) : false
    const { error } = await supabase.rpc('submit_almanac_record', {
      p_event_id: form.event_id,
      p_obs_date: form.obs_date,
      p_air_temp_c: parseNum(form.air_temp_c),
      p_water_temp_c: parseNum(form.water_temp_c),
      p_visibility_m: parseNum(form.visibility_m),
      p_current_strength: form.current_strength || null,
      p_wave_height_m: parseNum(form.wave_height_m),
      p_wave_period_s: parseNum(form.wave_period_s),
      p_weather: form.weather || null,
      p_wildlife: parseWildlife(form.wildlife),
      p_coral_health: form.coral_health || null,
      p_elevation_m: terrain ? parseNum(form.elevation_m) : null,
      p_route_condition: terrain ? form.route_condition || null : null,
      p_summit_visible: terrain ? form.summit_visible : null,
    })
    if (error) {
      console.error('Failed to submit the almanac record:', error)
      throw new Error(error.message.includes('almanac_record_already_reviewed')
        ? t.almanac.submitAlreadyReviewed
        : t.almanac.submitFailed)
    }
    setSubmitStatus(t.almanac.submitted)
    await loadOwnSubmissions()
  }

  const handleModerate = async (id: string, status: 'approved' | 'rejected', notes: string) => {
    const { error } = await supabase.rpc('moderate_almanac_record', {
      p_record_id: id,
      p_status: status,
      p_staff_notes: notes.trim() || null,
    })
    if (error) throw error
    await Promise.all([loadQueue(), loadEvents()])
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className={`text-sm ${TEXT_SUBTLE}`}>{t.almanac.recordsLoading}</p>
      </div>
    )
  }

  const eventsWithRecords = events.filter(ev => ev.observations.length > 0)

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-2 pb-8">
      <header>
        <h1 className={`text-xl ${TEXT_HEADING}`}>{t.almanac.title}</h1>
        <p className={`mt-1 text-sm ${TEXT_SUBTLE}`}>{t.almanac.blurb}</p>
      </header>

      {loadError && <p className={ERROR_NOTE_LIGHT}>{loadError}</p>}

      {isStaff && !loadError && <ModerationQueue records={pending} onModerate={handleModerate} />}

      {events.length === 0 ? (
        <p className={`${CARD} p-4 text-center text-sm ${TEXT_SUBTLE}`}>{t.almanac.noPastEvents}</p>
      ) : (
        <AlmanacForm events={events} onSubmit={handleSubmit} />
      )}

      {submitStatus && (
        <p className="rounded-lg bg-emerald-500/15 p-2 text-center text-xs text-emerald-200">
          {submitStatus}
        </p>
      )}

      {ownSubmissions.length > 0 && (
        <section>
          <h2 className={`mb-2 text-sm ${TEXT_HEADING}`}>{t.almanac.yourSubmissions}</h2>
          <ul className="space-y-2">
            {ownSubmissions.map(sub => (
              <li key={sub.id} className={`${CARD} flex items-center justify-between gap-2 p-3`}>
                <div>
                  <div className={`text-sm ${TEXT_BODY}`}>
                    {events.find(ev => ev.id === sub.event_id)?.title ?? '—'}
                  </div>
                  <div className={`text-xs ${TEXT_SUBTLE}`}>
                    {formatObsDate(sub.obs_date)}
                    {sub.staff_notes ? ` · ${sub.staff_notes}` : ''}
                  </div>
                </div>
                <span className={`text-[10px] uppercase tracking-wide ${TEXT_SUBTLE}`}>
                  {STATUS_LABEL[sub.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className={`mb-2 text-sm ${TEXT_HEADING}`}>{t.almanac.recordsHeading}</h2>
        {eventsWithRecords.length === 0 ? (
          <p className={`${CARD} p-4 text-center text-sm ${TEXT_SUBTLE}`}>{t.almanac.noRecordsYet}</p>
        ) : (
          <div className="space-y-2">
            {eventsWithRecords.map(ev => <EventCard key={ev.id} event={ev} />)}
          </div>
        )}
      </section>
    </div>
  )
}
