import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { buildRegistrationCharges, estimateTotal, rangeDaysNights } from '../../lib/registration-estimate'
import { errorMessage } from '../../lib/errors'
import { DateField } from '../DateField'
import { siteConfig } from '../../config/site'
import type { PackageTierItem, EOAddon, EORoom } from '../../types/database'
import {
  MODAL_BACKDROP, MODAL_PANEL, INPUT, INPUT_LABEL,
  BTN_PRIMARY, BTN_SECONDARY, TEXT_HEADING, TEXT_BODY, TEXT_SUBTLE, ERROR_NOTE,
} from '../../styles/tokens'

// Shared registration wizard for the two estimate-and-notify flows: partner-shop
// Packages (tiers + a diver-picked date range) and the shop's own Scheduled Trips
// (single price + fixed trip dates). No gear/deposit/payment — the outcome is a
// cost estimate emailed to the shop/partner + the diver. Steps are computed from
// the config: a tier step when `tiers` is given, a date step when
// dateMode === 'pick'; always an extras step + a review step. Add-ons are charged
// per day, the room per night (see registration-estimate.ts). `onSubmit` runs the
// relevant edge function, which recomputes the estimate authoritatively.

type StepKind = 'tier' | 'dates' | 'extras' | 'review'

export interface RegisterSelection {
  tierId: string | null
  start: string
  end: string
  addonIds: string[]
  roomId: string | null
  notes: string
}

export interface RegisterWizardResult {
  already_registered?: boolean
  emailed?: boolean
}

interface Props {
  title: string
  subtitle?: string
  currency: string
  /** Present → show a tier-choice step (Packages). Absent → single `basePrice` (Trips). */
  tiers?: PackageTierItem[]
  basePrice?: number
  /** Prefix for the estimate base line — "Package" (tier name appended) or "Trip". */
  baseLabel: string
  /** 'pick' → diver chooses a date range; 'fixed' → derive days/nights from fixed dates. */
  dateMode: 'pick' | 'fixed'
  fixedStart?: string | null
  fixedEnd?: string | null
  addonIds: string[]
  roomTypeIds: string[]
  /** Disclaimer under the estimate (partner-cost vs shop-confirms copy). */
  disclaimer: string
  onClose: () => void
  onSubmit: (sel: RegisterSelection) => Promise<RegisterWizardResult>
  onRegistered: (result: RegisterWizardResult) => void
}

const roomLabel = (r: EORoom) => r.display_title || r.admin_title || 'Room'
const addonLabel = (a: EOAddon) => a.display_title || a.admin_title || 'Add-on'

