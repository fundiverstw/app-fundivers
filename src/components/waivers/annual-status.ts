import type { AnnualWaiverStatus } from '../../lib/waivers'
import { t } from '../../i18n'

// How an annual waiver's state reads, shared by the diver's own My Waivers
// panel and the admin's DiverWaivers panel. Both show the same fact about the
// same row, so they must not drift into describing it differently — the copy is
// role-neutral for exactly that reason.

type State = AnnualWaiverStatus['state']

export const ANNUAL_STATUS_LABEL: Record<State, string> = {
  signed: t.profile.waivers.statusSigned,
  expired: t.profile.waivers.statusExpired,
  outdated: t.profile.waivers.statusOutdated,
  unsigned: t.profile.waivers.statusUnsigned,
}

export const ANNUAL_STATUS_CLASS: Record<State, string> = {
  signed: 'text-emerald-700',
  expired: 'text-red-600',
  outdated: 'text-amber-700',
  unsigned: 'text-red-600',
}
