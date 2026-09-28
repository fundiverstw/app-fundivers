import { Link } from 'react-router-dom'
import { personName } from '../../lib/names'
import { gearPackList } from '../../lib/gear'
import { shoeAsJp } from '../../lib/shoe-size'
import { AdminNotes } from './AdminNotes'
import { GearSizeEditor } from './GearSizeEditor'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import type { Booking, Profile } from '../../types/database'
import { t } from '../../i18n'

const gc = t.admin.gearCard

export interface DiverGearRow {
  booking: Booking
  profile: Profile | null
}

/**
 * One diver's gear card for the per-event gear map: what to pack (from the
 * booking-time selection), sizing, an inline size editor, and the gear-tagged
 * admin notes. The map plans a trip rather than loading one, so nothing here
 * ticks — the day-of Logistics board has its own checklist card
 * (`GuestPackCard`). Gated by StaffOrAdminRoute.
 */
export function DiverGearCard({ row, onProfilePatched, linkToProfile = false, gearModels }: {
  row: DiverGearRow
  onProfilePatched: (diverId: string, patch: Partial<Profile>) => void
  // When true, the diver's name links to their admin People card. Gated by the
  // caller because that page is admin-only, while this card renders for staff.
  linkToProfile?: boolean
  // The shop's gear sizing charts. When supplied, a rental "which fits?" lookup
  // is shown per gear type the diver doesn't own.
  gearModels?: GearModelWithSizes[]
}) {
  const { profile, booking } = row
  const diverName = personName(profile?.name) || gc.unknown
  const pack = gearPackList(booking)
  const owned = new Set(profile?.gear_owned ?? [])
  const shoeLabel = profile?.shoe_size ? (shoeAsJp(profile.shoe_size) ?? profile.shoe_size) : null
  const sizing = [
    profile?.height_cm && `${profile.height_cm}cm`,
    profile?.weight_kg && `${profile.weight_kg}kg`,
    shoeLabel,
  ].filter(Boolean).join(' · ')

  return (
    <article className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-brand-900">
              {linkToProfile && profile ? (
                <Link to={`/admin/users?diver=${profile.id}`} className="hover:underline">
                  {diverName}
                </Link>
              ) : (
                diverName
              )}
            </h2>
            {/* Waitlisted divers have no confirmed seat yet — flag their card so
                their gear reads as tentative, not part of the boat's pack list. */}
            {booking.status === 'waitlisted' && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-300 font-semibold shrink-0">
                {gc.waitlisted}
              </span>
            )}
          </div>
          {sizing && <p className="text-xs text-brand-900 font-medium">{sizing}</p>}
        </div>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
          pack.items.length > 0 || pack.note ? 'bg-red-100 text-red-700 border border-accent' : 'bg-surface-100 text-brand-950 font-medium'
        }`}>
          {pack.summary}
        </span>
      </header>

      {pack.note && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">
          {pack.note}
        </p>
      )}

      {pack.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pack.items.map(item => (
            <span
              key={item}
              title={owned.has(item) ? gc.ownsItem : gc.needsPacking}
              className={`text-xs px-2 py-0.5 rounded-full border ${
                owned.has(item)
                  ? 'border-brand-900/40 text-brand-950 font-medium line-through'
                  : 'border-brand-900 text-brand-900'
              }`}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {profile && (
        <div className="border-t border-surface-200 pt-2">
          <GearSizeEditor profile={profile} packItems={pack.items} gearModels={gearModels} onProfilePatched={onProfilePatched} />
        </div>
      )}

      <AdminNotes target={{ kind: 'booking', id: booking.id }} tagFilter="gear" title={gc.gearFlags} compact />
    </article>
  )
}
