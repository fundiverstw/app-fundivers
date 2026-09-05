/**
 * Almanac — crowdsourced environmental observations attached to past events.
 *
 * A diver files what they saw on the day (temperatures, visibility, current,
 * weather, wildlife, coral, trash, and terrain readings for the kinds that
 * climb);
 * staff rule on each submission; approved records are what the crowd reads.
 *
 * The three sections mirror those three roles: the review queue (staff only),
 * the submission form, and the approved history grouped by event. Filing and
 * reading are opposite errands, so the form and the history are two tabs
 * rather than one long scroll; the queue sits above both, since a staff member
 * with something to rule on should not have to go looking for it.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { t } from '../i18n'
import {
  ALMANAC_CURRENT_STRENGTHS,
  ALMANAC_WEATHERS,
  ALMANAC_CORAL_HEALTHS,
  ALMANAC_ROUTE_CONDITIONS,
  ALMANAC_TRASH_BANDS,
  type AlmanacCurrentStrength,
  type AlmanacWeather,
  type AlmanacCoralHealth,
  type AlmanacRouteCondition,
  type AlmanacTrashBand,
  type AlmanacStatus,
  type AlmanacOwnRecord,
  type AlmanacEventRecord,
  type AlmanacPendingRecord,
  type DiveSite,
  type SiteKind,
} from '../types/database'
import { hasTerrainConditions, SITE_CONDITION_KINDS, type EventKind } from '../lib/event-kinds'
import {
  blankForm, formStateFrom, submitArgs, type AlmanacFormState,
} from '../lib/almanac-form'
import { EVENT_KIND_LABELS } from '../lib/event-kind-labels'
import { fetchDiveSites, siteName } from '../lib/dive-sites'
import { todayIso, addIsoDays, parseIsoDate } from '../lib/dates'
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
  BTN_XS_GHOST,
  BTN_XS_DANGER,
  ERROR_NOTE_LIGHT,
} from '../styles/tokens'
import { ReadingGrid } from '../components/almanac/ReadingGrid'
import { formatNum, readingsOf, type Reading } from '../lib/almanac-readings'
import { SiteDayReport } from '../components/almanac/SiteDayReport'
import { TrashKindPicker } from '../components/almanac/TrashKindPicker'
import { AddPlaceForm } from '../components/sites/AddPlaceForm'
import { CalendarIcon } from '../components/icons/CalendarIcon'
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon'
import { ChevronUpIcon } from '../components/icons/ChevronUpIcon'

// How much of the almanac's history the page reads back.
const LOOKBACK_DAYS = 90

const PILL = 'px-3 py-1.5 rounded-lg text-sm font-semibold'

const TRASH_HINT_ID = 'almanac-trash-amount-hint'


/** A `date` column rendered as the day it stores, not a UTC-shifted one. */
function formatObsDate(iso: string): string {
  return format(parseIsoDate(iso), 'MMM d, yyyy')
}

// ─── Approved history ────────────────────────────────────────────────────────

/** One calendar day's approved observations, from every site. */
interface ObservationDay {
  date: string
  records: AlmanacEventRecord[]
}

/**
 * Approved records bucketed by the day they describe, newest first.
 *
 * The almanac answers "what were conditions like on this date", so the day is
 * the unit — every site observed that day sits in one bucket, and each row
 * names its site.
 */
