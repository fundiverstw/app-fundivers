import { t } from '../i18n'
import { DIVE_TYPES, GAS_MIXES, type DiveType, type GasMix } from '../types/database'

// Diver-facing labels for the two dive-log enums. Both used to render their
// raw column values straight into <option>, so a shop running the app in
// Japanese still asked its divers to choose between "shore" and "wreck".
//
// Full Records, so adding a value to DIVE_TYPES or GAS_MIXES fails the build
// until it has a label in every catalog rather than rendering as undefined.
export const DIVE_TYPE_LABELS: Record<DiveType, string> = {
  shore:    t.diveLogs.diveTypes.shore,
  boat:     t.diveLogs.diveTypes.boat,
  training: t.diveLogs.diveTypes.training,
  drift:    t.diveLogs.diveTypes.drift,
  night:    t.diveLogs.diveTypes.night,
  wreck:    t.diveLogs.diveTypes.wreck,
  other:    t.diveLogs.diveTypes.other,
}

// Gas names are read off the tank band the same way worldwide, so only the
// catch-all is translated.
export const GAS_MIX_LABELS: Record<GasMix, string> = {
  air:   t.diveLogs.gasMixes.air,
  EAN32: 'EAN32',
  EAN36: 'EAN36',
  other: t.diveLogs.gasMixes.other,
}

export const DIVE_TYPE_OPTIONS = DIVE_TYPES.map(v => ({ value: v, label: DIVE_TYPE_LABELS[v] }))
export const GAS_MIX_OPTIONS = GAS_MIXES.map(v => ({ value: v, label: GAS_MIX_LABELS[v] }))
