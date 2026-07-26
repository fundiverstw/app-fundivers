import { useEffect, useState } from 'react'
import { isoDate } from '../lib/dates'
import { format } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import {
  fetchDiveLogs, createDiveLog, updateDiveLog, deleteDiveLog,
  getLastExportRequestAt, nextExportAvailableAt, requestExport,
} from '../lib/dive-logs'
import { GEAR_ITEMS } from '../lib/gear'
import {
  DIVE_LOG_BOUNDS, DIVE_LOG_TEXT_MAX, validateDiveLog, roundDiveLogNumbers, hasErrors,
  type NumericField, type DiveLogErrors,
} from '../lib/dive-log-validation'
import { DateField } from '../components/DateField'
import { DIVE_TYPES, GAS_MIXES, type DiveLog, type DiveLogInsert, type DiveType, type GasMix } from '../types/database'
import {
  CARD, CARD_ELEVATED, BTN_PRIMARY, BTN_GHOST, BTN_DANGER, BTN_LIGHT,
  TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, TEXT_ERROR, INPUT, INPUT_LABEL, PAGE_BODY,
  BTN_XS_GHOST,
} from '../styles/tokens'
import { t } from '../i18n'

const dl = t.diveLogs

// Per-diver dive log. List view defaults; tap "+ Add" or an existing row
// to flip the page into the form view. Save returns to the list.
//
// Export-CSV button at the top sends every dive log to the diver's email
// via the request-dive-log-export edge function. Limited to one request
// per 24 hours; UI shows a disabled-state countdown so the user doesn't
// waste a click discovering it's rate-limited.

type FormState = Omit<DiveLogInsert, 'user_id'>

const blankForm = (): FormState => ({
  dived_on:           isoDate(new Date()),
  site:               '',
  dive_type:          null,
  max_depth_m:        null,
  dive_time_min:      null,
  visibility_m:       null,
  water_temp_c:       null,
  air_temp_c:         null,
  weather:            null,
  wave_height_m:      null,
  weight_kg:          null,
  gear_used:          [],
  gas_mix:            null,
  tank_size_l:        null,
  start_pressure_bar: null,
  end_pressure_bar:   null,
  buddy_name:         null,
  instructor_name:    null,
  notes:              null,
})

function formFromRow(row: DiveLog): FormState {
  return {
    dived_on:           row.dived_on,
    site:               row.site,
    dive_type:          row.dive_type,
    max_depth_m:        row.max_depth_m,
    dive_time_min:      row.dive_time_min,
    visibility_m:       row.visibility_m,
    water_temp_c:       row.water_temp_c,
    air_temp_c:         row.air_temp_c,
    weather:            row.weather,
    wave_height_m:      row.wave_height_m,
    weight_kg:          row.weight_kg,
    gear_used:          row.gear_used,
    gas_mix:            row.gas_mix,
    tank_size_l:        row.tank_size_l,
    start_pressure_bar: row.start_pressure_bar,
    end_pressure_bar:   row.end_pressure_bar,
    buddy_name:         row.buddy_name,
    instructor_name:    row.instructor_name,
    notes:              row.notes,
  }
}

type View =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; row: DiveLog }