function daysOf(records: AlmanacEventRecord[]): ObservationDay[] {
  const byDate = new Map<string, AlmanacEventRecord[]>()
  for (const record of records) {
    const bucket = byDate.get(record.obs_date)
    if (bucket) bucket.push(record)
    else byDate.set(record.obs_date, [record])
  }
  return [...byDate.entries()]
    .map(([date, dayRecords]) => ({ date, records: dayRecords }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

function ObservationRow({ record }: { record: AlmanacEventRecord }) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${TEXT_BODY}`}>{record.site_name}</span>
        <span className={`text-[10px] uppercase tracking-wide ${TEXT_SUBTLE}`}>
          {t.almanac.recordsFrom(record.diver_display ?? '—')}
        </span>
      </div>
      <ReadingGrid readings={readingsOf(record)} />
    </div>
  )
}

/** Averages across one day's approved observations. */
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
    </div>
  )
}

function DayCard({ day }: { day: ObservationDay }) {
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
            <div className={`text-sm ${TEXT_BODY}`}>{formatObsDate(day.date)}</div>
            <div className={`text-xs ${TEXT_SUBTLE}`}>
              {t.almanac.observationCount(day.records.length)}
            </div>
          </div>
        </div>
        {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-white/10 px-3 pt-3 pb-3">
          <ObservationSummary records={day.records} />
          {day.records.map(r => <ObservationRow key={r.id} record={r} />)}
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
              <div className={`text-sm ${TEXT_BODY}`}>{record.site_name}</div>
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

/** What the event picker is called, per kind the almanac can observe. A full
 *  Record so a new kind has to name itself rather than render a blank label. */
const SITE_LABEL: Record<EventKind, string> = {
  dive: t.almanac.siteDive,
  course: t.almanac.siteCourse,
  adventure: t.almanac.siteAdventure,
}

function AlmanacForm({
  sites,
  onSubmit,
  onSitesChanged,
  initial,
  onCancelEdit,
}: {
  sites: DiveSite[]
  onSubmit: (form: AlmanacFormState) => Promise<void>
  /** Re-read the catalog after a diver adds to it, so the place they just
   *  entered is in the picker they are standing in front of. */
  onSitesChanged: () => Promise<void>
  /** An entry of the diver's own, opened for correction. Its presence is what
   *  puts the form in edit mode; the caller remounts on a change of target. */
  initial?: AlmanacFormState
  onCancelEdit?: () => void
}) {
  const editing = !!initial
  const [form, setForm] = useState<AlmanacFormState>(initial ?? blankForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [addingPlace, setAddingPlace] = useState(false)

  const updateField = <K extends keyof AlmanacFormState>(field: K, value: AlmanacFormState[K]) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
  }

  // The toggle is the first choice: it narrows the picker to the places of
  // that kind and decides whether the terrain block is asked for at all.
  const selectKind = (kind: EventKind) => {
    setForm(prev => ({ ...prev, kind, site_id: '' }))
    setError(null)
  }

  // Whether they added the place or picked the one the search offered
  // instead, the diver ends up with it selected and the form back on screen —
  // they came here to file an observation, not to curate a catalog.
  const selectNewPlace = async (siteId: string) => {
    await onSitesChanged()
    setForm(prev => ({ ...prev, site_id: siteId }))
    setAddingPlace(false)
    setError(null)
  }

  // Retired sites keep their history but stop being offered.
  const kindSites = sites.filter(site =>
    site.kind === form.kind && (site.active || site.id === form.site_id))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.site_id) {
      setError(t.almanac.siteRequired)
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
      // A correction leaves the form as the diver just saved it — blanking it
      // would read as the edit having been thrown away. A new observation
      // clears, ready for the next one.
      if (!editing) setForm(blankForm())
    } catch (err) {
      setError(err instanceof Error ? err.message : t.almanac.submitFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} p-4`}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>{editing ? t.almanac.editHeading : t.almanac.submit}</h2>
      {editing && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {/* Which place and which day are what identify the record, so an edit
              cannot move them: a changed date would file a second observation
              and leave the first standing. A diver who filed against the wrong
              day withdraws it and files again, which the list offers. */}
          <p className={`text-xs ${TEXT_SUBTLE}`}>{t.almanac.editNote}</p>
          <button type="button" className={BTN_XS_GHOST} onClick={onCancelEdit}>
            {t.almanac.editCancel}
          </button>
        </div>
      )}

      <div className="mt-3">
        <span className={INPUT_LABEL}>{t.almanac.kind}</span>
        <div className="flex gap-2" role="group" aria-label={t.almanac.kind}>
          {SITE_CONDITION_KINDS.map(kind => (
            <button
              key={kind}
              type="button"
              disabled={editing}
              aria-pressed={form.kind === kind}
              className={`${form.kind === kind ? BTN_XS_PRIMARY : BTN_XS_GHOST} disabled:opacity-40`}
              onClick={() => selectKind(kind)}
            >
              {EVENT_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>

      {addingPlace ? (
        <div className="mt-3">
          <AddPlaceForm
            kind={form.kind as SiteKind}
            onCancel={() => setAddingPlace(false)}
            onAdded={async id => { await selectNewPlace(id) }}
            onPick={async id => { await selectNewPlace(id) }}
          />
        </div>
      ) : (
        <>
          <label className="mt-3 block">
            <span className={INPUT_LABEL}>{SITE_LABEL[form.kind]}</span>
            <select
              className={`${INPUT} disabled:opacity-60`}
              disabled={editing}
              value={form.site_id}
              onChange={e => updateField('site_id', e.target.value)}
            >
              <option value="">{t.almanac.sitePlaceholder}</option>
              {/* An edit keeps its own place in the list even if the shop has
                  since retired it, or the picker would come up empty on the
                  record it is meant to be correcting. */}
              {kindSites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.region ? `${siteName(site)} — ${site.region}` : siteName(site)}
                </option>
              ))}
            </select>
          </label>
          {kindSites.length === 0 && (
            <p className={`mt-1 text-xs ${TEXT_SUBTLE}`}>{t.almanac.noSites}</p>
          )}
          {/* Beside the picker, not buried in an admin screen: the diver who
              needs this is the one looking at a list that does not contain
              where they were. */}
          {!editing && (
            <button type="button" className={`mt-1 ${BTN_XS_GHOST}`} onClick={() => setAddingPlace(true)}>
              {t.sites.addHeading}
            </button>
          )}
        </>
      )}

      <label className="mt-3 block">
        <span className={INPUT_LABEL}>{t.almanac.obsDate}</span>
        <input
          type="date"
          className={`${INPUT} disabled:opacity-60`}
          disabled={editing}
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

      <h3 className={`mt-4 border-t border-white/10 pt-3 text-xs ${TEXT_HEADING}`}>
        {t.almanac.trashHeading}
      </h3>
      <div className="mt-3">
        <label className="block">
          <span className={INPUT_LABEL}>{t.almanac.trashAmount}</span>
          <select
            className={INPUT}
            aria-describedby={TRASH_HINT_ID}
            value={form.trash_band}
            onChange={e => updateField('trash_band', e.target.value as AlmanacTrashBand | '')}
          >
            <option value="">{t.almanac.trashAmountPh}</option>
            {ALMANAC_TRASH_BANDS.map(band => (
              <option key={band} value={band}>{t.almanac.trashBands[band]}</option>
            ))}
          </select>
        </label>
        {/* Outside the label, described into it: inside, the hint became part
            of the field's accessible name and a screen reader announced the
            whole paragraph as the label. Blank and "none" are different
            answers and the form has to say so, or a clean site reads as an
            unsurveyed one in every tally. */}
        <p id={TRASH_HINT_ID} className={`mt-1 text-xs ${TEXT_SUBTLE}`}>{t.almanac.trashAmountHint}</p>
      </div>
      <div className="mt-3">
        <TrashKindPicker
          selected={form.trash_kinds}
          onChange={next => updateField('trash_kinds', next)}
          disabled={form.trash_band === 'none'}
        />
      </div>

      {hasTerrainConditions(form.kind) && (
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
          {submitting
            ? t.almanac.submitting
            : editing ? t.almanac.saveEdit : t.almanac.submitRecord}
        </button>
        <button
          type="button"
          className={`px-4 ${BTN_SECONDARY}`}
          onClick={() => {
            // Editing, "clear" is "put it back the way it was filed": a blank
            // form under an edit would be a save away from erasing the record
            // it is standing on.
            setForm(initial ?? blankForm())
            setError(null)
          }}
        >
          {editing ? t.almanac.revertEdit : t.almanac.clearForm}
        </button>
      </div>
    </form>
  )
}

// ─── A diver's own entries ───────────────────────────────────────────────────

const STATUS_LABEL: Record<AlmanacStatus, string> = {
  pending: t.almanac.statusPending,
  approved: t.almanac.statusApproved,
  rejected: t.almanac.statusRejected,
}

/**
 * Everything the signed-in diver has filed, and what can still be done to it.
 *
 * A submission stops being editable the moment staff rule on it — the RPC
 * refuses, and it refuses for a reason: an approved record is part of what the
 * crowd has been shown, and a reading that its author could quietly rewrite
 * afterwards would make every published figure provisional. So the row says
 * which state it is in rather than offering an Edit that would fail, and a
 * diver who needs a ruled-on record changed is told to ask staff.
 *
 * Every reading is written out, not just the site and the day. The list exists
 * to be checked against what the diver remembers, and a row that names only
 * where and when cannot be checked against anything.
 */
function OwnEntries({
  records, siteNames, onEdit, onWithdraw,
}: {
  records: AlmanacOwnRecord[]
  siteNames: Map<string, string>
  onEdit: (record: AlmanacOwnRecord) => void
  onWithdraw: (record: AlmanacOwnRecord) => Promise<void>
}) {
  // Which row is asking "are you sure". Inline rather than a dialog: the row
  // is the thing being withdrawn, and a confirmation that covers the page
  // makes the diver check the id of what they are about to lose.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (records.length === 0) {
    return <p className={`${CARD} p-4 text-center text-sm ${TEXT_SUBTLE}`}>{t.almanac.noOwnEntries}</p>
  }

  const withdraw = async (record: AlmanacOwnRecord) => {
    setBusyId(record.id)
    try {
      await onWithdraw(record)
    } finally {
      setBusyId(null)
      setConfirming(null)
    }
  }

  return (
    <ul className="space-y-2">
      {records.map(record => (
        <li key={record.id} className={`${CARD} p-3`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={`text-sm ${TEXT_BODY}`}>{siteNames.get(record.site_id) ?? '—'}</p>
              <p className={`text-xs ${TEXT_SUBTLE}`}>{formatObsDate(record.obs_date)}</p>
            </div>
            <span className={`shrink-0 text-[10px] uppercase tracking-wide ${TEXT_SUBTLE}`}>
              {STATUS_LABEL[record.status]}
            </span>
          </div>

          <ReadingGrid readings={readingsOf(record)} />

          {record.staff_notes && (
            <p className={`mt-2 text-xs ${TEXT_SUBTLE}`}>
              {t.almanac.staffNoteLabel}: {record.staff_notes}
            </p>
          )}

          {record.status === 'pending' ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_XS_PRIMARY} onClick={() => onEdit(record)}>
                {t.almanac.editEntry}
              </button>
              {confirming === record.id ? (
                <>
                  <span className={`text-xs ${TEXT_SUBTLE}`}>{t.almanac.withdrawConfirm}</span>
                  <button
                    type="button"
                    className={BTN_XS_DANGER}
                    disabled={busyId === record.id}
                    onClick={() => withdraw(record)}
                  >
                    {t.almanac.withdrawYes}
                  </button>
                  <button type="button" className={BTN_XS_GHOST} onClick={() => setConfirming(null)}>
                    {t.almanac.withdrawNo}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={BTN_XS_DANGER}
                  onClick={() => setConfirming(record.id)}
                >
                  {t.almanac.withdrawEntry}
                </button>
              )}
            </div>
          ) : (
            <p className={`mt-2 text-xs ${TEXT_SUBTLE}`}>{t.almanac.reviewedLocked}</p>
          )}
        </li>
      ))}
    </ul>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`${PILL} ${active ? 'bg-brand-600 text-white' : 'bg-white/70 text-brand-900 hover:bg-white/90'}`}
    >
      {children}
    </button>
  )
}

