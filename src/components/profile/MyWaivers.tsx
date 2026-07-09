import { useEffect, useState } from 'react'
import { annualWaivers, annualWaiverStatus, fetchDiverSignatures, fetchWaivers, type AnnualWaiverStatus } from '../../lib/waivers'
import { WaiverSignDialog } from '../waivers/WaiverSignDialog'
import type { WaiverDef } from '../../config/waivers'
import type { WaiverSignature } from '../../types/database'
import { t } from '../../i18n'

// "My Waivers" — the diver-facing panel on the profile page. Lists the annual,
// diver-level waivers (the per-course ones are signed in context at
// registration, not here) and their current status, with a Sign / Re-sign
// button that opens the shared e-signature dialog.
export function MyWaivers({ diverId }: { diverId: string }) {
  const [signatures, setSignatures] = useState<WaiverSignature[] | null>(null)
  const [catalog, setCatalog] = useState<WaiverDef[]>([])
  const [signing, setSigning] = useState<WaiverDef | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [rows, waivers] = await Promise.all([fetchDiverSignatures(diverId), fetchWaivers()])
        if (!cancelled) { setSignatures(rows); setCatalog(waivers) }
      } catch {
        if (!cancelled) setSignatures([])
      }
    })()
    return () => { cancelled = true }
  }, [diverId])

  async function refresh() {
    setSigning(null)
    try {
      setSignatures(await fetchDiverSignatures(diverId))
    } catch {
      /* keep the stale list on a refresh failure */
    }
  }

  const waivers = annualWaivers(catalog)
  const now = new Date()

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-brand-900">{t.profile.waivers.title}</h2>
        <p className="text-xs text-brand-950/70 font-medium">
          {t.profile.waivers.intro}
        </p>
      </div>
      {signatures === null ? (
        <p className="text-xs text-brand-950/70 font-medium italic">{t.profile.waivers.loading}</p>
      ) : (
        <ul className="divide-y divide-surface-200">
          {waivers.map(def => (
            <WaiverRow
              key={def.code}
              def={def}
              status={annualWaiverStatus(def, signatures, now)}
              onSign={() => setSigning(def)}
            />
          ))}
        </ul>
      )}

      {signing && (
        <WaiverSignDialog def={signing} onSigned={refresh} onClose={() => setSigning(null)} />
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

function WaiverRow({ def, status, onSign }: {
  def: WaiverDef
  status: AnnualWaiverStatus
  onSign: () => void
}) {
  const ok = status.state === 'signed'
  return (
    <li className="py-2 flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm text-brand-900 font-medium truncate">{def.title}</span>
        <span className={`block text-xs font-medium ${STATUS_CLASS[status.state]}`}>
          {STATUS_LABEL[status.state]}
          {ok && status.validUntil && <span className="text-brand-950/70">{t.profile.waivers.validUntil(fmtDate(status.validUntil))}</span>}
        </span>
      </span>
      <button
        type="button"
        onClick={onSign}
        className="shrink-0 px-3 py-1 rounded-lg bg-brand-900 hover:bg-brand-950 text-white text-xs font-semibold"
      >
        {ok ? t.profile.waivers.resign : t.profile.waivers.sign}
      </button>
    </li>
  )
}
