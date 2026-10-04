// The "you can't book this — you don't meet its prerequisites" panel, shared by
// the single-event and cart registration forms so both name the same things.

import { siteConfig } from '../../config/site'
import { t } from '../../i18n'
import { parseReqDives, type EligibilityEvent, type PrereqShortfall } from '../../lib/prereq-shortfall'
import { personName } from '../../lib/names'
import type { CertLevel, Profile } from '../../types/database'

/** The lines naming what a diver falls short of, without the surrounding box. */
export function PrereqShortfallLines({
  short, prereqs, levels, certLevelCode, loggedDives,
}: {
  short: PrereqShortfall
  /** The event's prerequisite columns the shortfall was computed against. */
  prereqs: EligibilityEvent | null | undefined
  levels: readonly CertLevel[]
  /** The level the diver holds, for naming it back to them. */
  certLevelCode: string | null
  loggedDives: number
}) {
  const requiredName = levels.find(l => l.id === prereqs?.prereq_cert_id)?.name
    ?? t.register.prereq.higherCertFallback
  const held = levels.find(l => l.code === certLevelCode)
  return (
    <>
      {short.cert && (
        <li>
          {short.cert === 'uncertified'
            ? t.register.prereq.certMismatch(requiredName)
            : short.cert === 'unstated' || !held
              ? t.register.prereq.certUnknown(requiredName)
              : t.register.prereq.certBelow(requiredName, `${held.organization} ${held.name}`)}
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
export function PrereqBlock({ children }: {
  /** One or more <li> — `PrereqShortfallLines`, or a row-per-event list. */
  children: React.ReactNode
}) {
  return (
    <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-red-700">{t.register.prereq.title}</p>
      <ul className="text-xs text-red-700 font-medium list-disc pl-4 space-y-1">
        {children}
      </ul>
      <p className="text-xs text-red-700 font-medium border-t border-red-200 pt-2">
        {t.register.prereq.blocked(siteConfig.identity.shortName)}
      </p>
    </div>
  )
}

/**
 * The single-event form's step-2 panel: certification and logged dives, for
 * the diver filling it in and each other diver booked alongside (graded on
 * their own profile). Nitrox is left to step 3, where the course can be added.
 */
export function PrereqCertAndDives({
  short, others, prereqs, levels, certLevelCode, loggedDives,
}: {
  short: PrereqShortfall
  others: ReadonlyArray<{ target: Profile; short: PrereqShortfall }>
  prereqs: EligibilityEvent | null | undefined
  levels: readonly CertLevel[]
  certLevelCode: string
  loggedDives: number
}) {
  const certAndDives = (s: PrereqShortfall) => ({ ...s, nitrox: false })
  const listed = others.filter(o => o.short.cert !== null || o.short.dives)
  return (
    <PrereqBlock>
      <PrereqShortfallLines
        short={certAndDives(short)} prereqs={prereqs} levels={levels}
        certLevelCode={certLevelCode} loggedDives={loggedDives}
      />
      {listed.map(({ target, short: s }) => (
        <li key={target.id}>
          <span className="font-semibold">{personName(target.name) || t.register.results.diverFallback}</span>
          <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
            <PrereqShortfallLines
              short={certAndDives(s)} prereqs={prereqs} levels={levels}
              certLevelCode={target.cert_level_code} loggedDives={target.logged_dives ?? 0}
            />
          </ul>
        </li>
      ))}
    </PrereqBlock>
  )
}
