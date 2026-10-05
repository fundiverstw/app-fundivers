// The "you can't book this — you don't meet its prerequisites" panel, shared by
// the single-event and cart registration forms so both name the same things.

import { Fragment } from 'react'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'
import { anyShortfall, parseReqDives, shortfallForStep, type EligibilityEvent, type PrereqShortfall, type PrereqStep } from '../../lib/prereq-shortfall'
import type { CertLevel } from '../../types/database'
import { certLevelName } from '../../lib/cert-display'

/** The lines naming what a diver falls short of, without the surrounding box. */
function PrereqShortfallLines({
  short, prereqs, levels, certLevelCode, loggedDives, legacyText = null,
}: {
  short: PrereqShortfall
  /** The event's prerequisite columns the shortfall was computed against. */
  prereqs: EligibilityEvent | null | undefined
  levels: readonly CertLevel[]
  /** The level the diver holds, for naming it back to them. */
  certLevelCode: string | null
  loggedDives: number
  /** Saved free text the backfill couldn't place, when no level is picked:
   *  the diver has said something, it just isn't on the list. */
  legacyText?: string | null
}) {
  const required = levels.find(l => l.id === prereqs?.prereq_cert_id)
  const requiredName = (required && certLevelName(required))
    ?? t.register.prereq.higherCertFallback
  const held = levels.find(l => l.code === certLevelCode)
  return (
    <>
      {short.cert && (
        <li>
          {short.cert === 'uncertified'
            ? t.register.prereq.certMismatch(requiredName)
            : short.cert === 'unstated' || !held
              ? (legacyText
                ? t.register.prereq.certLegacy(requiredName, legacyText)
                : t.register.prereq.certUnknown(requiredName))
              : short.cert === 'unranked'
                ? t.register.prereq.certUnranked(requiredName, `${held.organization} ${certLevelName(held)}`)
                : t.register.prereq.certBelow(requiredName, `${held.organization} ${certLevelName(held)}`)}
        </li>
      )}
      {short.nitrox && <li>{t.register.prereq.nitroxMismatch}</li>}
      {short.dives && (
        <li>{t.register.prereq.divesMismatch(parseReqDives(prereqs?.req_dives) ?? 0, loggedDives)}</li>
      )}
    </>
  )
}

/** The red box: a title, the lines, and what to do about it. Nothing to tick. */
function PrereqBlock({ children, step = 2 }: {
  /** One or more <li> — `PrereqShortfallLines`, or a row-per-event list. */
  children: React.ReactNode
  /** Which form step the box sits on. The diver's own details are edited on
   *  step 2, so only there are they "above"; elsewhere the box says go back. */
  step?: PrereqStep
}) {
  return (
    <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-red-700">{t.register.prereq.title}</p>
      <ul className="text-xs text-red-700 font-medium list-disc pl-4 space-y-1">
        {children}
      </ul>
      <p className="text-xs text-red-700 font-medium border-t border-red-200 pt-2">
        {step === 2
          ? t.register.prereq.blocked(siteConfig.identity.shortName)
          : step === 3
            ? t.register.prereq.blockedNitrox(siteConfig.identity.shortName)
            : t.register.prereq.blockedGoBack(t.register.aboutYou, siteConfig.identity.shortName)}
      </p>
    </div>
  )
}

/** One diver's (or one cart row's) shortfall, as the red box lists it. */
export interface PrereqRow {
  key: string
  /** Heads the row's lines; null for the diver filling the form, whose lines
   *  are listed bare. */
  label: string | null
  short: PrereqShortfall
  /** The event's prerequisite columns the shortfall was graded against. */
  prereqs: EligibilityEvent | null | undefined
  certLevelCode: string | null
  loggedDives: number
  /** Saved free text the backfill couldn't place, when no level is picked. */
  legacyText: string | null
}

/**
 * The red box for one form step, over every row it grades: certification and
 * logged dives on step 2, nitrox on step 3 (where the course can be added),
 * everything on the final step. Rows with nothing to say for the step are
 * left out. Shared by the single-event form (one row per diver) and the cart
 * (one row per event, labelled with the child it books when it does).
 */
export function PrereqRows({ step, rows, levels }: {
  step: PrereqStep
  rows: readonly PrereqRow[]
  levels: readonly CertLevel[]
}) {
  const listed = rows
    .map(r => ({ ...r, short: shortfallForStep(r.short, step) }))
    .filter(r => anyShortfall(r.short))
  const lines = (r: PrereqRow) => (
    <PrereqShortfallLines
      short={r.short} prereqs={r.prereqs} levels={levels}
      certLevelCode={r.certLevelCode} loggedDives={r.loggedDives} legacyText={r.legacyText}
    />
  )
  return (
    <PrereqBlock step={step}>
      {listed.map(r => r.label === null
        ? <Fragment key={r.key}>{lines(r)}</Fragment>
        : (
          <li key={r.key}>
            <span className="font-semibold">{r.label}</span>
            <ul className="list-disc pl-4 mt-0.5 space-y-0.5">{lines(r)}</ul>
          </li>
        ))}
    </PrereqBlock>
  )
}
