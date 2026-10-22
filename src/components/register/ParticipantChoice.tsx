import { DIVER } from '../../lib/nondiver-options'
import { t } from '../../i18n'
import type { AppEvent, NondiverOption } from '../../types/database'

// "Registering as" for one person: the diver price, or one of the event's
// non-diver options at its own price. Radios rather than a select so every
// price is visible before anyone picks.
export function ParticipantChoice({ name, heading, value, onChange, options, event }: {
  name: string
  heading: string
  value: string
  onChange: (choice: string) => void
  options: NondiverOption[]
  event: Pick<AppEvent, 'price' | 'deposit_amount' | 'currency'>
}) {
  const p = t.register.participant
  const money = (n: number) => p.price(event.currency, n.toLocaleString())
  const rows: Array<{ id: string; label: string; price: number | null; deposit: number | null; description: string | null }> = [
    { id: DIVER, label: p.diver, price: event.price ?? null, deposit: event.deposit_amount ?? null, description: null },
    ...options.map(o => ({ id: o.id, label: o.label, price: o.price, deposit: o.deposit_amount, description: o.description })),
  ]
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-semibold text-brand-900">{heading}</legend>
      {rows.map(r => (
        <label key={r.id} className="flex items-start gap-2 text-sm text-brand-950 font-medium">
          <input type="radio" name={name} checked={value === r.id} onChange={() => onChange(r.id)} className="accent-brand-900 mt-1" />
          <span className="flex-1 min-w-0">
            <span className="block">
              {r.label}
              {r.price != null && <span className="ml-2 tabular-nums">{money(r.price)}</span>}
            </span>
            {r.deposit != null && r.deposit > 0 && (
              <span className="block text-xs text-brand-950/70 tabular-nums">{p.deposit(event.currency, r.deposit.toLocaleString())}</span>
            )}
            {r.description && <span className="block text-xs text-brand-950/70 break-words">{r.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}
