import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { registerForPackage, type RegisterForPackageResult } from '../../lib/packages'
import { buildPackageCharges, estimateTotal, rangeDaysNights } from '../../lib/package-estimate'
import { errorMessage } from '../../lib/errors'
import { DateField } from '../DateField'
import { siteConfig } from '../../config/site'
import type { PackageBoardItem, PackageTierItem, EOAddon, EORoom } from '../../types/database'
import {
  MODAL_BACKDROP, MODAL_PANEL, INPUT, INPUT_LABEL,
  BTN_PRIMARY, BTN_SECONDARY, TEXT_HEADING, TEXT_BODY, TEXT_SUBTLE, ERROR_NOTE,
} from '../../styles/tokens'

// Registration wizard for a partner-shop package. Unlike the shop's own event
// register form there's no gear/deposit/payment — a partner package is a
// non-binding recommendation with a cost estimate. Steps: tier → dates →
// extras → review. Add-ons are charged per day, the room per night, over the
// diver's preferred range (see package-estimate.ts). Submit runs the
// register-package edge function, which recomputes the estimate authoritatively.

type Step = 1 | 2 | 3 | 4

interface Props {
  pkg: PackageBoardItem
  tiers: PackageTierItem[]
  onClose: () => void
  onRegistered: (result: RegisterForPackageResult) => void
}

const roomLabel = (r: EORoom) => r.display_title || r.admin_title || 'Room'
const addonLabel = (a: EOAddon) => a.display_title || a.admin_title || 'Add-on'

