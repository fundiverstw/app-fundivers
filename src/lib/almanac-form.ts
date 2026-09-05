/**
 * The almanac's observation form, as data.
 *
 * Three things happen to one of these and all three are arithmetic worth
 * pinning: a blank one is built, a record already filed is read back INTO one
 * so the diver can correct it, and one is turned into the arguments the RPC
 * takes. The round trip is the load-bearing part — a field that survives the
 * trip out but not the trip back is a reading a diver silently loses by
 * opening their own entry and saving it again.
 *
 * Every field is a string (or a small enum-or-empty), because that is what an
 * input holds. The empty string means "not answered" and becomes NULL; it is
 * not the same as 0, and `submitArgs` is where that distinction is kept.
 */
import { hasTerrainConditions, SITE_CONDITION_KINDS, type EventKind } from './event-kinds'
import { todayIso } from './dates'
import { numOrNull } from './num'
import type {
  AlmanacCoralHealth, AlmanacCurrentStrength, AlmanacOwnRecord,
  AlmanacRouteCondition, AlmanacTrashBand, AlmanacTrashKind, AlmanacWeather,
} from '../types/database'

export interface AlmanacFormState {
  kind: EventKind
  site_id: string
  obs_date: string
  air_temp_c: string
  water_temp_c: string
  visibility_m: string
  current_strength: AlmanacCurrentStrength | ''
  wave_height_m: string
  wave_period_s: string
  weather: AlmanacWeather | ''
  wildlife: string
  coral_health: AlmanacCoralHealth | ''
  elevation_m: string
  route_condition: AlmanacRouteCondition | ''
  summit_visible: boolean
  trash_band: AlmanacTrashBand | ''
  trash_kinds: AlmanacTrashKind[]
}

export const emptyForm: AlmanacFormState = {
  kind: SITE_CONDITION_KINDS[0],
  site_id: '',
  obs_date: '',
  air_temp_c: '',
  water_temp_c: '',
  visibility_m: '',
  current_strength: '',
  wave_height_m: '',
  wave_period_s: '',
  weather: '',
  wildlife: '',
  coral_health: '',
  elevation_m: '',
  route_condition: '',
  summit_visible: false,
  trash_band: '',
  trash_kinds: [],
}

// The date defaults to today: without an outing to derive it from, "when were
// you there" is nearly always today or a day or two back, and a diver who was
// somewhere else edits one field instead of filling one from blank.
export const blankForm = (): AlmanacFormState => ({ ...emptyForm, obs_date: todayIso() })

export function parseWildlife(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/** A number in an input box: absent, not zero, when nothing was recorded. */
function fieldOf(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * A record the diver already filed, opened back up for correction.
 *
 * `kind` comes from the site rather than the record, because the record does
 * not carry one — the almanac's kind is a property of the place, and the form
 * uses it to decide whether the terrain block is asked for at all.
 */
export function formStateFrom(record: AlmanacOwnRecord, kind: EventKind): AlmanacFormState {
  return {
    kind,
    site_id: record.site_id,
    obs_date: record.obs_date,
    air_temp_c: fieldOf(record.air_temp_c),
    water_temp_c: fieldOf(record.water_temp_c),
    visibility_m: fieldOf(record.visibility_m),
    current_strength: record.current_strength ?? '',
    wave_height_m: fieldOf(record.wave_height_m),
    wave_period_s: fieldOf(record.wave_period_s),
    weather: record.weather ?? '',
    wildlife: (record.wildlife ?? []).join(', '),
    coral_health: record.coral_health ?? '',
    elevation_m: fieldOf(record.elevation_m),
    route_condition: record.route_condition ?? '',
    summit_visible: record.summit_visible ?? false,
    trash_band: record.trash_band ?? '',
    trash_kinds: record.trash_kinds ?? [],
  }
}

export interface AlmanacSubmitArgs {
  p_site_id: string
  p_obs_date: string
  p_air_temp_c: number | null
  p_water_temp_c: number | null
  p_visibility_m: number | null
  p_current_strength: AlmanacCurrentStrength | null
  p_wave_height_m: number | null
  p_wave_period_s: number | null
  p_weather: AlmanacWeather | null
  p_wildlife: string[]
  p_trash_band: AlmanacTrashBand | null
  p_trash_kinds: AlmanacTrashKind[]
  p_coral_health: AlmanacCoralHealth | null
  p_elevation_m: number | null
  p_route_condition: AlmanacRouteCondition | null
  p_summit_visible: boolean | null
}

/**
 * The form as the RPC takes it.
 *
 * Terrain readings are dropped for the kinds that do not answer
 * `hasTerrainConditions` rather than sent and ignored: a summit-visible flag on
 * a boat dive is not a false reading, it is a reading of a question nobody was
 * asked.
 */
export function submitArgs(form: AlmanacFormState): AlmanacSubmitArgs {
  const terrain = hasTerrainConditions(form.kind)
  return {
    p_site_id: form.site_id,
    p_obs_date: form.obs_date,
    p_air_temp_c: numOrNull(form.air_temp_c),
    p_water_temp_c: numOrNull(form.water_temp_c),
    p_visibility_m: numOrNull(form.visibility_m),
    p_current_strength: form.current_strength || null,
    p_wave_height_m: numOrNull(form.wave_height_m),
    p_wave_period_s: numOrNull(form.wave_period_s),
    p_weather: form.weather || null,
    p_wildlife: parseWildlife(form.wildlife),
    p_trash_band: form.trash_band || null,
    p_trash_kinds: form.trash_kinds,
    p_coral_health: form.coral_health || null,
    p_elevation_m: terrain ? numOrNull(form.elevation_m) : null,
    p_route_condition: terrain ? form.route_condition || null : null,
    p_summit_visible: terrain ? form.summit_visible : null,
  }
}