export function DiveLogsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<DiveLog[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>({ kind: 'list' })
  // Stored as hours-until-available (computed once at fetch time, in the
  // effect, with `now` resolved against Date.now there) rather than a
  // Date the renderer has to subtract from `Date.now()`. React Compiler
  // flags Date.now() during render as impure; the countdown only needs
  // to be accurate to the hour anyway, so compute-on-load is fine.
  const [hoursUntilExport, setHoursUntilExport] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      try {
        const [logs, last] = await Promise.all([
          fetchDiveLogs(user.id),
          getLastExportRequestAt(user.id),
        ])
        if (cancelled) return
        setRows(logs)
        setHoursUntilExport(hoursUntil(nextExportAvailableAt(last)))
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user, toast])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await requestExport()
      toast.success(dl.exportSent(res.dive_count))
      // Optimistic: assume the audit row was just inserted, so next-available
      // = +24h. We avoid a re-fetch in the success path.
      setHoursUntilExport(24)
    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'rate-limited') {
        toast.error(dl.exportRateLimited)
        if (user) {
          const last = await getLastExportRequestAt(user.id)
          setHoursUntilExport(hoursUntil(nextExportAvailableAt(last)))
        }
      } else {
        toast.error(msg)
      }
    } finally {
      setExporting(false)
    }
  }

  async function handleSave(form: FormState, editingId: string | null) {
    if (!user) return
    try {
      if (editingId) {
        const updated = await updateDiveLog(editingId, form)
        setRows(prev => prev.map(r => r.id === editingId ? updated : r))
        toast.success(dl.updated)
      } else {
        const created = await createDiveLog({ user_id: user.id, ...form })
        setRows(prev => [created, ...prev])
        toast.success(dl.logged(created.dive_number))
      }
      setView({ kind: 'list' })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(dl.confirmDelete)) return
    try {
      await deleteDiveLog(id)
      setRows(prev => prev.filter(r => r.id !== id))
      toast.success(dl.deleted)
      setView({ kind: 'list' })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (view.kind === 'new' || view.kind === 'edit') {
    return (
      <DiveLogForm
        initial={view.kind === 'edit' ? formFromRow(view.row) : blankForm()}
        editingNumber={view.kind === 'edit' ? view.row.dive_number : null}
        onSave={(form) => handleSave(form, view.kind === 'edit' ? view.row.id : null)}
        onDelete={view.kind === 'edit' ? () => handleDelete(view.row.id) : undefined}
        onCancel={() => setView({ kind: 'list' })}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className={`text-lg ${TEXT_HEADING}`}>{dl.title}</h2>
        <button
          type="button"
          onClick={() => setView({ kind: 'new' })}
          className={`text-xs px-3 py-1.5 ${BTN_LIGHT}`}
        >
          {dl.add}
        </button>
      </div>

      <ExportButton
        rowCount={rows.length}
        hoursUntilAvailable={hoursUntilExport}
        loading={exporting}
        onClick={handleExport}
      />

      {loading && <p className={`text-sm ${PAGE_BODY}`}>{dl.loading}</p>}

      {!loading && rows.length === 0 && (
        <div className={`${CARD} p-6 text-center`}>
          <p className={`text-sm ${TEXT_MUTED}`}>{dl.empty}</p>
        </div>
      )}

      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setView({ kind: 'edit', row: r })}
              className={`${CARD_ELEVATED} w-full text-left p-3`}
              aria-label={dl.editAria(r.dive_number, r.dived_on, r.site)}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className={`font-bold ${TEXT_HEADING}`}>
                  #{r.dive_number} · {r.site}
                </div>
                <div className={`text-xs ${TEXT_SUBTLE}`}>
                  {format(new Date(r.dived_on), 'PP')}
                </div>
              </div>
              <div className={`text-xs ${TEXT_BODY} mt-1 flex flex-wrap gap-x-3 gap-y-0.5`}>
                {r.max_depth_m != null && <span>{dl.maxDepthShort(r.max_depth_m)}</span>}
                {r.dive_time_min != null && <span>{dl.diveTimeShort(r.dive_time_min)}</span>}
                {r.water_temp_c != null && <span>{r.water_temp_c}°C</span>}
                {r.gas_mix && <span>{r.gas_mix}</span>}
                {r.buddy_name && <span>{dl.buddyShort(r.buddy_name)}</span>}
                {r.instructor_name && <span>{dl.instructorShort(r.instructor_name)}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function hoursUntil(d: Date | null): number | null {
  if (!d) return null
  const ms = d.getTime() - Date.now()
  return ms <= 0 ? null : Math.max(1, Math.ceil(ms / 3600 / 1000))
}

function ExportButton({
  rowCount, hoursUntilAvailable, loading, onClick,
}: {
  rowCount: number
  hoursUntilAvailable: number | null
  loading: boolean
  onClick: () => void
}) {
  if (hoursUntilAvailable != null) {
    return (
      <div className={`${CARD} p-3 flex items-baseline justify-between gap-3 text-xs`}>
        <span className={TEXT_MUTED}>{dl.exportAvailableIn(hoursUntilAvailable)}</span>
        <button type="button" disabled className={`${BTN_GHOST} text-xs px-3 py-1`}>
          {dl.emailMeCsv}
        </button>
      </div>
    )
  }
  return (
    <div className={`${CARD} p-3 flex items-baseline justify-between gap-3 text-xs`}>
      <span className={TEXT_MUTED}>
        {rowCount === 0 ? dl.nothingToExport : dl.exportAll(rowCount)}
      </span>
      <button
        type="button"
        onClick={onClick}
        disabled={loading || rowCount === 0}
        className={`${BTN_LIGHT} text-xs px-3 py-1`}
      >
        {loading ? dl.exporting : dl.emailMeCsv}
      </button>
    </div>
  )
}

function DiveLogForm({
  initial, editingNumber, onSave, onDelete, onCancel,
}: {
  initial: FormState
  editingNumber: number | null
  onSave: (form: FormState) => void | Promise<void>
  onDelete?: () => void | Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<DiveLogErrors>({})

  // Editing a field retracts its complaint immediately rather than making the
  // diver re-submit to find out whether the new value is any better.
  function clearError(k: keyof FormState) {
    setErrors(prev => {
      if (!(k in prev)) return prev
      const next = { ...prev }
      delete next[k as keyof DiveLogErrors]
      return next
    })
  }

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
    clearError(k)
  }

  function setNum(k: keyof FormState, raw: string) {
    clearError(k)
    if (raw === '') return setForm(prev => ({ ...prev, [k]: null } as FormState))
    const n = Number(raw)
    if (Number.isFinite(n)) setForm(prev => ({ ...prev, [k]: n } as FormState))
  }

  function setText(k: keyof FormState, raw: string) {
    clearError(k)
    setForm(prev => ({ ...prev, [k]: raw === '' ? null : raw } as FormState))
  }

  function toggleGear(item: string) {
    setForm(prev => ({
      ...prev,
      gear_used: prev.gear_used?.includes(item)
        ? prev.gear_used.filter(g => g !== item)
        : [...(prev.gear_used ?? []), item],
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.dived_on) return
    // Round before validating so the numbers we check are the ones the
    // columns will actually hold, then save the rounded copy for the same
    // reason. Native min/max already covers the common case; this catches
    // whatever gets past it and turns a driver-level overflow into a message
    // pointing at the offending box.
    const rounded = roundDiveLogNumbers(form)
    const found = validateDiveLog(rounded)
    if (hasErrors(found)) {
      setErrors(found)
      return
    }
    setErrors({})
    setSaving(true)
    try { await onSave(rounded) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`text-lg ${TEXT_HEADING}`}>
          {editingNumber ? dl.diveNumber(editingNumber) : dl.newDive}
        </h2>
        <button type="button" onClick={onCancel} className={BTN_XS_GHOST}>
          {dl.backToList}
        </button>
      </div>

      <div className={`${CARD_ELEVATED} p-4 grid grid-cols-1 sm:grid-cols-2 gap-3`}>
        <Field label={dl.date} required>
          <DateField required className={INPUT} value={form.dived_on}
            onChange={v => set('dived_on', v)} />
        </Field>
        <Field label={dl.site} required error={errors.site}>
          <input type="text" required maxLength={DIVE_LOG_TEXT_MAX.site} className={INPUT}
            aria-invalid={errors.site ? true : undefined}
            value={form.site} onChange={e => set('site', e.target.value)} />
        </Field>

        <Field label={dl.type}>
          <select className={INPUT} value={form.dive_type ?? ''}
            onChange={e => set('dive_type', (e.target.value || null) as DiveType | null)}>
            <option value="">—</option>
            {DIVE_TYPES.map(dt => <option key={dt} value={dt}>{dt}</option>)}
          </select>
        </Field>
        <Field label={dl.gasMix}>
          <select className={INPUT} value={form.gas_mix ?? ''}
            onChange={e => set('gas_mix', (e.target.value || null) as GasMix | null)}>
            <option value="">—</option>
            {GAS_MIXES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>

        <NumberField field="max_depth_m" label={dl.maxDepth} value={form.max_depth_m}
          error={errors.max_depth_m} onChange={setNum} />
        <NumberField field="dive_time_min" label={dl.diveTime} value={form.dive_time_min}
          error={errors.dive_time_min} onChange={setNum} />

        <NumberField field="visibility_m" label={dl.visibility} value={form.visibility_m}
          error={errors.visibility_m} onChange={setNum} />
        <NumberField field="water_temp_c" label={dl.waterTemp} value={form.water_temp_c}
          error={errors.water_temp_c} onChange={setNum} />

        <NumberField field="air_temp_c" label={dl.airTemp} value={form.air_temp_c}
          error={errors.air_temp_c} onChange={setNum} />
        <NumberField field="wave_height_m" label={dl.waveHeight} value={form.wave_height_m}
          error={errors.wave_height_m} onChange={setNum} />

        <Field label={dl.weather} error={errors.weather}>
          <input type="text" maxLength={DIVE_LOG_TEXT_MAX.weather} className={INPUT}
            aria-invalid={errors.weather ? true : undefined}
            value={form.weather ?? ''} onChange={e => setText('weather', e.target.value)} />
        </Field>
        <NumberField field="weight_kg" label={dl.weight} value={form.weight_kg}
          error={errors.weight_kg} onChange={setNum} />

        <NumberField field="tank_size_l" label={dl.tankSize} value={form.tank_size_l}
          error={errors.tank_size_l} onChange={setNum} />
        <NumberField field="start_pressure_bar" label={dl.startPressure} value={form.start_pressure_bar}
          error={errors.start_pressure_bar} onChange={setNum} />

        <NumberField field="end_pressure_bar" label={dl.endPressure} value={form.end_pressure_bar}
          error={errors.end_pressure_bar} onChange={setNum} />
        <Field label={dl.buddy} error={errors.buddy_name}>
          <input type="text" maxLength={DIVE_LOG_TEXT_MAX.buddy_name} className={INPUT}
            aria-invalid={errors.buddy_name ? true : undefined}
            value={form.buddy_name ?? ''} onChange={e => setText('buddy_name', e.target.value)} />
        </Field>

        <Field label={dl.instructor} error={errors.instructor_name}>
          <input type="text" maxLength={DIVE_LOG_TEXT_MAX.instructor_name} className={INPUT}
            aria-invalid={errors.instructor_name ? true : undefined}
            value={form.instructor_name ?? ''} onChange={e => setText('instructor_name', e.target.value)} />
        </Field>
        <Field label={dl.gearUsed} wide group>
          <div className="flex flex-wrap gap-1.5">
            {GEAR_ITEMS.map(g => {
              const on = form.gear_used?.includes(g) ?? false
              return (
                <button
                  type="button"
                  key={g}
                  onClick={() => toggleGear(g)}
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                    on ? 'bg-brand-900 text-white border-brand-900' : 'bg-white text-brand-900 border-surface-300 hover:bg-surface-100'
                  }`}
                  aria-pressed={on}
                >
                  {g}
                </button>
              )
            })}
          </div>
        </Field>

        <Field label={dl.notes} wide>
          <textarea rows={3} className={INPUT} value={form.notes ?? ''}
            onChange={e => setText('notes', e.target.value)} />
        </Field>
      </div>

      {hasErrors(errors) && (
        <p role="alert" className={`text-sm ${TEXT_ERROR}`}>{dl.errors.fixFields}</p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={`flex-1 ${BTN_PRIMARY}`}>
          {saving ? dl.saving : (editingNumber ? dl.saveChanges : dl.saveDive)}
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} className={`${BTN_DANGER} px-4`}>
            {dl.delete}
          </button>
        )}
      </div>
    </form>
  )
}

// Every numeric box in the logbook, driven off the shared bounds table so the
// spinner range the diver sees and the range the validator enforces cannot
// drift apart.
function NumberField({ field, label, value, error, onChange }: {
  field: NumericField
  label: string
  value: number | null | undefined
  error?: string
  onChange: (field: NumericField, raw: string) => void
}) {
  const { min, max, decimals } = DIVE_LOG_BOUNDS[field]
  return (
    <Field label={label} error={error}>
      <input
        type="number"
        className={INPUT}
        min={min}
        max={max}
        step={decimals === 0 ? 1 : 0.1}
        aria-invalid={error ? true : undefined}
        value={value ?? ''}
        onChange={e => onChange(field, e.target.value)}
      />
    </Field>
  )
}

/**
 * One labelled control in the logbook grid.
 *
 * The control is nested inside the `<label>` so it picks up the caption as its
 * accessible name without either side having to invent an id. `group` opts out
 * for the gear picker, whose children are a row of toggles rather than a
 * single control — a `<label>` wrapping several buttons names none of them.
 *
 * `col-span-full` rather than `col-span-2` for the wide row: the grid is one
 * column on mobile, and asking for two there makes CSS Grid conjure an
 * implicit second track, which collapses the real column and shreds every
 * caption down to one letter per line.
 */
function Field({ label, required, wide, group, error, children }: {
  label: string
  required?: boolean
  wide?: boolean
  group?: boolean
  error?: string
  children: React.ReactNode
}) {
  const caption = (
    <span className={INPUT_LABEL}>
      {label}
      {required && <span className="text-red-600 ml-0.5" aria-label={dl.requiredAria}>*</span>}
    </span>
  )
  return (
    <div className={wide ? 'col-span-full min-w-0' : 'min-w-0'}>
      {group ? (
        <div role="group" aria-label={label}>
          {caption}
          {children}
        </div>
      ) : (
        <label className="block">
          {caption}
          {children}
        </label>
      )}
      {error && <p role="alert" className={`mt-1 text-xs ${TEXT_ERROR}`}>{error}</p>}
    </div>
  )
}
