import { siteConfig } from '../config/site'
import { t } from '../i18n'
import { printedCert } from './cert-text'
import type { Profile } from '../types/database'

// How a certification reads on screen: the i18n- and site-bound half of the
// rules. The pure half — what counts as legacy text, what a form patches,
// what a printed document shows — is cert-text.ts, which the Deno edge
// functions load too.

type CertFields = Pick<Profile, 'cert_level_code' | 'cert_level'> & {
  cert_agency?: string | null
  uncertified?: boolean | null
}

/**
 * A diver's certification as admin screens print it: the picked level, or the
 * legacy text marked as not on the list, so an unplaced value never passes for
 * a level. Null when there is neither.
 */
export function certSummary(profile: CertFields | null | undefined): string | null {
  const { level, org } = printedCert(profile, t.profile.certNotPlaced)
  return level ? [org, level].filter(Boolean).join(' ') : null
}

/**
 * A level's name in the deployment's language: the Chinese name on a zh-TW
 * site where one is recorded, the agency's own name otherwise.
 */
export function certLevelName(level: { name: string; name_zh: string | null }): string {
  return siteConfig.locale.language === 'zh-TW' && level.name_zh ? level.name_zh : level.name
}
