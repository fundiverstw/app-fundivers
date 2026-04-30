import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'

function capitalize(s: string) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

// Generic list+create+edit+delete UI for the simple catalog tables backing
// /admin/rooms, /admin/addons, /admin/travel. Each row's _id is an
// auto-generated uuid (text PK on the Wix-legacy tables); the rest of the
// columns are user-editable strings or numbers per the field spec.
//
// One reusable shell instead of three near-identical pages so the create
// and edit flows always behave the same regardless of which catalog the
// admin is editing.

export type CatalogFieldType = 'text' | 'textarea' | 'number'

export interface CatalogField<Row> {
  key: keyof Row & string
  label: string
  type: CatalogFieldType
  /** Reject empty strings on submit. Numbers coerce '' → null and aren't required by default. */
  required?: boolean
  /** Optional placeholder shown inside the input. */
  placeholder?: string
}

export interface CatalogManagerProps<Row extends { _id: string }> {
  /** Page heading. */
  title: string
  /** Supabase table name (case-sensitive — the "EO_*" tables are quoted). */
  table: string
  /** Editable fields. _id is auto-generated and never appears here. */
  fields: CatalogField<Row>[]
  /** Column to sort by when listing (defaults to the first field's key). */
  orderBy?: keyof Row & string
  /** Primary label shown for each row in the list. */
  rowLabel: (row: Row) => string
  /** Optional second line under the label (e.g. price summary). */
  rowDetail?: (row: Row) => string | null
  /** Friendly singular noun used in confirm/empty messages, e.g. "room option". */
  noun: string
}

type FormValues = Record<string, string>

function blankForm<Row>(fields: CatalogField<Row>[]): FormValues {
  const out: FormValues = {}
  for (const f of fields) out[f.key] = ''
  return out
}

function rowToForm<Row>(row: Row, fields: CatalogField<Row>[]): FormValues {
  const out: FormValues = {}
  for (const f of fields) {
    const v = (row as Record<string, unknown>)[f.key]
    out[f.key] = v == null ? '' : String(v)
  }
  return out
}

function formToPayload<Row>(form: FormValues, fields: CatalogField<Row>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const raw = form[f.key]?.trim() ?? ''
    if (f.type === 'number') {
      out[f.key] = raw === '' ? null : Number(raw)
    } else {
      out[f.key] = raw === '' ? null : raw
    }
  }
  return out
}

