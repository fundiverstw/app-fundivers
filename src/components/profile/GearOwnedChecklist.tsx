import { useState, type ReactNode } from 'react'
import { gearOwnGroups, ownedInSlot, type GearOwnGroup } from '../../lib/gear'
import { t } from '../../i18n'

const p = t.profile

interface Props {
  owned: string[]
  onChange: (next: string[]) => void
}

/**
 * The "gear I own" checklist. An item the shop lists in several styles is one
 * checkbox with a styles dropdown beside it rather than one checkbox per style:
 * a diver owning both pairs of boots is a fact to record, not the rental form's
 * pick-one, and two look-alike boxes read as a choice between them.
 */
export function GearOwnedChecklist({ owned, onChange }: Props): ReactNode {
  const groups = gearOwnGroups()
  return (
    <div className="grid grid-cols-2 gap-2">
      {groups.map(group => group.styles.length === 0
        ? <PlainItem key={group.label} item={group.items[0]} owned={owned} onChange={onChange} />
        : <StyledItem key={group.label} group={group} owned={owned} onChange={onChange} />)}
    </div>
  )
}

function toggle(owned: string[], item: string): string[] {
  return owned.includes(item) ? owned.filter(i => i !== item) : [...owned, item]
}

function PlainItem({ item, owned, onChange }: { item: string } & Props): ReactNode {
  return (
    <label className="flex items-center gap-2 text-sm text-brand-900">
      <input
        type="checkbox"
        checked={owned.includes(item)}
        onChange={() => onChange(toggle(owned, item))}
        className="accent-brand-900"
      />
      {item}
    </label>
  )
}

function StyledItem({ group, owned, onChange }: { group: GearOwnGroup } & Props): ReactNode {
  // Ticking the item can't record a style on the diver's behalf — which sole
  // they own is the whole question — so the row stays ticked and open until
  // they answer it. From the first answer on, what they own drives the tick.
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const chosen = ownedInSlot(owned, group.items)
  const checked = chosen.length > 0 || pending

  function toggleItem(): void {
    if (checked) {
      setPending(false)
      setOpen(false)
      onChange(owned.filter(i => !group.items.includes(i)))
      return
    }
    setPending(true)
    setOpen(true)
  }

  const summary = chosen.length > 0
    ? chosen.map(i => group.styles[group.items.indexOf(i)]).join(', ')
    : p.gearChooseStyle

  return (
    <div className="col-span-full space-y-1">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={checked} onChange={toggleItem} className="accent-brand-900" />
          {group.label}
        </label>
        <details
          open={open}
          onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="relative"
        >
          <summary
            aria-label={p.gearStylesFor(group.label)}
            title={summary}
            className="cursor-pointer list-none max-w-40 truncate rounded-lg border border-surface-300 bg-white px-2 py-1 text-xs text-brand-900"
          >
            {summary}
          </summary>
          <div className="absolute left-0 z-10 mt-1 max-w-[70vw] space-y-1 rounded-lg border border-surface-300 bg-white p-2 shadow-lg">
            {group.items.map((item, i) => (
              <label key={item} className="flex items-center gap-2 whitespace-nowrap text-xs text-brand-900">
                <input
                  type="checkbox"
                  checked={owned.includes(item)}
                  onChange={() => { setPending(false); onChange(toggle(owned, item)) }}
                  className="accent-brand-900"
                />
                {group.styles[i]}
              </label>
            ))}
          </div>
        </details>
      </div>
      {checked && chosen.length === 0 && (
        <p className="text-xs text-amber-700 font-medium">{p.gearPickStyle}</p>
      )}
    </div>
  )
}
