import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  annualWaivers, annualWaiverStatus, latestSignatureFor,
  fetchDiverSignatures, fetchWaivers, recordPaperWaiver,
  type AnnualWaiverStatus,
} from '../../lib/waivers'
import { errorMessage } from '../../lib/errors'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import type { WaiverDef } from '../../config/waivers'
import type { WaiverSignature } from '../../types/database'
import { t } from '../../i18n'
import { BTN_XS_GHOST } from '../../styles/tokens'

const dw = t.admin.diverWaivers

// Admin counterpart to the diver's own "My Waivers" panel, on the expanded user
// card. Two things the event roster cannot do:
//
//   * Reach a diver-level waiver that no event requires. `applies_to = 'none'`
//     waivers (a medical questionnaire, say) never show as missing on a roster,
//     so a paper one had nowhere to be logged.
//   * Reach a diver with no booking at all. Walk-ins hand over a signed form
//     before they are on any event.
//
// Scope is the annual, diver-level catalog — the same set the diver sees. A
// per-event waiver is meaningless without its event and stays on the roster.
export function DiverWaivers({ diverId, diverName }: { diverId: string; diverName: string | null }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const toast = useToast()
  const [signatures, setSignatures] = useState<WaiverSignature[] | null>(null)
  const [catalog, setCatalog] = useState<WaiverDef[]>([])
  const [failed, setFailed] = useState(false)
  const [recording, setRecording] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [rows, waivers] = await Promise.all([fetchDiverSignatures(diverId), fetchWaivers()])
    setSignatures(rows)
    setCatalog(waivers)
  }, [diverId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await load()
      } catch {
        // Say so rather than render rows. An empty signature list would read as
        // "this diver has signed nothing" and invite a duplicate paper record;
        // the opposite guess would hide a genuinely missing form.
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [load])

  async function markInPerson(def: WaiverDef) {
    if (!diverName) return
    if (!window.confirm(dw.confirm(diverName, def.title))) return
    setRecording(def.code)
    try {
      await recordPaperWaiver({ diverId, def, signedName: diverName })
      await load()
      toast.success(dw.recorded)
    } catch (err) {
      toast.error(dw.failed(errorMessage(err)))
    } finally {
      setRecording(null)
    }
  }

  const waivers = annualWaivers(catalog)
  const now = new Date()

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wider">{dw.title}</h2>
        <p className="text-xs text-brand-950/70 font-medium">{dw.intro}</p>
      </div>
      {failed ? (
        <p className="text-xs text-amber-700 font-medium">{dw.loadFailed}</p>
      ) : signatures === null ? (
        <p className="text-xs text-brand-950/70 font-medium italic">{dw.loading}</p>
      ) : waivers.length === 0 ? (
        <p className="text-xs text-brand-950 font-medium">{dw.noneInCatalog}</p>
      ) : (
        <>
          <ul className="divide-y divide-surface-200">
            {waivers.map(def => (
              <WaiverRow
                key={def.code}
                def={def}
                status={annualWaiverStatus(def, signatures, now)}
                latest={latestSignatureFor(def.code, signatures)}
                busy={recording === def.code}
                canRecord={isAdmin && !!diverName}
                onMarkInPerson={() => markInPerson(def)}
              />
            ))}
          </ul>
          {isAdmin && !diverName && (
            // The name is stored as the signature on the record, so there is
            // nothing honest to write without one. Statuses still show.
            <p className="text-xs text-amber-700 font-medium">{dw.needsName}</p>
          )}
        </>
      )}
    </section>
  )
}

const STATUS_LABEL: Record<AnnualWaiverStatus['state'], string> = {
  signed: t.profile.waivers.statusSigned,
  expired: t.profile.waivers.statusExpired,
  outdated: t.profile.waivers.statusOutdated,
  unsigned: t.profile.waivers.statusUnsigned,
}
const STATUS_CLASS: Record<AnnualWaiverStatus['state'], string> = {
  signed: 'text-emerald-700',
  expired: 'text-red-600',
  outdated: 'text-amber-700',
  unsigned: 'text-red-600',
}

function WaiverRow({ def, status, latest, busy, canRecord, onMarkInPerson }: {
  def: WaiverDef
  status: AnnualWaiverStatus
  latest: WaiverSignature | null
  busy: boolean
  canRecord: boolean
  onMarkInPerson: () => void
}) {
  const ok = status.state === 'signed'
  return (
    <li className="py-2 flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm text-brand-900 font-medium truncate">{def.title}</span>
        <span className={`block text-xs font-medium ${STATUS_CLASS[status.state]}`}>
          {STATUS_LABEL[status.state]}
          {ok && status.validUntil && (
            <span className="text-brand-950/70">
              {t.profile.waivers.validUntil(format(new Date(status.validUntil), 'MMM d, yyyy'))}
            </span>
          )}
        </span>
        {latest && (
          // How it was captured, and when. A paper record must never read like
          // the diver e-signed it.
          <span className="block text-xs text-brand-950/70 font-medium">
            {latest.method === 'in_person' ? dw.capturedInPerson : dw.capturedInApp}
            {dw.onDate(format(new Date(latest.signed_at), 'MMM d, yyyy'))}
          </span>
        )}
      </span>
      {canRecord && (
        <button
          type="button"
          onClick={onMarkInPerson}
          disabled={busy}
          className={`${BTN_XS_GHOST} shrink-0 whitespace-nowrap`}
        >
          {busy ? dw.recordingBusy : dw.markInPerson}
        </button>
      )}
    </li>
  )
}