export function CatalogManager<Row extends { _id: string }>({
  title, table, fields, orderBy, rowLabel, rowDetail, noun,
}: CatalogManagerProps<Row>) {
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // editing = a row currently being edited; creating = true when the form
  // is open in create mode. They are mutually exclusive.
  const [editing, setEditing] = useState<Row | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormValues>(() => blankForm(fields))
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null)
  const [deleteInFlight, setDeleteInFlight] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const sortKey: string = orderBy ?? fields[0]?.key ?? '_id'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from(table).select('*').order(sortKey)
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
      } else {
        setRows((data ?? []) as Row[])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [table, sortKey])

  function openCreate() {
    setEditing(null)
    setForm(blankForm(fields))
    setSubmitError(null)
    setCreating(true)
  }

  function openEdit(row: Row) {
    setCreating(false)
    setForm(rowToForm(row, fields))
    setSubmitError(null)
    setEditing(row)
  }

  function closeForm() {
    setCreating(false)
    setEditing(null)
    setForm(blankForm(fields))
    setSubmitError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    for (const f of fields) {
      if (f.required && !form[f.key]?.trim()) {
        setSubmitError(`${f.label} is required.`)
        return
      }
    }
    setSubmitting(true)
    try {
      const payload = formToPayload(form, fields)
      if (editing) {
        const { error } = await supabase
          .from(table)
          .update(payload as never)
          .eq('_id', editing._id)
        if (error) throw error
        setRows(prev => prev.map(r => r._id === editing._id ? { ...r, ...payload } as Row : r))
        toast.success(`${capitalize(noun)} updated`)
      } else {
        const id = crypto.randomUUID()
        const insertPayload = { _id: id, ...payload }
        const { error } = await supabase.from(table).insert(insertPayload as never)
        if (error) throw error
        setRows(prev => [...prev, insertPayload as unknown as Row])
        toast.success(`${capitalize(noun)} created`)
      }
      closeForm()
    } catch (err) {
      const msg = errorMessage(err)
      setSubmitError(msg)
      toast.error(`Could not save ${noun}: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function performDelete(row: Row) {
    setDeleteInFlight(true)
    setDeleteError(null)
    try {
      const { error } = await supabase.from(table).delete().eq('_id', row._id)
      if (error) throw error
      setRows(prev => prev.filter(r => r._id !== row._id))
      setConfirmDelete(null)
      toast.success(`${capitalize(noun)} deleted`)
    } catch (err) {
      const msg = errorMessage(err)
      setDeleteError(msg)
      toast.error(`Could not delete ${noun}: ${msg}`)
    } finally {
      setDeleteInFlight(false)
    }
  }


  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <button
          type="button"
          onClick={openCreate}
          className="text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg"
        >
          + New {noun}
        </button>
      </div>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-red-500 rounded-md p-2">
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-white/70">No {noun}s yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => (
            <li
              key={row._id}
              className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-blue-900 text-sm truncate">{rowLabel(row)}</p>
                {rowDetail && rowDetail(row) && (
                  <p className="text-xs text-blue-900/80 truncate">{rowDetail(row)}</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(row)}
                  className="text-xs font-semibold bg-blue-900 hover:bg-blue-950 text-white px-3 py-1 rounded-lg"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => { setDeleteError(null); setConfirmDelete(row) }}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <CatalogFormModal
          title={editing ? `Edit ${noun}` : `New ${noun}`}
          fields={fields}
          form={form}
          onChange={(key, value) => setForm(f => ({ ...f, [key]: value }))}
          submitting={submitting}
          submitError={submitError}
          submitLabel={editing ? 'Save changes' : `Create ${noun}`}
          onClose={closeForm}
          onSubmit={handleSubmit}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          noun={noun}
          label={rowLabel(confirmDelete)}
          inFlight={deleteInFlight}
          error={deleteError}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => performDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function CatalogFormModal<Row>({
  title, fields, form, onChange, submitting, submitError, submitLabel, onClose, onSubmit,
}: {
  title: string
  fields: CatalogField<Row>[]
  form: FormValues
  onChange: (key: string, value: string) => void
  submitting: boolean
  submitError: string | null
  submitLabel: string
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <Modal labelledBy="catalog-form-title" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <h2 id="catalog-form-title" className="text-lg font-bold text-blue-900">{title}</h2>
        {fields.map(f => (
          <FieldRow key={f.key} field={f} value={form[f.key] ?? ''} onChange={v => onChange(f.key, v)} />
        ))}
        {submitError && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-500 rounded px-2 py-1">{submitError}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-blue-900 border border-sky-300 hover:bg-sky-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-900 hover:bg-blue-950 text-white disabled:opacity-50"
          >
            {submitting ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function FieldRow<Row>({
  field, value, onChange,
}: { field: CatalogField<Row>; value: string; onChange: (v: string) => void }) {
  const inputClass = 'w-full bg-white border border-sky-300 rounded-md px-3 py-2 text-sm text-blue-900 focus:outline-none focus:border-blue-900'
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-blue-900">{field.label}{field.required && ' *'}</span>
      {field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          placeholder={field.placeholder}
          className={`${inputClass} resize-none`}
        />
      ) : (
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          step={field.type === 'number' ? 'any' : undefined}
          className={inputClass}
        />
      )}
    </label>
  )
}

function ConfirmDeleteModal({
  noun, label, inFlight, error, onClose, onConfirm,
}: {
  noun: string
  label: string
  inFlight: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal labelledBy="catalog-delete-title" onClose={onClose}>
      <h2 id="catalog-delete-title" className="text-lg font-bold text-blue-900">Delete {noun}?</h2>
      <p className="text-sm text-blue-900">
        “{label}” will be permanently deleted. Existing bookings that reference
        this {noun} retain a record of the choice but the catalog entry will no
        longer appear in pickers.
      </p>
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-500 rounded px-2 py-1">{error}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={inFlight}
          className="flex-1 py-2 rounded-lg text-sm font-medium text-blue-900 border border-sky-300 hover:bg-sky-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={inFlight}
          className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50"
        >
          {inFlight ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  )
}

function Modal({
  labelledBy, onClose, children,
}: {
  labelledBy: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
