import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { errorMessage } from '../../lib/errors'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import {
  deleteNondiverOption, fetchNondiverOptions, saveNondiverOption,
} from '../../lib/nondiver-options'
import { Spinner } from '../../components/ui/Spinner'
import { siteConfig } from '../../config/site'
import {
  CARD_ELEVATED, BTN_XS_GHOST, BTN_XS_DANGER, TEXT_MUTED, PAGE_BODY,
} from '../../styles/tokens'
import type { NondiverOption, NondiverOptionInsert } from '../../types/database'
import { t } from '../../i18n'

const nd = t.admin.nondiverOptions

// The shop's non-diver options: what someone who comes on a trip without
// diving can register as, and what they pay. Laid out like the catalog half of
// AdminDiscountsPage. Which events offer an option is ticked on the event form,
// not here.

const CURRENCY = siteConfig.locale.currency
const money = (n: number) => `${CURRENCY} ${Math.round(n).toLocaleString()}`
const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminNondiverOptionsPage() {
  const toast = useToast()
  const { profile } = useAuth()
  const [catalog, setCatalog] = useState<NondiverOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<NondiverOption | null>(null)
  const [creating, setCreating] = useState(false)

  async function reload() {
    setCatalog(await fetchNondiverOptions())
  }

  useEffect(() => {
    let alive = true
    fetchNondiverOptions()
      .then(rows => { if (alive) setCatalog(rows) })
      .catch(e => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
  }, [])

  async function remove(o: NondiverOption) {
    if (!window.confirm(nd.deleteConfirm(o.label))) return
    try {
      await deleteNondiverOption(o.id)
      await reload()
    } catch (e) {
      toast.error(errorMessage(e) || nd.deleteFailed)
    }
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto">
        <p className="text-sm text-red-200 bg-red-900/40 border border-accent rounded-lg p-3">{error}</p>
      </div>
    )
  }
  if (!catalog) {
    return (
      <div className="max-w-3xl mx-auto flex justify-center py-16">
        <Spinner className="w-6 h-6 border-2 border-surface-300" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">{nd.title}</h1>
          <p className={`text-sm ${PAGE_BODY}`}>{nd.subtitle}</p>
        </div>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg shrink-0">
          {nd.newOption}
        </button>
      </header>

      {catalog.length === 0 ? (
        <div className={`${CARD_ELEVATED} p-6 text-center`}>
          <p className={TEXT_MUTED}>{nd.empty}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {catalog.map(o => (
            <li key={o.id} className={`${CARD_ELEVATED} p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between`}>
              <div className="min-w-0">
                <p className="font-semibold text-brand-950 text-sm break-words">
                  {o.label}
                  <span className="ml-2 font-normal tabular-nums text-brand-900">{money(o.price)}</span>
                  {!o.active && <span className={`ml-2 text-xs ${TEXT_MUTED}`}>{nd.retired}</span>}
                </p>
                <p className={`text-xs ${TEXT_MUTED} tabular-nums`}>
                  {o.deposit_amount ? nd.depositOf(money(o.deposit_amount)) : nd.noDeposit}
                </p>
                {o.description && <p className={`text-xs ${TEXT_MUTED} break-words`}>{o.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(o)} className={BTN_XS_GHOST}>{nd.edit}</button>
                <button type="button" onClick={() => remove(o)} className={BTN_XS_DANGER}>{nd.remove}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <NondiverOptionForm
          option={editing}
          createdBy={profile?.id ?? null}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => {
            setCreating(false); setEditing(null)
            toast.success(nd.saved)
            await reload()
          }}
          onError={m => toast.error(m)}
        />
      )}
    </div>
  )
}

function NondiverOptionForm({ option, createdBy, onClose, onSaved, onError }: {
  option: NondiverOption | null
  createdBy: string | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [label, setLabel] = useState(option?.label ?? '')
  const [description, setDescription] = useState(option?.description ?? '')
  const [price, setPrice] = useState(option ? String(option.price) : '')
  const [deposit, setDeposit] = useState(option?.deposit_amount != null ? String(option.deposit_amount) : '')
  const [sortOrder, setSortOrder] = useState(String(option?.sort_order ?? 0))
  const [active, setActive] = useState(option?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  const priceValue = Number(price)
  const priceOk = price.trim() !== '' && Number.isInteger(priceValue) && priceValue >= 0
  const depositValue = Number(deposit)
  const depositOk = deposit.trim() === '' || (Number.isInteger(depositValue) && depositValue > 0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) { onError(nd.labelRequired); return }
    if (!priceOk) { onError(nd.priceRequired); return }
    if (!depositOk) { onError(nd.depositInvalid); return }
    setSubmitting(true)
    try {
      const values: NondiverOptionInsert = {
        label: label.trim(),
        description: description.trim() || null,
        price: priceValue,
        deposit_amount: deposit.trim() === '' ? null : depositValue,
        sort_order: Number(sortOrder) || 0,
        active,
        ...(option ? {} : { created_by: createdBy }),
      }
      await saveNondiverOption(values, option?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err) || nd.saveFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="nondiver-form-title" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <h2 id="nondiver-form-title" className="text-lg font-bold text-brand-900">
            {option ? nd.editTitle : nd.newTitle}
          </h2>

          <Labelled label={nd.labelLabel} hint={nd.labelHint}>
            <input className={FIELD} value={label} placeholder={nd.labelPh}
              onChange={e => setLabel(e.target.value)} />
          </Labelled>

          <Labelled label={nd.descriptionLabel}>
            <textarea className={FIELD} rows={2} value={description} placeholder={nd.descriptionPh}
              onChange={e => setDescription(e.target.value)} />
          </Labelled>

          <Labelled label={nd.priceLabel(CURRENCY)} hint={nd.priceHint}>
            <input className={FIELD} type="number" inputMode="numeric" min={0} value={price}
              onChange={e => setPrice(e.target.value)} />
          </Labelled>

          <Labelled label={nd.depositLabel(CURRENCY)} hint={nd.depositHint}>
            <input className={FIELD} type="number" inputMode="numeric" min={1} value={deposit}
              onChange={e => setDeposit(e.target.value)} />
          </Labelled>

          <Labelled label={t.admin.paymentMethods.sortOrderLabel}>
            <input className={FIELD} type="number" inputMode="numeric" value={sortOrder}
              onChange={e => setSortOrder(e.target.value)} />
          </Labelled>

          <label className="block space-y-1">
            <span className="flex items-center gap-2 text-sm text-brand-900">
              <input type="checkbox" checked={active} className="accent-brand-900"
                onChange={e => setActive(e.target.checked)} />
              {nd.activeLabel}
            </span>
            <span className="block text-xs text-brand-900/70">{nd.activeHint}</span>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">
              {nd.cancel}
            </button>
            <button type="submit" disabled={submitting}
              className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg">
              {nd.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-brand-900">{label}</span>
      {children}
      {hint && <span className="block text-xs text-brand-900/70">{hint}</span>}
    </label>
  )
}
