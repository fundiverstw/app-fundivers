import { t } from '../i18n'
import type { Profile } from '../types/database'

// What "a complete diver profile" means, in one place.
//
// Nothing here is enforced. Signing up costs an email and a password, and the
// diver-facing ProfileForm (src/pages/ProfilePage.tsx) saves whatever it is
// given — so this list is what the shop still *wants*, reported to staff on
// the admin screens and shown to the diver on /pending as a nudge. A gap is a
// prompt, never a block.
//
// The DB has its own version of this: the maybe_set_application_submitted_at
// trigger stamps profiles.application_submitted_at once name, date_of_birth,
// cert_level, contact_method and contact_id are all filled. That stamp is a
// one-way latch and it can't see the `uncertified` flag — a Discover diver who
// legitimately has no cert_level never earns it — so it's a poor thing to drive
// UI from. The admin screens ask this module instead. Fields nobody chases —
// nickname, ID number, emergency contact, sizing, medical notes — are absent by
// design: a blank one is not a gap, and flagging it would make the indicator
// noise.

export type ProfileGap =
  | 'name'
  | 'date_of_birth'
  | 'nationality'
  | 'gender'
  | 'contact_method'
  | 'contact_id'
  | 'certification'

function filled(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/** Required fields this profile still has nothing in, in form order. */
export function profileGaps(p: Partial<Profile>): ProfileGap[] {
  const gaps: ProfileGap[] = []
  if (!filled(p.name)) gaps.push('name')
  if (!p.date_of_birth) gaps.push('date_of_birth')
  if (!filled(p.nationality)) gaps.push('nationality')
  if (!filled(p.gender)) gaps.push('gender')
  if (!p.contact_method) gaps.push('contact_method')
  if (!filled(p.contact_id)) gaps.push('contact_id')
  // "I'm not certified yet" is a complete answer to the certification
  // question, so it closes this gap without a level.
  if (!p.uncertified && !filled(p.cert_level)) gaps.push('certification')
  return gaps
}

export function isProfileComplete(p: Partial<Profile>): boolean {
  return profileGaps(p).length === 0
}

// Declared as a full Record so a new gap can't be added without giving it a
// label — an unlabelled one would render as `undefined` in the admin's list.
export const PROFILE_GAP_LABELS: Record<ProfileGap, string> = {
  name:           t.profile.nameLabel,
  date_of_birth:  t.profile.dobLabel,
  nationality:    t.profile.nationalityLabel,
  gender:         t.profile.genderLabel,
  contact_method: t.profile.preferredContact,
  contact_id:     t.profile.handleLabel,
  certification:  t.profile.certification,
}

/** The gaps as admin-readable field names, e.g. ['Date of birth', 'Gender']. */
export function profileGapLabels(p: Partial<Profile>): string[] {
  return profileGaps(p).map(g => PROFILE_GAP_LABELS[g])
}
