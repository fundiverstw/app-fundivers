import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { format } from 'date-fns'
import { shopZoned } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import {
  decideBookingDiscount, deleteDiscount, discountAmount, discountValueLabel,
  fetchDiscounts, fetchOpenDiscountRequests, saveDiscount,
  type DiscountRequestRow,
} from '../../lib/discounts'
import { Spinner } from '../../components/ui/Spinner'
import { siteConfig } from '../../config/site'
import {
  CARD_ELEVATED, BTN_PRIMARY, BTN_GHOST, BTN_XS_GHOST, BTN_XS_DANGER, TEXT_MUTED, PAGE_BODY,
} from '../../styles/tokens'
import type { Discount, DiscountInsert } from '../../types/database'
import { t } from '../../i18n'

const dc = t.admin.discounts

// Two halves of the same subject, on one page for the same reason
// AdminRefundsPage keeps its two queues together: what the shop offers is only
// meaningful next to what people have asked for.
//
// The queue is the important half. A discount request changes no figure — the
// diver's balance is exactly what it was — so until someone decides, the money
// the shop is owed and the money the diver expects to pay disagree. Approving
// writes the negative amendment that closes that gap; rejecting says the gap
// was never real. Doing neither leaves it open, which is why the badge in the
// admin header counts these.