export function AlmanacPage() {
  const { user, profile, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<'enter' | 'view' | 'mine'>('enter')
  // The entry being corrected, if any. Held here rather than in the form so
  // that picking one from the list can also carry the diver to the form.
  const [editing, setEditing] = useState<AlmanacOwnRecord | null>(null)
  const [ownError, setOwnError] = useState<string | null>(null)
  // The site/date lookup on the View tab. Both have to be answered before
  // there is a day to read, so an unfinished pair leaves the browse list up.
  const [lookupSite, setLookupSite] = useState('')
  const [lookupDate, setLookupDate] = useState('')
  const [dayRecords, setDayRecords] = useState<AlmanacEventRecord[] | null>(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [dayError, setDayError] = useState<string | null>(null)
  const [sites, setSites] = useState<DiveSite[]>([])
  const [records, setRecords] = useState<AlmanacEventRecord[]>([])
  const [ownSubmissions, setOwnSubmissions] = useState<AlmanacOwnRecord[]>([])
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

  // Everything the diver has filed, in full: the pending ones they can still
  // correct, and the ruled-on ones they cannot but are entitled to see. Whole
  // rows rather than a summary, because an edit is seeded from the record and a
  // form filled from half of one would blank the other half on save.
  const loadOwnSubmissions = useCallback(async () => {
    if (!userId) return
    const { data, error } = await supabase
      .from('almanac_records')
      .select('*')
      .eq('diver_id', userId)
      .order('obs_date', { ascending: false })
    if (error) {
      console.error('Failed to load your almanac submissions:', error)
      return
    }
    setOwnSubmissions(data ?? [])
  }, [userId])

  const loadSites = useCallback(async () => {
    setSites(await fetchDiveSites())
  }, [])

  const loadRecords = useCallback(async () => {
    const today = todayIso()
    const { data, error } = await supabase.rpc('almanac_records_in_range', {
      p_from: addIsoDays(today, -LOOKBACK_DAYS),
      p_to: today,
    })
    if (error) throw error
    setRecords(data ?? [])
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        await Promise.all([loadSites(), loadRecords(), loadOwnSubmissions(), loadQueue()])
      } catch (err) {
        console.error('Failed to load the almanac:', err)
        if (!cancelled) setLoadError(t.almanac.recordsFailed)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId, loadSites, loadRecords, loadOwnSubmissions, loadQueue])

  // One day at a time, straight from the range RPC with both ends on the same
  // date: a lookup can reach further back than the page's own window, and a
  // single day is a small enough read to fetch on every change of either field.
  useEffect(() => {
    if (!lookupSite || !lookupDate) return
    let cancelled = false
    const load = async () => {
      setDayLoading(true)
      setDayError(null)
      try {
        const { data, error } = await supabase.rpc('almanac_records_in_range', {
          p_from: lookupDate, p_to: lookupDate,
        })
        if (error) throw error
        if (!cancelled) {
          setDayRecords((data ?? []).filter((r: AlmanacEventRecord) => r.site_id === lookupSite))
        }
      } catch (err) {
        console.error('Failed to load that almanac day:', err)
        if (!cancelled) {
          setDayError(t.almanac.lookupFailed)
          setDayRecords(null)
        }
      } finally {
        if (!cancelled) setDayLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [lookupSite, lookupDate])

  const handleSubmit = async (form: AlmanacFormState) => {
    const { error } = await supabase.rpc('submit_almanac_record', submitArgs(form))
    if (error) {
      console.error('Failed to submit the almanac record:', error)
      throw new Error(error.message.includes('almanac_record_already_reviewed')
        ? t.almanac.submitAlreadyReviewed
        : t.almanac.submitFailed)
    }
    setSubmitStatus(editing ? t.almanac.editSaved : t.almanac.submitted)
    setEditing(null)
    await loadOwnSubmissions()
  }

  const startEdit = (record: AlmanacOwnRecord) => {
    setEditing(record)
    setSubmitStatus(null)
    setOwnError(null)
    setTab('enter')
  }

  const handleWithdraw = async (record: AlmanacOwnRecord) => {
    setOwnError(null)
    const { error } = await supabase.rpc('withdraw_almanac_record', { p_record_id: record.id })
    if (error) {
      console.error('Failed to withdraw the almanac record:', error)
      // The one failure a diver can actually hit: staff ruled on it between
      // the page loading and the button being pressed.
      setOwnError(error.message.includes('almanac_record_already_reviewed')
        ? t.almanac.withdrawAlreadyReviewed
        : t.almanac.withdrawFailed)
      await loadOwnSubmissions()
      return
    }
    // Editing the thing that has just been withdrawn would be a form standing
    // on a record that is gone.
    if (editing?.id === record.id) setEditing(null)
    await loadOwnSubmissions()
  }

  const handleModerate = async (id: string, status: 'approved' | 'rejected', notes: string) => {
    const { error } = await supabase.rpc('moderate_almanac_record', {
      p_record_id: id,
      p_status: status,
      p_staff_notes: notes.trim() || null,
    })
    if (error) throw error
    await Promise.all([loadQueue(), loadRecords()])
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className={`text-sm ${TEXT_SUBTLE}`}>{t.almanac.recordsLoading}</p>
      </div>
    )
  }

  const days = daysOf(records)
  const siteNames = new Map(sites.map(site => [site.id, site.name]))
  // A record does not carry a kind: the almanac's kinds are a property of the
  // place, and the form reads one off the site to decide whether to ask the
  // terrain questions. A site no longer in the catalog falls back to the first
  // kind rather than crashing the edit it was opened for.
  const siteKindOf = (siteId: string): EventKind =>
    (sites.find(site => site.id === siteId)?.kind as EventKind | undefined) ?? SITE_CONDITION_KINDS[0]
  // Half a lookup is no lookup — and clearing one empties the fields a render
  // before the effect drops the day it had loaded, so the report has to key off
  // the fields rather than off the records still in hand.
  const lookingUp = !!lookupSite && !!lookupDate

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-2 pb-8">
      <header>
        <h1 className={`text-xl ${TEXT_HEADING}`}>{t.almanac.title}</h1>
        <p className={`mt-1 text-sm ${TEXT_SUBTLE}`}>{t.almanac.blurb}</p>
      </header>

      {loadError && <p className={ERROR_NOTE_LIGHT}>{loadError}</p>}

      {isStaff && !loadError && <ModerationQueue records={pending} onModerate={handleModerate} />}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.almanac.sectionsAria}>
        <TabButton active={tab === 'enter'} onClick={() => setTab('enter')}>{t.almanac.tabEnter}</TabButton>
        <TabButton active={tab === 'view'} onClick={() => setTab('view')}>{t.almanac.tabView}</TabButton>
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>{t.almanac.tabMine}</TabButton>
      </div>

      {tab === 'enter' ? (
        <>
          {/* The form renders even with an empty catalog. It used to be
              replaced by "no places yet", which was right while only an admin
              could add one and is exactly backwards now: a diver looking at a
              list that does not contain where they were is the person this
              feature is for. */}
          {/* Remounted per target: the form owns its fields, and seeding an
              existing instance would leave the previous entry's answers in
              whichever ones the new record does not fill. */}
          <AlmanacForm
            key={editing?.id ?? 'new'}
            sites={sites}
            onSubmit={handleSubmit}
            onSitesChanged={loadSites}
            initial={editing ? formStateFrom(editing, siteKindOf(editing.site_id)) : undefined}
            onCancelEdit={() => setEditing(null)}
          />

          {submitStatus && (
            <p className="rounded-lg bg-emerald-500/15 p-2 text-center text-xs text-emerald-200">
              {submitStatus}
            </p>
          )}

          {/* The list itself is a tab of its own now; this is the pointer to
              it, so a diver who has just filed something knows where it went. */}
          {ownSubmissions.length > 0 && (
            <button
              type="button"
              className={`self-start ${BTN_XS_GHOST}`}
              onClick={() => setTab('mine')}
            >
              {t.almanac.seeYourEntries(ownSubmissions.length)}
            </button>
          )}
        </>
      ) : tab === 'mine' ? (
        <section>
          <h2 className={`mb-2 text-sm ${TEXT_HEADING}`}>{t.almanac.yourSubmissions}</h2>
          <p className={`mb-2 text-xs ${TEXT_SUBTLE}`}>{t.almanac.yourSubmissionsNote}</p>
          {ownError && <p className={ERROR_NOTE_LIGHT}>{ownError}</p>}
          <OwnEntries
            records={ownSubmissions}
            siteNames={siteNames}
            onEdit={startEdit}
            onWithdraw={handleWithdraw}
          />
        </section>
      ) : (
        <>
          <section className={`${CARD} p-4`}>
            <h2 className={`text-sm ${TEXT_HEADING}`}>{t.almanac.lookupHeading}</h2>
            <p className={`mt-1 text-xs ${TEXT_SUBTLE}`}>{t.almanac.lookupPrompt}</p>

            <label className="mt-3 block">
              <span className={INPUT_LABEL}>{t.almanac.lookupSite}</span>
              {/* Retired places stay in the list: the form stops offering them,
                  but the days they were dived are still there to read. */}
              <select className={INPUT} value={lookupSite} onChange={e => setLookupSite(e.target.value)}>
                <option value="">{t.almanac.sitePlaceholder}</option>
                {sites.map(site => (
                  <option key={site.id} value={site.id}>
                    {site.region ? `${site.name} — ${site.region}` : site.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className={INPUT_LABEL}>{t.almanac.lookupDate}</span>
              <input
                type="date"
                className={INPUT}
                max={todayIso()}
                value={lookupDate}
                onChange={e => setLookupDate(e.target.value)}
              />
            </label>

            {(lookupSite || lookupDate) && (
              <button
                type="button"
                className={`${BTN_XS_GHOST} mt-3`}
                onClick={() => { setLookupSite(''); setLookupDate('') }}
              >
                {t.almanac.lookupClear}
              </button>
            )}
          </section>

          {lookingUp && dayError && <p className={ERROR_NOTE_LIGHT}>{dayError}</p>}

          {lookingUp && dayLoading && (
            <p className={`text-center text-sm ${TEXT_SUBTLE}`}>{t.almanac.lookupLoading}</p>
          )}

          {lookingUp && !dayLoading && dayRecords !== null && (
            <SiteDayReport
              siteName={siteNames.get(lookupSite) ?? '—'}
              dateLabel={formatObsDate(lookupDate)}
              records={dayRecords}
            />
          )}

          {!lookingUp && (
            <section>
              <h2 className={`mb-2 text-sm ${TEXT_HEADING}`}>{t.almanac.recordsHeading}</h2>
              {days.length === 0 ? (
                <p className={`${CARD} p-4 text-center text-sm ${TEXT_SUBTLE}`}>{t.almanac.noRecordsYet}</p>
              ) : (
                <div className="space-y-2">
                  {days.map(day => <DayCard key={day.date} day={day} />)}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
