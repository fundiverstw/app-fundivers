// Authoritative server-side estimate math shared by register-package and
// register-scheduled-trip. Duplicates src/lib/registration-estimate.ts (used by
// the register wizard for its live preview) because the client bundle and the
// Deno runtime can't share a module cleanly; src/lib/registration-estimate.test.ts
// asserts the two produce identical output. Dependency-free so the edge
// functions' vitest suites can import it.

export type ChargeKind = 'base' | 'addon' | 'room'

export interface ChargeLine {
  kind: ChargeKind
  label: string
  amount: number
}

export interface EstimateItem {
  label: string
  price: number
}

export interface RegistrationEstimateInput {
  baseLabel: string
  basePrice: number
  addons: EstimateItem[]
  room: EstimateItem | null
  days: number
  nights: number
}

export function rangeDaysNights(
  start: string | null | undefined,
  end: string | null | undefined,
): { days: number; nights: number } {
  if (!start || !end) return { days: 0, nights: 0 }
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)
  if (!Number.isFinite(ms) || ms < 0) return { days: 0, nights: 0 }
  const nights = Math.round(ms / 86_400_000)
  return { days: nights + 1, nights }
}

export function buildRegistrationCharges(input: RegistrationEstimateInput): ChargeLine[] {
  const { baseLabel, basePrice, addons, room, days, nights } = input
  const dayMult = Math.max(0, days)
  const nightMult = Math.max(0, nights)
  const lines: ChargeLine[] = [{ kind: 'base', label: baseLabel, amount: basePrice }]
  const daySuffix = dayMult > 1 ? ` (x${dayMult} days)` : ''
  for (const a of addons) {
    const amount = (a.price || 0) * dayMult
    if (amount > 0) lines.push({ kind: 'addon', label: `Add-on: ${a.label}${daySuffix}`, amount })
  }
  if (room) {
    const nightSuffix = nightMult > 1 ? ` (x${nightMult} nights)` : ''
    const amount = (room.price || 0) * nightMult
    if (amount > 0) lines.push({ kind: 'room', label: `Room: ${room.label}${nightSuffix}`, amount })
  }
  return lines
}

export function estimateTotal(lines: ChargeLine[]): number {
  return lines.reduce((s, l) => s + l.amount, 0)
}