const CURRENCY = siteConfig.locale.currency
const money = (n: number) => `${CURRENCY} ${Math.round(n).toLocaleString()}`
const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminDiscountsPage() {
  const toast = useToast()
  const { profile } = useAuth()
  const [requests, setRequests] = useState<DiscountRequestRow[] | null>(null)
  const [catalog, setCatalog] = useState<Discount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [editing, setEditing] = useState<Discount | null>(null)
  const [creating, setCreating] = useState(false)

  const labels = { diverFallback: dc.diverFallback, eventFallback: dc.eventFallback }

  async function reloadCatalog() {
    setCatalog(await fetchDiscounts())
  }

  useEffect(() => {
    let alive = true
    Promise.all([fetchOpenDiscountRequests(labels), fetchDiscounts()])
      .then(([open, rows]) => {
        if (!alive) return
        setRequests(open)
        setCatalog(rows)
      })
      .catch(e => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function decide(row: DiscountRequestRow, approve: boolean) {
    // A rejection is told to the diver, so it has to say something. Prompted
    // rather than a permanent field on every row: this is a queue of one-tap
    // decisions, and an always-visible input reads as something to fill in
    // before approving, which it is not.
    let note: string | null = null
    if (!approve) {
      const answer = window.prompt(dc.rejectPrompt, '')
      if (answer === null) return
      note = answer.trim() || null
    }
    setActing(row.id)
    try {
      const applied = await decideBookingDiscount({ requestId: row.id, approve, note })
      setRequests(prev => (prev ?? []).filter(r => r.id !== row.id))
      toast.success(approve ? dc.approvedToast(money(applied)) : dc.rejectedToast)
    } catch (e) {
      toast.error(errorMessage(e) || dc.decideFailed)
    } finally {
      setActing(null)
    }
  }

  async function remove(d: Discount) {
    if (!window.confirm(dc.deleteConfirm(d.label))) return
    try {
      await deleteDiscount(d.id)
      await reloadCatalog()
    } catch {
      // The FK from booking_discounts is deliberately RESTRICT: a granted
      // discount is the reason a diver paid less, and it has to outlive the
      // shop's decision to stop offering it.
      toast.error(dc.deleteFailed)
    }
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto">
        <p className="text-sm text-red-200 bg-red-900/40 border border-accent rounded-lg p-3">{error}</p>
      </div>
    )
  }
  if (!requests || !catalog) {
    return (
      <div className="max-w-3xl mx-auto flex justify-center py-16">
        <Spinner className="w-6 h-6 border-2 border-surface-300" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className="text-xl font-bold text-white">{dc.title}</h1>
        <p className={`text-sm ${PAGE_BODY}`}>{dc.subtitle}</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{dc.queueHeading}</h2>
        <p className={`text-xs ${PAGE_BODY}`}>{dc.queueBlurb}</p>
      </section>

      {requests.length === 0 ? (
        <div className={`${CARD_ELEVATED} p-6 text-center`}>
          <p className={TEXT_MUTED}>{dc.queueEmpty}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {requests.map(r => (
            // Stacked below `sm`: two full-size buttons on one row leave a
            // 320px phone about forty pixels for the diver's name, which a
            // flex child with min-w-0 will happily render one letter per line.
            <li key={r.id} className={`${CARD_ELEVATED} p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-brand-950 break-words">{r.diverName}</div>
                <div className={`text-xs ${TEXT_MUTED} break-words`}>{r.eventTitle}</div>
                <div className={`text-xs ${TEXT_MUTED} mt-0.5`}>
                  {r.discount.label}
                  {' · '}
                  <span className="tabular-nums text-brand-900 font-medium">
                    {t.discounts.worth(money(discountAmount(r.discount, r.bookingTotal)))}
                  </span>
                  {' · '}
                  {dc.colRequested}: {format(shopZoned(new Date(r.requestedAt)), 'PP')}
                </div>
                {r.note && <div className={`text-xs ${TEXT_MUTED} mt-0.5 italic break-words`}>{r.note}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => decide(r, true)} disabled={acting === r.id}
                  className={`${BTN_PRIMARY} flex-1 sm:flex-none whitespace-nowrap`}>{dc.approve}</button>
                <button type="button" onClick={() => decide(r, false)} disabled={acting === r.id}
                  className={`${BTN_GHOST} flex-1 sm:flex-none whitespace-nowrap`}>{dc.reject}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2 pt-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{dc.catalogHeading}</h2>
          {/* The page-level "new" button every other catalog page uses. A ghost
              button here would be brand-on-brand in the light design, where the
              page background is the navy this token's border and ink are. */}
          <button type="button" onClick={() => setCreating(true)}
            className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg shrink-0">
            {dc.newDiscount}
          </button>
        </div>
        <p className={`text-xs ${PAGE_BODY}`}>{dc.catalogBlurb}</p>
      </section>

      {catalog.length === 0 ? (
        <div className={`${CARD_ELEVATED} p-6 text-center`}>
          <p className={TEXT_MUTED}>{dc.catalogEmpty}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {catalog.map(d => (
            <li key={d.id} className={`${CARD_ELEVATED} p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between`}>
              <div className="min-w-0">
                <p className="font-semibold text-brand-950 text-sm break-words">
                  {d.label}
                  <span className="ml-2 font-normal tabular-nums text-brand-900">
                    {discountValueLabel(d, CURRENCY)}
                  </span>
                  {!d.active && <span className={`ml-2 text-xs ${TEXT_MUTED}`}>{dc.retired}</span>}
                </p>
                {d.description && <p className={`text-xs ${TEXT_MUTED} break-words`}>{d.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(d)} className={BTN_XS_GHOST}>{dc.edit}</button>
                <button type="button" onClick={() => remove(d)} className={BTN_XS_DANGER}>{dc.remove}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <DiscountForm
          discount={editing}
          createdBy={profile?.id ?? null}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => {
            setCreating(false); setEditing(null)
            toast.success(dc.saved)
            await reloadCatalog()
          }}
          onError={m => toast.error(m)}
        />
      )}
    </div>
  )
}

function DiscountForm({ discount, createdBy, onClose, onSaved, onError }: {
  discount: Discount | null
  createdBy: string | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [label, setLabel] = useState(discount?.label ?? '')
  const [description, setDescription] = useState(discount?.description ?? '')
  const [kind, setKind] = useState<'percent' | 'fixed'>(discount?.kind ?? 'percent')
  const [value, setValue] = useState(String(discount?.value ?? 10))
  const [sortOrder, setSortOrder] = useState(String(discount?.sort_order ?? 0))
  const [active, setActive] = useState(discount?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  const numericValue = Number(value)
  const valueOk = Number.isInteger(numericValue) && (
    kind === 'percent' ? numericValue >= 1 && numericValue <= 100 : numericValue > 0
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) { onError(dc.labelRequired); return }
    if (!valueOk) { onError(dc.valueRequired); return }
    setSubmitting(true)
    try {
      const values: DiscountInsert = {
        label: label.trim(),
        description: description.trim() || null,
        kind,
        value: numericValue,
        sort_order: Number(sortOrder) || 0,
        active,
        ...(discount ? {} : { created_by: createdBy }),
      }
      await saveDiscount(values, discount?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err) || dc.saveFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="discount-form-title" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <h2 id="discount-form-title" className="text-lg font-bold text-brand-900">
            {discount ? dc.editTitle : dc.newTitle}
          </h2>

          <Labelled label={dc.labelLabel} hint={dc.labelHint}>
            <input className={FIELD} value={label} placeholder={dc.labelPh}
              onChange={e => setLabel(e.target.value)} />
          </Labelled>

          <Labelled label={dc.descriptionLabel}>
            <textarea className={FIELD} rows={2} value={description} placeholder={dc.descriptionPh}
              onChange={e => setDescription(e.target.value)} />
          </Labelled>

          <Labelled label={dc.kindLabel}>
            <select className={FIELD} value={kind}
              onChange={e => setKind(e.target.value as 'percent' | 'fixed')}>
              <option value="percent">{dc.kindPercent}</option>
              <option value="fixed">{dc.kindFixed}</option>
            </select>
          </Labelled>

          <Labelled
            label={dc.valueLabel}
            hint={kind === 'percent' ? dc.percentHint : dc.fixedHint(CURRENCY)}
          >
            <input className={FIELD} type="number" inputMode="numeric" value={value}
              onChange={e => setValue(e.target.value)} />
          </Labelled>

          <Labelled label={t.admin.paymentMethods.sortOrderLabel}>
            <input className={FIELD} type="number" inputMode="numeric" value={sortOrder}
              onChange={e => setSortOrder(e.target.value)} />
          </Labelled>

          <label className="block space-y-1">
            <span className="flex items-center gap-2 text-sm text-brand-900">
              <input type="checkbox" checked={active} className="accent-brand-900"
                onChange={e => setActive(e.target.checked)} />
              {dc.activeLabel}
            </span>
            <span className="block text-xs text-brand-900/70">{dc.activeHint}</span>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">
              {dc.cancel}
            </button>
            <button type="submit" disabled={submitting}
              className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg">
              {dc.save}
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
