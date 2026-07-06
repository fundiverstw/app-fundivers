import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import {
  fetchGearModelsWithSizes, saveGearModel, deleteGearModel, replaceModelSizes,
} from '../../lib/gear-models'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import { numOrNull } from '../../lib/num'
import type { GearType, GearModelSizeInsert } from '../../types/database'

// Admin editor for the shop's wetsuit / BCD / fins sizing charts. Each model
// gets size rows with min/max fit ranges; the logistics board matches a diver's
// measurements against these to suggest what to pack. See gear-sizing.ts.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-2 py-1.5 text-sm text-brand-900 focus:outline-none focus:border-brand-900'
const TABS: { type: GearType; label: string }[] = [
  { type: 'wetsuit', label: 'Wetsuits' },
  { type: 'bcd', label: 'BCDs' },
  { type: 'fins', label: 'Fins' },
]

const str = (n: number | null): string => (n == null ? '' : String(n))

export function AdminGearSizingPage() {
  const toast = useToast()
  const [models, setModels] = useState<GearModelWithSizes[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<GearType>('wetsuit')

  async function reload() {
    try {
      setModels(await fetchGearModelsWithSizes())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    void (async () => {
      await reload()
      setLoading(false)
    })()
  }, [])

  const shown = useMemo(() => models.filter(m => m.gear_type === tab), [models, tab])

  async function addModel() {
    try {
      await saveGearModel({ gear_type: tab, name: 'New model', size_unit: tab === 'fins' ? 'jp' : null })
      toast.success('Model added')
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Gear sizing charts</h1>
        <p className="text-sm text-white/70 mt-1">
          Enter the shop's wetsuit, BCD and fin models with the body ranges each size fits.
          Staff can then tap a diver's gear on the logistics board to see what to pack.
        </p>
      </div>

      <div className="flex gap-2">
        {TABS.map(t => (
          <button
            key={t.type}
            onClick={() => setTab(t.type)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === t.type ? 'bg-white text-brand-900' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-white/70 text-sm">Loading…</p>}
      {loadError && <p className="text-red-200 text-sm">{loadError}</p>}

      {!loading && shown.length === 0 && (
        <p className="text-white/70 text-sm">No {tab} models yet.</p>
      )}

      {shown.map(m => (
        <GearModelEditor key={m.id} model={m} onChanged={reload} />
      ))}

      <button
        onClick={addModel}
        className="w-full py-2.5 rounded-xl font-medium border border-white/30 text-white/90 hover:bg-white/10"
      >
        + Add {tab} model
      </button>
    </div>
  )
}

interface SizeRow {
  label: string
  height_min: string; height_max: string
  weight_min: string; weight_max: string
  shoe_min: string; shoe_max: string
  chest: string; waist: string; hip: string
}

function toRow(s: GearModelWithSizes['sizes'][number]): SizeRow {
  return {
    label: s.label,
    height_min: str(s.height_min), height_max: str(s.height_max),
    weight_min: str(s.weight_min), weight_max: str(s.weight_max),
    shoe_min: str(s.shoe_min), shoe_max: str(s.shoe_max),
    chest: s.chest ?? '', waist: s.waist ?? '', hip: s.hip ?? '',
  }
}
const emptyRow: SizeRow = {
  label: '', height_min: '', height_max: '', weight_min: '', weight_max: '',
  shoe_min: '', shoe_max: '', chest: '', waist: '', hip: '',
}

function GearModelEditor({ model, onChanged }: { model: GearModelWithSizes; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const isFins = model.gear_type === 'fins'
  const [name, setName] = useState(model.name)
  const [brand, setBrand] = useState(model.brand ?? '')
  const [gender, setGender] = useState(model.gender ?? '')
  const [sizeUnit, setSizeUnit] = useState(model.size_unit ?? 'jp')
  const [active, setActive] = useState(model.active)
  const [rows, setRows] = useState<SizeRow[]>(model.sizes.map(toRow))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function setRow(i: number, patch: Partial<SizeRow>) {
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  async function save() {
    setSaving(true)
    try {
      await saveGearModel({
        id: model.id, gear_type: model.gear_type, name: name.trim() || 'Untitled',
        brand: brand.trim() || null,
        gender: isFins ? null : (gender || null),
        size_unit: isFins ? sizeUnit : null,
        active,
      })
      const sizes: GearModelSizeInsert[] = rows
        .filter(r => r.label.trim() !== '')
        .map(r => ({
          model_id: model.id, label: r.label.trim(),
          height_min: numOrNull(r.height_min), height_max: numOrNull(r.height_max),
          weight_min: numOrNull(r.weight_min), weight_max: numOrNull(r.weight_max),
          shoe_min: numOrNull(r.shoe_min), shoe_max: numOrNull(r.shoe_max),
          chest: r.chest.trim() || null, waist: r.waist.trim() || null, hip: r.hip.trim() || null,
        }))
      await replaceModelSizes(model.id, sizes)
      toast.success(`Saved ${name}`)
      await onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await deleteGearModel(model.id)
      toast.success('Model deleted')
      await onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="col-span-2 sm:col-span-2">
          <span className="block text-[10px] uppercase tracking-wide text-brand-900 font-medium mb-0.5">Model name</span>
          <input className={FIELD} value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label>
          <span className="block text-[10px] uppercase tracking-wide text-brand-900 font-medium mb-0.5">Brand</span>
          <input className={FIELD} value={brand} onChange={e => setBrand(e.target.value)} />
        </label>
        {isFins ? (
          <label>
            <span className="block text-[10px] uppercase tracking-wide text-brand-900 font-medium mb-0.5">Size unit</span>
            <select className={FIELD} value={sizeUnit} onChange={e => setSizeUnit(e.target.value)}>
              {['jp', 'eu', 'us', 'uk', 'cm'].map(u => <option key={u} value={u}>{u.toUpperCase()}</option>)}
            </select>
          </label>
        ) : (
          <label>
            <span className="block text-[10px] uppercase tracking-wide text-brand-900 font-medium mb-0.5">Cut for</span>
            <select className={FIELD} value={gender} onChange={e => setGender(e.target.value)}>
              <option value="">Unisex / any</option>
              <option value="female">Women</option>
              <option value="male">Men</option>
              <option value="kids">Kids</option>
            </select>
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs text-brand-900 min-w-full">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-brand-900/70">
              <th className="pr-2 pb-1">Size</th>
              {isFins ? (
                <><th className="px-1 pb-1">Shoe min</th><th className="px-1 pb-1">Shoe max</th></>
              ) : (
                <>
                  <th className="px-1 pb-1">Ht min</th><th className="px-1 pb-1">Ht max</th>
                  <th className="px-1 pb-1">Wt min</th><th className="px-1 pb-1">Wt max</th>
                  <th className="px-1 pb-1">Chest</th><th className="px-1 pb-1">Waist</th><th className="px-1 pb-1">Hip</th>
                </>
              )}
              <th className="pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="pr-2 py-0.5"><input aria-label={`size label ${i}`} className={`${FIELD} w-16`} value={r.label} onChange={e => setRow(i, { label: e.target.value })} /></td>
                {isFins ? (
                  <>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-16`} value={r.shoe_min} onChange={e => setRow(i, { shoe_min: e.target.value })} /></td>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-16`} value={r.shoe_max} onChange={e => setRow(i, { shoe_max: e.target.value })} /></td>
                  </>
                ) : (
                  <>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-14`} value={r.height_min} onChange={e => setRow(i, { height_min: e.target.value })} /></td>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-14`} value={r.height_max} onChange={e => setRow(i, { height_max: e.target.value })} /></td>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-14`} value={r.weight_min} onChange={e => setRow(i, { weight_min: e.target.value })} /></td>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-14`} value={r.weight_max} onChange={e => setRow(i, { weight_max: e.target.value })} /></td>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-14`} value={r.chest} onChange={e => setRow(i, { chest: e.target.value })} /></td>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-14`} value={r.waist} onChange={e => setRow(i, { waist: e.target.value })} /></td>
                    <td className="px-1 py-0.5"><input className={`${FIELD} w-14`} value={r.hip} onChange={e => setRow(i, { hip: e.target.value })} /></td>
                  </>
                )}
                <td className="pl-1 py-0.5">
                  <button aria-label={`remove size ${i}`} onClick={() => setRows(rs => rs.filter((_, idx) => idx !== i))} className="text-red-700 hover:text-red-900 px-1">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={() => setRows(rs => [...rs, { ...emptyRow }])} className="text-xs font-medium text-brand-900 hover:underline">+ Add size</button>

      <div className="flex items-center justify-between gap-2 pt-1">
        <label className="flex items-center gap-1.5 text-xs text-brand-900 font-medium">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
          Active
        </label>
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <>
              <span className="text-xs text-brand-900">Delete?</span>
              <button onClick={remove} className="text-xs font-semibold text-red-700 hover:text-red-900">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-brand-900">No</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-700 hover:text-red-900">Delete</button>
          )}
          <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </section>
  )
}
