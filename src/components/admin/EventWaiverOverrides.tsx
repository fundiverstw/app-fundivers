import { useEffect, useState } from 'react'
import { WAIVERS } from '../../config/waivers'
import {
  globalRuleMatches, fetchEventWaiverOverrides, setEventWaiverOverride, type WaiverEventRef,
} from '../../lib/waivers'
import type { WaiverDef } from '../../config/waivers'
import type { EventWaiver } from '../../types/database'

// Per-event waiver requirements on the admin Edit-event form. Each waiver in the
// catalog shows whether it's required for THIS event; the admin can flip it. We
// persist an override row only when the choice diverges from the global rule
// (src/config/waivers.ts) — toggling back to the rule clears the override.
export function EventWaiverOverrides({ event, isAdmin, createdBy }: {
  event: WaiverEventRef
  isAdmin: boolean
  createdBy: string | null
}) {
  const [overrides, setOverrides] = useState<EventWaiver[] | null>(null)
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [error, setError] = useState(false)

  async function load() {
    try {
      const rows = await fetchEventWaiverOverrides(
        event.type === 'dive' ? { dive_id: event.id } : { course_id: event.id },
      )
      setOverrides(rows)
    } catch {
      setOverrides([])
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchEventWaiverOverrides(
          event.type === 'dive' ? { dive_id: event.id } : { course_id: event.id },
        )
        if (!cancelled) setOverrides(rows)
      } catch {
        if (!cancelled) setOverrides([])
      }
    })()
    return () => { cancelled = true }
  }, [event.id, event.type])

  function overrideMode(def: WaiverDef): 'require' | 'exempt' | undefined {
    return (overrides ?? []).find(o => o.waiver_code === def.code)?.mode
  }
  function effectiveRequired(def: WaiverDef): boolean {
    const ov = overrideMode(def)
    if (ov === 'require') return true
    if (ov === 'exempt') return false
    return globalRuleMatches(def, event)
  }

  async function setRequired(def: WaiverDef, required: boolean) {
    if (busyCode) return
    const rule = globalRuleMatches(def, event)
    const mode = required === rule ? null : required ? 'require' : 'exempt'
    setBusyCode(def.code); setError(false)
    try {
      await setEventWaiverOverride({ event, code: def.code, mode, createdBy })
      await load()
    } catch {
      setError(true)
    } finally {
      setBusyCode(null)
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-white uppercase tracking-wider">Waiver requirements</h2>
      <p className="text-xs text-white/60">
        Which waivers this {event.type} requires. Defaults come from the shop's waiver rules; change one
        here to require or exempt it for just this event.
      </p>
      {overrides === null ? (
        <p className="text-xs text-white/60 italic">Loading…</p>
      ) : (
        <ul className="divide-y divide-white/10 rounded-lg border border-white/10 bg-white/5">
          {WAIVERS.map(def => {
            const required = effectiveRequired(def)
            const overridden = overrideMode(def) !== undefined
            return (
              <li key={def.code} className="p-3 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm text-white font-medium truncate">{def.title}</span>
                  <span className="block text-xs text-white/50">
                    {required ? 'Required' : 'Not required'}
                    {overridden ? ' · overridden for this event' : ' · default rule'}
                  </span>
                </span>
                {isAdmin && (
                  <span className="shrink-0 inline-flex rounded-lg overflow-hidden border border-white/20">
                    <SegBtn active={required} disabled={busyCode === def.code} onClick={() => setRequired(def, true)}>Required</SegBtn>
                    <SegBtn active={!required} disabled={busyCode === def.code} onClick={() => setRequired(def, false)}>Exempt</SegBtn>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="text-xs text-red-300 font-medium">Couldn't save that change.</p>}
    </div>
  )
}

function SegBtn({ active, disabled, onClick, children }: {
  active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
        active ? 'bg-white text-brand-900' : 'bg-transparent text-white hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}
