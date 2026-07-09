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
import { DateField } from '../components/DateField'
import { DIVE_TYPES, GAS_MIXES, type DiveLog, type DiveLogInsert, type DiveType, type GasMix } from '../types/database'
import {
  CARD, CARD_ELEVATED, BTN_PRIMARY, BTN_GHOST, BTN_DANGER, BTN_LIGHT,
  TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, INPUT, INPUT_LABEL, PAGE_BODY,
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

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  function setNum(k: keyof FormState, raw: string) {
    if (raw === '') return setForm(prev => ({ ...prev, [k]: null } as FormState))
    const n = Number(raw)
    if (Number.isFinite(n)) setForm(prev => ({ ...prev, [k]: n } as FormState))
  }

  function setText(k: keyof FormState, raw: string) {
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
    if (!form.site || !form.dived_on) return
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`text-lg ${TEXT_HEADING}`}>
          {editingNumber ? dl.diveNumber(editingNumber) : dl.newDive}
        </h2>
        <button type="button" onClick={onCancel} className={`text-xs ${TEXT_SUBTLE} hover:underline`}>
          {dl.backToList}
        </button>
      </div>

      <div className={`${CARD_ELEVATED} p-4 grid grid-cols-1 sm:grid-cols-2 gap-3`}>
        <Field label={dl.date} required>
          <DateField required className={INPUT} value={form.dived_on}
            onChange={v => set('dived_on', v)} />
        </Field>
        <Field label={dl.site} required>
          <input type="text" required maxLength={120} className={INPUT} value={form.site}
            onChange={e => set('site', e.target.value)} />
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

        <Field label={dl.maxDepth}>
          <input type="number" step="0.1" min="0" max="200" className={INPUT}
            value={form.max_depth_m ?? ''} onChange={e => setNum('max_depth_m', e.target.value)} />
        </Field>
        <Field label={dl.diveTime}>
          <input type="number" min="0" max="480" className={INPUT}
            value={form.dive_time_min ?? ''} onChange={e => setNum('dive_time_min', e.target.value)} />
        </Field>

        <Field label={dl.visibility}>
          <input type="number" step="0.1" min="0" className={INPUT}
            value={form.visibility_m ?? ''} onChange={e => setNum('visibility_m', e.target.value)} />
        </Field>
        <Field label={dl.waterTemp}>
          <input type="number" step="0.1" className={INPUT}
            value={form.water_temp_c ?? ''} onChange={e => setNum('water_temp_c', e.target.value)} />
        </Field>

        <Field label={dl.airTemp}>
          <input type="number" step="0.1" className={INPUT}
            value={form.air_temp_c ?? ''} onChange={e => setNum('air_temp_c', e.target.value)} />
        </Field>
        <Field label={dl.waveHeight}>
          <input type="number" step="0.1" min="0" className={INPUT}
            value={form.wave_height_m ?? ''} onChange={e => setNum('wave_height_m', e.target.value)} />
        </Field>

        <Field label={dl.weather}>
          <input type="text" className={INPUT} value={form.weather ?? ''}
            onChange={e => setText('weather', e.target.value)} />
        </Field>
        <Field label={dl.weight}>
          <input type="number" step="0.1" min="0" className={INPUT}
            value={form.weight_kg ?? ''} onChange={e => setNum('weight_kg', e.target.value)} />
        </Field>

        <Field label={dl.tankSize}>
          <input type="number" step="0.1" min="0" className={INPUT}
            value={form.tank_size_l ?? ''} onChange={e => setNum('tank_size_l', e.target.value)} />
        </Field>
        <Field label={dl.startPressure}>
          <input type="number" min="0" max="350" className={INPUT}
            value={form.start_pressure_bar ?? ''} onChange={e => setNum('start_pressure_bar', e.target.value)} />
        </Field>

        <Field label={dl.endPressure}>
          <input type="number" min="0" max="350" className={INPUT}
            value={form.end_pressure_bar ?? ''} onChange={e => setNum('end_pressure_bar', e.target.value)} />
        </Field>
        <Field label={dl.buddy}>
          <input type="text" className={INPUT} value={form.buddy_name ?? ''}
            onChange={e => setText('buddy_name', e.target.value)} />
        </Field>

        <Field label={dl.instructor}>
          <input type="text" className={INPUT} value={form.instructor_name ?? ''}
            onChange={e => setText('instructor_name', e.target.value)} />
        </Field>
        <Field label={dl.gearUsed}>
          <div className="flex flex-wrap gap-1.5 col-span-2">
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

function Field({ label, required, wide, children }: {
  label: string
  required?: boolean
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <label className={INPUT_LABEL}>
        {label}
        {required && <span className="text-red-600 ml-0.5" aria-label={dl.requiredAria}>*</span>}
      </label>
      {children}
    </div>
  )
}