export function RegisterWizard(props: Props) {
  const {
    title, subtitle, tiers, basePrice, baseLabel, dateMode,
    fixedStart, fixedEnd, addonIds: allowedAddonIds, roomTypeIds, disclaimer, onClose, onSubmit, onRegistered,
  } = props

  const stepKinds = useMemo<StepKind[]>(() => [
    ...(tiers && tiers.length ? (['tier'] as StepKind[]) : []),
    ...(dateMode === 'pick' ? (['dates'] as StepKind[]) : []),
    'extras', 'review',
  ], [tiers, dateMode])

  const [stepIdx, setStepIdx] = useState(0)
  const [tierId, setTierId] = useState(tiers?.[0]?.id ?? '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set())
  const [roomId, setRoomId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  const [addons, setAddons] = useState<EOAddon[]>([])
  const [rooms, setRooms] = useState<EORoom[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kind = stepKinds[stepIdx]

  // Pull the listing's allowed catalog add-ons/rooms (same source + query shape
  // as the event register form).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [aRes, rRes] = await Promise.all([
          allowedAddonIds.length
            ? supabase.from('addons').select('id, admin_title, display_title, price, currency').in('id', allowedAddonIds)
            : Promise.resolve({ data: [], error: null }),
          roomTypeIds.length
            ? supabase.from('rooms').select('id, admin_title, display_title, added_price, currency').in('id', roomTypeIds)
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
  }, [allowedAddonIds, roomTypeIds])

  const tier = tiers?.find(t => t.id === tierId) ?? null
  const { days, nights } = dateMode === 'pick'
    ? rangeDaysNights(start, end)
    : rangeDaysNights(fixedStart, fixedEnd)
  const currency = (tiers && tier?.currency) || props.currency || siteConfig.locale.currency
  const effectiveBasePrice = tiers ? (tier?.price ?? 0) : (basePrice ?? 0)
  const estimateBaseLabel = tiers && tier ? `${baseLabel}: ${tier.name}` : baseLabel

  const charges = useMemo(() => {
    const selAddons = addons
      .filter(a => addonIds.has(a.id))
      .map(a => ({ label: addonLabel(a), price: a.price ?? 0 }))
    const room = roomId ? rooms.find(r => r.id === roomId) ?? null : null
    return buildRegistrationCharges({
      baseLabel: estimateBaseLabel,
      basePrice: effectiveBasePrice,
      addons: selAddons,
      room: room ? { label: roomLabel(room), price: room.added_price ?? 0 } : null,
      days,
      nights,
    })
  }, [addons, addonIds, rooms, roomId, days, nights, estimateBaseLabel, effectiveBasePrice])
  const total = estimateTotal(charges)

  const toggleAddon = (id: string) => {
    setAddonIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const canProceed =
    (kind === 'tier' && !!tierId) ||
    (kind === 'dates' && !!start && !!end && end > start) ||
    kind === 'extras'

  const tierOk = !tiers || !!tier

  async function submit() {
    if (!tierOk) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await onSubmit({
        tierId: tiers ? tierId : null,
        start: dateMode === 'pick' ? start : (fixedStart ?? ''),
        end: dateMode === 'pick' ? end : (fixedEnd ?? ''),
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
              <h2 className={`${TEXT_HEADING} text-lg`}>Register — {title}</h2>
              <p className={`${TEXT_SUBTLE} text-xs`}>
                {subtitle ? `${subtitle} · ` : ''}step {stepIdx + 1} of {stepKinds.length}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="text-brand-50 hover:text-red-300 text-xl leading-none">×</button>
          </div>

          {error && <p className={ERROR_NOTE}>{error}</p>}

          {kind === 'tier' && tiers && (
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

          {kind === 'dates' && (
            <div className="space-y-3">
              <p className={`text-sm ${TEXT_BODY}`}>Which dates would you like to do this trip?</p>
              <div>
                <label htmlFor="rw-start" className={INPUT_LABEL}>Preferred start</label>
                <DateField id="rw-start" value={start} onChange={setStart} className={INPUT} aria-label="Preferred start date" />
              </div>
              <div>
                <label htmlFor="rw-end" className={INPUT_LABEL}>Preferred end</label>
                <DateField id="rw-end" value={end} onChange={setEnd} min={start || undefined} className={INPUT} aria-label="Preferred end date" />
              </div>
              {start && end && end > start && (
                <p className={`text-xs ${TEXT_SUBTLE}`}>{nights} night{nights === 1 ? '' : 's'} · {days} day{days === 1 ? '' : 's'}</p>
              )}
              {start && end && end <= start && (
                <p className={`text-xs ${TEXT_SUBTLE}`}>Pick an end date at least one night after the start.</p>
              )}
            </div>
          )}

          {kind === 'extras' && (
            <div className="space-y-3">
              {dateMode === 'fixed' && (fixedStart || fixedEnd) && (
                <p className={`text-xs ${TEXT_SUBTLE}`}>
                  {nights > 0 ? `${nights} night${nights === 1 ? '' : 's'} · ` : ''}{days} day{days === 1 ? '' : 's'}
                </p>
              )}
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
                <p className={`text-sm ${TEXT_SUBTLE}`}>No add-ons or room options for this trip.</p>
              )}
            </div>
          )}

          {kind === 'review' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="rw-notes" className={INPUT_LABEL}>Anything to tell the shop? (optional)</label>
                <textarea id="rw-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
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
              <p className={`text-xs ${TEXT_SUBTLE}`}>{disclaimer}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {stepIdx > 0 && (
              <button type="button" className={`${BTN_SECONDARY} flex-1 px-4`} disabled={submitting}
                onClick={() => setStepIdx(stepIdx - 1)}>Back</button>
            )}
            {kind !== 'review' ? (
              <button type="button" className={`${BTN_PRIMARY} flex-1 disabled:opacity-50`} disabled={!canProceed}
                onClick={() => setStepIdx(stepIdx + 1)}>Next</button>
            ) : (
              <button type="button" className={`${BTN_PRIMARY} flex-1 disabled:opacity-50`} disabled={submitting || !tierOk}
                onClick={submit}>{submitting ? 'Sending…' : 'Register'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
