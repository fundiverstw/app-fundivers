import { t } from '../../i18n'
import { certLevelCodePatch, effectiveCertCode, legacyCertText } from '../../lib/cert-text'
import { personName } from '../../lib/names'
import type { EligibilityEvent, EligibilityProfile, PrereqShortfall } from '../../lib/prereq-shortfall'
import type { CertLevel, Profile } from '../../types/database'
import type { PrereqRow } from './PrereqBlock'

/**
 * The diver filling a register form, as both forms grade them: their step-2
 * answers, with the level code submit will actually leave on the profile —
 * the patch's, or the stored one when the patch leaves an unlisted code off —
 * since that is what the server grades. Also the patch itself, and the legacy
 * text to name back when no level is held.
 */
export function formDiver(
  answers: { uncertified: boolean; loggedDives: number; certLevelCode: string; nitroxCertified: boolean },
  profile: Profile | null | undefined,
  ladder: readonly CertLevel[],
): { certCodePatch: ReturnType<typeof certLevelCodePatch>; diver: EligibilityProfile; legacyText: string | null } {
  // Unchanged from the profile the form opened on: send nothing, so a stale
  // copy of the profile (the signed-in one is cached from sign-in) can never
  // overwrite a level saved since.
  const unchanged = answers.certLevelCode === (profile?.cert_level_code ?? '')
    && answers.uncertified === (profile?.uncertified ?? false)
  const certCodePatch = unchanged ? {} : certLevelCodePatch(answers.certLevelCode, answers.uncertified, ladder)
  const code = effectiveCertCode(certCodePatch, profile?.cert_level_code)
  return {
    certCodePatch,
    diver: {
      uncertified: answers.uncertified, logged_dives: answers.loggedDives,
      cert_level_code: code, nitrox_certified: answers.nitroxCertified,
    },
    legacyText: code ? null : legacyCertText(profile),
  }
}

/**
 * The cart's rows: one per event, labelled with the child it books when it
 * does, graded on that child's profile or on the diver filling the form.
 */
export function prereqRowsForCart(
  rows: ReadonlyArray<{ ev: { id: string; title: string }; short: PrereqShortfall; diver: EligibilityProfile; child: Profile | null }>,
  prereqByEvent: Readonly<Record<string, EligibilityEvent>>,
  selfLegacyText: string | null,
): PrereqRow[] {
  return rows.map(({ ev, short, diver, child }) => ({
    key: ev.id,
    label: child ? `${ev.title} · ${personName(child.name) || t.register.multi.childFallback}` : ev.title,
    short, prereqs: prereqByEvent[ev.id],
    certLevelCode: diver.cert_level_code, loggedDives: diver.logged_dives ?? 0,
    legacyText: child ? legacyCertText(child) : selfLegacyText,
  }))
}

/**
 * The single-event form's rows: the diver filling it in, then, by name, each
 * other diver booked alongside — graded on their own profile, so the parent
 * can see whose shortfall it is.
 */
export function prereqRowsForDivers({ short, others, prereqs, certLevelCode, loggedDives, legacyText, selfLabel = null }: {
  short: PrereqShortfall
  others: ReadonlyArray<{ target: Profile; short: PrereqShortfall }>
  prereqs: EligibilityEvent | null | undefined
  certLevelCode: string | null
  loggedDives: number
  legacyText: string | null
  /** Names the form's own diver when that isn't the person filling it in
   *  (a parent booking only a child, an admin booking someone). */
  selfLabel?: string | null
}): PrereqRow[] {
  return [
    { key: 'self', label: selfLabel, short, prereqs, certLevelCode, loggedDives, legacyText },
    ...others.map(({ target, short: s }) => ({
      key: target.id,
      label: personName(target.name) || t.register.results.diverFallback,
      short: s, prereqs,
      certLevelCode: target.cert_level_code,
      loggedDives: target.logged_dives ?? 0,
      legacyText: legacyCertText(target),
    })),
  ]
}
