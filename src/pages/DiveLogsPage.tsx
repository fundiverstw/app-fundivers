import { useEffect, useState } from 'react'
import { todayIso, parseIsoDate } from '../lib/dates'
import { format } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import {
  fetchDiveLogs, createDiveLog, updateDiveLog, deleteDiveLog,
  getLastExportRequestAt, nextExportAvailableAt, requestExport,
} from '../lib/dive-logs'
import { GEAR_ITEMS } from '../lib/gear'
import {
  DIVE_LOG_BOUNDS, DIVE_LOG_TEXT_MAX, DIVE_LOG_NUMBER_MAX, EARLIEST_DIVE_DATE, latestDiveDate,
  validateDiveLog, roundDiveLogNumbers, hasErrors,
  type NumericField, type DiveLogErrors,
} from '../lib/dive-log-validation'
import { DateField } from '../components/DateField'
import { type DiveLog, type DiveLogInsert, type DiveType, type GasMix } from '../types/database'
import { DIVE_TYPE_OPTIONS, GAS_MIX_OPTIONS, GAS_MIX_LABELS } from '../lib/dive-log-labels'
import {
  CARD, CARD_ELEVATED, BTN_PRIMARY, BTN_GHOST, BTN_DANGER, BTN_LIGHT,
  TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, TEXT_ERROR, INPUT, INPUT_LABEL, PAGE_BODY,
  BTN_XS_GHOST, BTN_XS_PRIMARY,
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

// dive_number is broken out so the form can hold null (blank ⇒ auto-assign on
// a new dive) even though the Insert type only allows number | undefined.
type FormState = Omit<DiveLogInsert, 'user_id' | 'dive_number'> & { dive_number?: number | null }

const blankForm = (nextNumber: number): FormState => ({
  dive_number:        nextNumber,
  title:              null,
  dived_on:           todayIso(),
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
  wetsuit_thickness:  null,
  gas_mix:            null,
  tank_size_l:        null,
  start_pressure_bar: null,
  end_pressure_bar:   null,
  buddy_name:         null,
  notes:              null,
})

// Everything the form does not insist on. These start hidden and the diver
// pulls in the ones they care about from the "+ Add field" list, so a routine
// entry is a handful of boxes rather than twenty. Order here is the order they appear
// in, both in the grid and in the picker.
const OPTIONAL_FIELDS = [
  'dive_type', 'gas_mix',
  'visibility_m', 'water_temp_c', 'air_temp_c', 'wave_height_m', 'weather',
  'weight_kg', 'tank_size_l', 'start_pressure_bar', 'end_pressure_bar',
  'wetsuit_thickness', 'gear_used', 'notes',
] as const

type OptionalField = typeof OPTIONAL_FIELDS[number]

const OPTIONAL_LABELS: Record<OptionalField, string> = {
  dive_type:          dl.type,
  gas_mix:            dl.gasMix,
  visibility_m:       dl.visibility,
  water_temp_c:       dl.waterTemp,
  air_temp_c:         dl.airTemp,
  wave_height_m:      dl.waveHeight,
  weather:            dl.weather,
  weight_kg:          dl.weight,
  tank_size_l:        dl.tankSize,
  start_pressure_bar: dl.startPressure,
  end_pressure_bar:   dl.endPressure,
  wetsuit_thickness:  dl.wetsuitThickness,
  gear_used:          dl.gearUsed,
  notes:              dl.notes,
}

const CHIP_BASE = 'text-xs px-2 py-1 rounded-md border transition-colors'
const CHIP_OFF = `${CHIP_BASE} bg-white text-brand-900 border-surface-300 hover:bg-surface-100`
const CHIP_ON = `${CHIP_BASE} bg-brand-900 text-white border-brand-900`

/**
 * Which optional fields to show on open: the ones that already carry a value,
 * so editing an old entry never buries data behind a picker.
 */
function initiallyShown(initial: FormState): Set<OptionalField> {
  return new Set(OPTIONAL_FIELDS.filter(k => {
    const v = initial[k]
    return Array.isArray(v) ? v.length > 0 : v != null && v !== ''
  }))
}

function formFromRow(row: DiveLog): FormState {
  return {
    dive_number:        row.dive_number,
    title:              row.title,
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
    wetsuit_thickness:  row.wetsuit_thickness,
    gas_mix:            row.gas_mix,
    tank_size_l:        row.tank_size_l,
    start_pressure_bar: row.start_pressure_bar,
    end_pressure_bar:   row.end_pressure_bar,
    buddy_name:         row.buddy_name,
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

  // The number a brand-new dive is pre-filled with — one past the diver's
  // highest so far (or 1 for their first). Left unchanged, it's sent as null so
  // the trigger assigns it; the diver can overwrite it to start from an
  // existing logbook count.
  const nextDiveNumber = rows.length ? Math.max(...rows.map(r => r.dive_number)) + 1 : 1

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
    const { dive_number, ...rest } = form
    try {
      if (editingId) {
        // Only send a number when one is present — a cleared field leaves the
        // existing number untouched (the column is NOT NULL).
        const patch: Partial<DiveLogInsert> = { ...rest }
        if (dive_number != null) patch.dive_number = dive_number
        const updated = await updateDiveLog(editingId, patch)
        setRows(prev => prev.map(r => r.id === editingId ? updated : r))
        toast.success(dl.updated)
      } else {
        // Blank, or left at the suggested next number ⇒ let the BEFORE INSERT
        // trigger assign it (its advisory lock stops two tabs colliding). An
        // explicit, different value is the diver starting from their own count.
        const explicit = dive_number != null && dive_number !== nextDiveNumber ? { dive_number } : {}
        const created = await createDiveLog({ user_id: user.id, ...rest, ...explicit })
        setRows(prev => [created, ...prev])
        toast.success(dl.logged(created.dive_number))
      }
      setView({ kind: 'list' })
    } catch (err) {
      // A racing insert/edit can still collide on UNIQUE(user_id, dive_number)
      // past the client-side check — surface a friendly message, not raw SQL.
      if (dive_number != null && (err as { code?: string }).code === '23505') {
        toast.error(dl.errors.diveNumberTaken(dive_number))
      } else {
        toast.error((err as Error).message)
      }
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
    const editingRow = view.kind === 'edit' ? view.row : null
    // Numbers already used by the diver's OTHER dives — what a user-chosen
    // number is validated against so a collision is caught before submit.
    const takenNumbers = new Set(
      rows.filter(r => r.id !== editingRow?.id).map(r => r.dive_number),
    )
    return (
      <DiveLogForm
        initial={editingRow ? formFromRow(editingRow) : blankForm(nextDiveNumber)}
        editingNumber={editingRow ? editingRow.dive_number : null}
        takenNumbers={takenNumbers}
        onSave={(form) => handleSave(form, editingRow ? editingRow.id : null)}
        onDelete={editingRow ? () => handleDelete(editingRow.id) : undefined}
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
                <div className={`font-bold ${TEXT_HEADING} min-w-0 truncate`}>
                  {r.title || `#${r.dive_number} · ${r.site}`}
                </div>
                <div className={`text-xs ${TEXT_SUBTLE} shrink-0`}>
                  {format(parseIsoDate(r.dived_on), 'PP')}
                </div>
              </div>
              {r.title && (
                <div className={`text-xs ${TEXT_SUBTLE}`}>#{r.dive_number} · {r.site}</div>
              )}
              <div className={`text-xs ${TEXT_BODY} mt-1 flex flex-wrap gap-x-3 gap-y-0.5`}>
                {r.max_depth_m != null && <span>{dl.maxDepthShort(r.max_depth_m)}</span>}
                {r.dive_time_min != null && <span>{dl.diveTimeShort(r.dive_time_min)}</span>}
                {r.water_temp_c != null && <span>{r.water_temp_c}°C</span>}
                {r.gas_mix && <span>{GAS_MIX_LABELS[r.gas_mix]}</span>}
                {r.buddy_name && <span>{dl.buddyShort(r.buddy_name)}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The gear toggles to offer: the shop's current list, plus anything already
 * saved on this dive that has since left it.
 *
 * `toggleGear` preserves entries it doesn't recognize, so dropping an item
 * from the config used to leave it stuck on old dives with no button to
 * remove it — recorded, invisible, and exported to CSV anyway.
 */
function gearChoices(saved: string[] | null | undefined): string[] {
  const extras = (saved ?? []).filter(g => !GEAR_ITEMS.includes(g))
  return [...GEAR_ITEMS, ...extras]
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
  initial, editingNumber, takenNumbers, onSave, onDelete, onCancel,
}: {
  initial: FormState
  editingNumber: number | null
  takenNumbers: Set<number>
  onSave: (form: FormState) => void | Promise<void>
  onDelete?: () => void | Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<DiveLogErrors>({})
  const [shown, setShown] = useState<Set<OptionalField>>(
    () => initiallyShown(initial),
  )
  const [picking, setPicking] = useState(false)

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

  function addField(k: OptionalField) {
    setShown(prev => new Set(prev).add(k))
    setPicking(false)
  }

  // Removing empties the field as well as hiding it: a hidden box that still
  // carries a value would save something the diver can no longer see.
  function removeField(k: OptionalField) {
    setShown(prev => {
      const next = new Set(prev)
      next.delete(k)
      return next
    })
    setForm(prev => ({ ...prev, [k]: k === 'gear_used' ? [] : null }))
    clearError(k)
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
    const found = validateDiveLog(rounded, { takenNumbers })
    if (hasErrors(found)) {
      setErrors(found)
      return
    }
    setErrors({})
    setSaving(true)
    try { await onSave(rounded) } finally { setSaving(false) }
  }

  const remaining = OPTIONAL_FIELDS.filter(k => !shown.has(k))

  function optionalField(k: OptionalField) {
    const label = OPTIONAL_LABELS[k]
    const onRemove = () => removeField(k)
    switch (k) {
      case 'dive_type':
        return (
          <Field key={k} label={label} onRemove={onRemove}>
            <select className={INPUT} value={form.dive_type ?? ''}
              onChange={e => set('dive_type', (e.target.value || null) as DiveType | null)}>
              <option value="">—</option>
              {DIVE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )
      case 'gas_mix':
        return (
          <Field key={k} label={label} onRemove={onRemove}>
            <select className={INPUT} value={form.gas_mix ?? ''}
              onChange={e => set('gas_mix', (e.target.value || null) as GasMix | null)}>
              <option value="">—</option>
              {GAS_MIX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )
      case 'weather':
        return (
          <Field key={k} label={label} error={errors.weather} onRemove={onRemove}>
            <input type="text" maxLength={DIVE_LOG_TEXT_MAX.weather} className={INPUT}
              aria-invalid={errors.weather ? true : undefined}
              value={form.weather ?? ''} onChange={e => setText('weather', e.target.value)} />
          </Field>
        )
      case 'wetsuit_thickness':
        return (
          <Field key={k} label={label} error={errors.wetsuit_thickness} onRemove={onRemove}>
            <input type="text" maxLength={DIVE_LOG_TEXT_MAX.wetsuit_thickness} className={INPUT}
              placeholder={dl.wetsuitThicknessPlaceholder}
              aria-invalid={errors.wetsuit_thickness ? true : undefined}
              value={form.wetsuit_thickness ?? ''} onChange={e => setText('wetsuit_thickness', e.target.value)} />
          </Field>
        )
      case 'gear_used':
        return (
          <Field key={k} label={label} wide group onRemove={onRemove}>
            <div className="flex flex-wrap gap-1.5">
              {gearChoices(form.gear_used).map(g => {
                const on = form.gear_used?.includes(g) ?? false
                return (
                  <button
                    type="button"
                    key={g}
                    onClick={() => toggleGear(g)}
                    className={on ? CHIP_ON : CHIP_OFF}
                    aria-pressed={on}
                  >
                    {g}
                  </button>
                )
              })}
            </div>
          </Field>
        )
      case 'notes':
        return (
          <Field key={k} label={label} wide error={errors.notes} onRemove={onRemove}>
            <textarea rows={3} maxLength={DIVE_LOG_TEXT_MAX.notes} className={INPUT}
              aria-invalid={errors.notes ? true : undefined}
              value={form.notes ?? ''} onChange={e => setText('notes', e.target.value)} />
          </Field>
        )
      default:
        return (
          <NumberField key={k} field={k} label={label} value={form[k]}
            error={errors[k]} onChange={setNum} onRemove={onRemove} />
        )
    }
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
        <Field label={dl.name} wide error={errors.title}>
          <input type="text" maxLength={DIVE_LOG_TEXT_MAX.title} className={INPUT}
            placeholder={dl.namePlaceholder}
            aria-invalid={errors.title ? true : undefined}
            value={form.title ?? ''} onChange={e => setText('title', e.target.value)} />
        </Field>

        <Field label={dl.diveNumberField} error={errors.dive_number}>
          <input type="number" min={1} max={DIVE_LOG_NUMBER_MAX} step={1} className={INPUT}
            aria-invalid={errors.dive_number ? true : undefined}
            value={form.dive_number ?? ''} onChange={e => setNum('dive_number', e.target.value)} />
          <span className={`mt-1 block text-xs ${TEXT_MUTED}`}>{dl.diveNumberHint}</span>
        </Field>
        <Field label={dl.date} required error={errors.dived_on}>
          <DateField required className={INPUT} value={form.dived_on}
            min={EARLIEST_DIVE_DATE} max={latestDiveDate()}
            onChange={v => set('dived_on', v)} />
        </Field>
        <Field label={dl.site} required error={errors.site}>
          <input type="text" required maxLength={DIVE_LOG_TEXT_MAX.site} className={INPUT}
            aria-invalid={errors.site ? true : undefined}
            value={form.site} onChange={e => set('site', e.target.value)} />
        </Field>

        <NumberField field="max_depth_m" label={dl.maxDepth} required value={form.max_depth_m}
          error={errors.max_depth_m} onChange={setNum} />
        <NumberField field="dive_time_min" label={dl.diveTime} required value={form.dive_time_min}
          error={errors.dive_time_min} onChange={setNum} />

        <Field label={dl.companion} required error={errors.buddy_name}>
          <input type="text" maxLength={DIVE_LOG_TEXT_MAX.buddy_name} className={INPUT}
            aria-invalid={errors.buddy_name ? true : undefined}
            value={form.buddy_name ?? ''} onChange={e => setText('buddy_name', e.target.value)} />
        </Field>

        {OPTIONAL_FIELDS.filter(k => shown.has(k)).map(optionalField)}

        {remaining.length > 0 && (
          <div className="col-span-full">
            {picking ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={dl.addFieldAria}>
                  {remaining.map(k => (
                    <button type="button" key={k} onClick={() => addField(k)} className={CHIP_OFF}>
                      {OPTIONAL_LABELS[k]}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setPicking(false)} className={BTN_XS_GHOST}>
                  {dl.addFieldDone}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setPicking(true)} className={BTN_XS_PRIMARY}>
                {dl.addField}
              </button>
            )}
          </div>
        )}
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
//
// The decimal columns take `step="any"` rather than `step="0.1"`. A concrete
// step makes the browser reject 18.55 outright, with a native tooltip and no
// way past it — but the column keeps one decimal and roundDiveLogNumbers
// already snaps to it, so the entry is fine. "any" keeps the min/max check
// and lets the rounding do the rest.
function NumberField({ field, label, required, value, error, onChange, onRemove }: {
  field: NumericField
  label: string
  required?: boolean
  value: number | null | undefined
  error?: string
  onChange: (field: NumericField, raw: string) => void
  onRemove?: () => void
}) {
  const { min, max, decimals } = DIVE_LOG_BOUNDS[field]
  return (
    <Field label={label} required={required} error={error} onRemove={onRemove}>
      <input
        type="number"
        className={INPUT}
        min={min}
        max={max}
        step={decimals === 0 ? 1 : 'any'}
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
 *
 * `onRemove` sits outside the `<label>` on purpose: a button nested in a label
 * gets the label's click forwarded to the control as well.
 */
function Field({ label, required, wide, group, error, onRemove, children }: {
  label: string
  required?: boolean
  wide?: boolean
  group?: boolean
  error?: string
  onRemove?: () => void
  children: React.ReactNode
}) {
  const caption = (
    <span className={INPUT_LABEL}>
      {label}
      {required && <span className="text-red-600 ml-0.5" aria-label={dl.requiredAria}>*</span>}
    </span>
  )
  return (
    <div className={`relative min-w-0${wide ? ' col-span-full' : ''}`}>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={dl.removeFieldAria(label)}
          className={`absolute right-0 top-0 leading-none px-1 text-sm ${TEXT_SUBTLE} hover:text-brand-50`}
        >
          ×
        </button>
      )}
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
