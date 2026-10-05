import { useId, useMemo } from 'react'
import { t } from '../i18n'
import type { CertLevel } from '../types/database'
import { certLevelName } from '../lib/cert-display'

// Agency, then level: the one way a diver names their certification. The value
// is a `cert_levels.code`, never typed text, so whatever reads it knows exactly
// which card the diver holds. Used by the profile page and both register flows.
//
// Controlled on both halves. The agency is held by the parent because it is
// not stored anywhere — it is the level's `organization` once one is picked —
// but it has to survive between the two selects.

export function CertLevelPicker({
  levels, agency, code, onAgencyChange, onCodeChange,
  agencyLabel, levelLabel, labelClassName, selectClassName, legacyText, className,
}: {
  levels: readonly CertLevel[]
  agency: string
  /** A `cert_levels.code`, or '' for none picked. */
  code: string
  /** Also clears the level: a level belongs to one agency. */
  onAgencyChange: (agency: string) => void
  onCodeChange: (code: string) => void
  agencyLabel: string
  levelLabel: string
  labelClassName: string
  selectClassName: string
  /** The profile's free-text certification when no level has been picked —
   *  a legacy value the backfill could not place. Shown so the diver knows
   *  what to replace. */
  legacyText?: string | null
  className?: string
}) {
  const agencyId = useId()
  const levelId = useId()

  // PADI first — most divers in the shop hold PADI cards — then alphabetical.
  const orgs = useMemo(() => {
    const all = Array.from(new Set(levels.map(l => l.organization)))
    return all.sort((a, b) => (a === 'PADI' ? -1 : b === 'PADI' ? 1 : a.localeCompare(b)))
  }, [levels])

  // A legacy agency the ladder doesn't hold ("PSAI") has no option to select;
  // show the placeholder rather than a value the select can't display.
  const selectedAgency = orgs.includes(agency) ? agency : ''

  const agencyLevels = useMemo(
    () => levels.filter(l => l.organization === selectedAgency).sort((a, b) => a.rank - b.rank),
    [levels, selectedAgency],
  )

  const showLegacy = !code && !!legacyText?.trim()

  return (
    <div className={className}>
      <div>
        <label htmlFor={agencyId} className={labelClassName}>{agencyLabel}</label>
        <select
          id={agencyId}
          value={selectedAgency}
          onChange={e => { onAgencyChange(e.target.value); onCodeChange('') }}
          className={selectClassName}
        >
          <option value="">{t.profile.selectAgency}</option>
          {orgs.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={levelId} className={labelClassName}>{levelLabel}</label>
        <select
          id={levelId}
          value={code}
          onChange={e => onCodeChange(e.target.value)}
          className={selectClassName}
          disabled={!selectedAgency}
        >
          <option value="">{selectedAgency ? t.profile.selectLevel : t.profile.pickAgencyFirst}</option>
          {agencyLevels.map(l => <option key={l.code} value={l.code}>{certLevelName(l)}</option>)}
        </select>
      </div>
      {showLegacy && (
        <p className="col-span-full text-xs text-amber-800">{t.profile.certNotOnList(legacyText!.trim())}</p>
      )}
    </div>
  )
}