export function PackageRegisterForm({ pkg, tiers, onClose, onRegistered }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set())
  const [roomId, setRoomId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  const [addons, setAddons] = useState<EOAddon[]>([])
  const [rooms, setRooms] = useState<EORoom[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pull the package's allowed catalog add-ons/rooms (same source + query shape
  // as the event register form).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [aRes, rRes] = await Promise.all([
          pkg.addon_ids.length
            ? supabase.from('addons').select('id, admin_title, display_title, price, currency').in('id', pkg.addon_ids)
            : Promise.resolve({ data: [], error: null }),
          pkg.room_type_ids.length
            ? supabase.from('rooms').select('id, admin_title, display_title, added_price, currency').in('id', pkg.room_type_ids)
            : Promise.resolve({ data: [], error: null }),
        ])
        if (cancelled) return
        if (aRes.error) throw aRes.error
        if (rRes.error) throw rRes.error
        setAddons((aRes.data ?? []) as EOAddon[])
        setRooms((rRes.data ?? []) as EORoom[])
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      }
    })()
    return () => { cancelled = true }
  }, [pkg.addon_ids, pkg.room_type_ids])

  const tier = tiers.find(t => t.id === tierId) ?? null
  const { days, nights } = rangeDaysNights(start, end)
  const currency = tier?.currency ?? pkg.currency ?? siteConfig.locale.currency

  const charges = useMemo(() => {
    if (!tier) return []
    const selAddons = addons
      .filter(a => addonIds.has(a.id))
      .map(a => ({ label: addonLabel(a), price: a.price ?? 0 }))
    const room = roomId ? rooms.find(r => r.id === roomId) ?? null : null
    return buildPackageCharges({
      tierName: tier.name,
      tierPrice: tier.price,
      addons: selAddons,
      room: room ? { label: roomLabel(room), price: room.added_price ?? 0 } : null,
      days,
      nights,
    })
  }, [tier, addons, addonIds, rooms, roomId, days, nights])
  const total = estimateTotal(charges)

  const toggleAddon = (id: string) => {
    setAddonIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const canNext =
    (step === 1 && !!tierId) ||
    (step === 2 && !!start && !!end && end > start) ||
    step === 3

  async function submit() {
    if (!tier) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await registerForPackage({
        packageId: pkg.id,
        tierId,
        preferredStart: start,
        preferredEnd: end,
        addonIds: [...addonIds],
        roomId,
        notes: notes.trim(),
      })
      onRegistered(result)
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  const money = (n: number) => `${n.toLocaleString()} ${currency}`

  return (
    <div className={MODAL_BACKDROP} onClick={onClose}>
      <div className="flex items-start justify-center px-4 pt-8 pb-4 h-full overflow-y-auto">
        <div onClick={e => e.stopPropagation()} className={`${MODAL_PANEL} w-full max-w-md p-6 space-y-4`}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className={`${TEXT_HEADING} text-lg`}>Register — {pkg.title}</h2>
              <p className={`${TEXT_SUBTLE} text-xs`}>with {pkg.partner_name} · step {step} of 4</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="text-brand-50 hover:text-red-300 text-xl leading-none">×</button>
          </div>

          {error && <p className={ERROR_NOTE}>{error}</p>}

          {step === 1 && (
            <fieldset className="space-y-2">
              <legend className={`${INPUT_LABEL} mb-0`}>Choose a package</legend>
              {tiers.map(t => (
                <label key={t.id} className="flex items-center justify-between gap-3 bg-white/5 border border-white/15 rounded-lg px-3 py-2 cursor-pointer">
                  <span className="flex items-center gap-2">
                    <input type="radio" name="tier" value={t.id} checked={tierId === t.id} onChange={() => setTierId(t.id)} />
                    <span className={`text-sm ${TEXT_BODY}`}>{t.name}</span>
                  </span>
                  <span className={`text-sm ${TEXT_HEADING}`}>{t.price.toLocaleString()} {t.currency}</span>
                </label>
              ))}
              {tiers.length === 0 && <p className={`text-sm ${TEXT_SUBTLE}`}>No tiers available.</p>}
            </fieldset>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className={`text-sm ${TEXT_BODY}`}>Which dates would you like to do this trip?</p>
              <div>
                <label htmlFor="pkg-start" className={INPUT_LABEL}>Preferred start</label>
                <DateField id="pkg-start" value={start} onChange={setStart} className={INPUT} aria-label="Preferred start date" />
              </div>
              <div>
                <label htmlFor="pkg-end" className={INPUT_LABEL}>Preferred end</label>
                <DateField id="pkg-end" value={end} onChange={setEnd} min={start || undefined} className={INPUT} aria-label="Preferred end date" />
              </div>
              {start && end && end > start && (
                <p className={`text-xs ${TEXT_SUBTLE}`}>{nights} night{nights === 1 ? '' : 's'} · {days} day{days === 1 ? '' : 's'}</p>
              )}
              {start && end && end <= start && (
                <p className={`text-xs ${TEXT_SUBTLE}`}>Pick an end date at least one night after the start.</p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {addons.length > 0 && (
                <fieldset className="space-y-1">
                  <legend className={`${INPUT_LABEL} mb-0`}>Add-ons <span className={TEXT_SUBTLE}>(per day)</span></legend>
                  {addons.map(a => (
                    <label key={a.id} className="flex items-center justify-between gap-3 bg-white/5 border border-white/15 rounded-lg px-3 py-2 cursor-pointer">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={addonIds.has(a.id)} onChange={() => toggleAddon(a.id)} />
                        <span className={`text-sm ${TEXT_BODY}`}>{addonLabel(a)}</span>
                      </span>
                      <span className={`text-sm ${TEXT_SUBTLE}`}>{(a.price ?? 0).toLocaleString()}/day</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {rooms.length > 0 && (
                <fieldset className="space-y-1">
                  <legend className={`${INPUT_LABEL} mb-0`}>Room <span className={TEXT_SUBTLE}>(per night)</span></legend>
                  <label className="flex items-center gap-2 bg-white/5 border border-white/15 rounded-lg px-3 py-2 cursor-pointer">
                    <input type="radio" name="room" checked={roomId === null} onChange={() => setRoomId(null)} />
                    <span className={`text-sm ${TEXT_BODY}`}>No room</span>
                  </label>
                  {rooms.map(r => (
                    <label key={r.id} className="flex items-center justify-between gap-3 bg-white/5 border border-white/15 rounded-lg px-3 py-2 cursor-pointer">
                      <span className="flex items-center gap-2">
                        <input type="radio" name="room" checked={roomId === r.id} onChange={() => setRoomId(r.id)} />
                        <span className={`text-sm ${TEXT_BODY}`}>{roomLabel(r)}</span>
                      </span>
                      <span className={`text-sm ${TEXT_SUBTLE}`}>{(r.added_price ?? 0).toLocaleString()}/night</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {addons.length === 0 && rooms.length === 0 && (
                <p className={`text-sm ${TEXT_SUBTLE}`}>No add-ons or room options for this package.</p>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div>
                <label htmlFor="pkg-notes" className={INPUT_LABEL}>Anything to tell the shop? (optional)</label>
                <textarea id="pkg-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                  className={INPUT} placeholder="Dietary needs, experience level, questions…" />
              </div>
              <div className="bg-white/5 border border-white/15 rounded-lg p-3 space-y-1">
                <p className={`text-sm ${TEXT_HEADING}`}>Cost estimate</p>
                {charges.map((c, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className={TEXT_BODY}>{c.label}</span>
                    <span className={TEXT_BODY}>{money(c.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-white/10">
                  <span className={TEXT_HEADING}>Estimated total</span>
                  <span className={TEXT_HEADING}>{money(total)}</span>
                </div>
              </div>
              <p className={`text-xs ${TEXT_SUBTLE}`}>
                This is an estimate only — the final cost will be determined by the partner shop.
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {step > 1 && (
              <button type="button" className={`${BTN_SECONDARY} flex-1 px-4`} disabled={submitting}
                onClick={() => setStep((step - 1) as Step)}>Back</button>
            )}
            {step < 4 ? (
              <button type="button" className={`${BTN_PRIMARY} flex-1 disabled:opacity-50`} disabled={!canNext}
                onClick={() => setStep((step + 1) as Step)}>Next</button>
            ) : (
              <button type="button" className={`${BTN_PRIMARY} flex-1 disabled:opacity-50`} disabled={submitting || !tier}
                onClick={submit}>{submitting ? 'Sending…' : 'Register'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
