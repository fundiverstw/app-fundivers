import type { DutyRole, Profile } from '../../types/database'
import { t } from '../../i18n'

const gr = t.admin.groups

export interface StaffDutyRow {
  dutyId: string
  role: DutyRole
  profile: Profile | null
}

/**
 * On-duty staff for one event, surfaced inside the day-of Logistics ride
 * planning. Staff have no stored transport preference, so they're all listed
 * here as people the shop must get to the site — kept visually distinct from
 * the divers' "Needs ride" bucket. Shows name + role (+ contact if known).
 */
export function StaffDutyGroup({ rows }: { rows: StaffDutyRow[] }) {
  if (rows.length === 0) return null
  return (
    <div role="group" aria-label={gr.onDutyStaff} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-brand-900">{gr.onDutyStaff}</h2>
        <span className="text-xs text-brand-900 font-semibold">{rows.length}</span>
      </div>
      <ul className="divide-y divide-surface-200">
        {rows.map(r => (
          <li key={r.dutyId} className="py-1.5 flex items-baseline justify-between gap-3">
            <span className="text-sm text-brand-900 font-medium">
              {r.profile?.name ?? t.admin.transport.noProfile}
              {r.profile?.nickname && r.profile.nickname !== r.profile.name && (
                <span className="text-brand-900 font-medium"> ({r.profile.nickname})</span>
              )}
              <span className="text-xs text-brand-950 font-medium"> · {r.role}</span>
            </span>
            {r.profile?.contact_id && (
              <span className="text-xs text-brand-950 font-medium shrink-0">{r.profile.contact_id}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
