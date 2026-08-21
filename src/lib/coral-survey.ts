// The CoralWatch Coral Health Chart, and the arithmetic a survey of it yields.
//
// The chart is a printed card a diver carries: four hue columns and six
// lightness levels. The diver holds it against a colony and records the palest
// and the darkest shade they can match. Level 1 is bleached tissue; level 6 is
// fully pigmented. Pigmentation tracks symbiotic algal density, which is what
// makes an eyeball judgment against a printed reference a measurement rather
// than an opinion — and why this module adopts the published scale instead of
// inventing one. Records taken this way are comparable with every other
// CoralWatch dataset.
//
// Nothing here touches the network. The page renders it and the analysis reads
// it; both want the same numbers, so they live in one tested place.

/** Hue columns on the chart, in printed order. */
export const CORAL_HUES = ['B', 'C', 'D', 'E'] as const
export type CoralHue = typeof CORAL_HUES[number]

/** Lightness rows, palest first. 1 is bleached, 6 is fully pigmented. */
export const CORAL_LEVELS = [1, 2, 3, 4, 5, 6] as const
export type CoralLevel = typeof CORAL_LEVELS[number]

/** Growth forms the chart distinguishes, because they bleach at different rates. */
export const CORAL_TYPES = ['branching', 'boulder', 'plate', 'soft'] as const
export type CoralType = typeof CORAL_TYPES[number]

export const CORAL_SURVEY_METHODS = ['random', 'transect', 'quadrat'] as const
export type CoralSurveyMethod = typeof CORAL_SURVEY_METHODS[number]

/** At or below this level a colony is counted as bleached. CoralWatch treats
 *  levels 1 and 2 as the pale end; a colony whose *darkest* shade is still
 *  that pale has no pigmented tissue left to find. */
export const BLEACHED_AT_OR_BELOW: CoralLevel = 2

/** The upper bound the DB enforces on a single survey, mirrored here so the
 *  form can stop a diver before the round trip does. */
export const MAX_COLONIES = 100

/** One colony as the form holds it and the RPC receives it. */
export interface CoralColony {
  coral_type: CoralType
  lightest_hue: CoralHue
  lightest_level: CoralLevel
  darkest_hue: CoralHue
  darkest_level: CoralLevel
  /** Longest horizontal dimension. Optional: a diver without a slate rule
   *  still contributes a usable shade reading. */
  diameter_cm?: number | null
}

/**
 * A colony's own health score: the mean of its palest and darkest matched
 * level.
 *
 * Both ends are recorded because a colony is rarely one shade. Taking the
 * midpoint is CoralWatch's own convention, and it is deliberately not a
 * minimum — a colony that is pale on one branch tip and fully pigmented
 * elsewhere is not a bleached colony, and scoring it by its worst patch would
 * report a reef as bleaching every time the sun moved.
 */
export function colonyScore(colony: CoralColony): number {
  return (colony.lightest_level + colony.darkest_level) / 2
}

/** Is this colony bleached? Judged on its darkest shade: if even the most
 *  pigmented part of the colony is at the pale end, there is nothing left. */
export function isBleached(colony: CoralColony): boolean {
  return colony.darkest_level <= BLEACHED_AT_OR_BELOW
}

export interface SurveySummary {
  /** Colonies recorded. */
  count: number
  /** Mean colony score across the survey, or null when it recorded nothing. */
  meanScore: number | null
  /** Colonies meeting `isBleached`. */
  bleachedCount: number
  /** `bleachedCount / count` as a fraction, or null for an empty survey. */
  bleachedFraction: number | null
  /** Colony counts by growth form, so a survey of nothing but soft coral
   *  cannot be read as a statement about the whole reef. */
  byType: Record<CoralType, number>
}

/**
 * Reduce a survey's colonies to the figures the page shows and the analysis
 * aggregates. Returns nulls rather than zeros for an empty survey: no colonies
 * means no measurement, and a mean of 0 would read as total bleaching.
 */
export function summarizeSurvey(colonies: readonly CoralColony[]): SurveySummary {
  const byType = Object.fromEntries(CORAL_TYPES.map(t => [t, 0])) as Record<CoralType, number>
  for (const colony of colonies) byType[colony.coral_type] += 1

  if (colonies.length === 0) {
    return { count: 0, meanScore: null, bleachedCount: 0, bleachedFraction: null, byType }
  }

  const total = colonies.reduce((sum, colony) => sum + colonyScore(colony), 0)
  const bleachedCount = colonies.filter(isBleached).length
  return {
    count: colonies.length,
    meanScore: total / colonies.length,
    bleachedCount,
    bleachedFraction: bleachedCount / colonies.length,
    byType,
  }
}

/** A colony row the form is still filling in: every field optional and the
 *  levels held as strings, because a `<select>` yields text. */
export interface ColonyDraft {
  coral_type: CoralType | ''
  lightest_hue: CoralHue | ''
  lightest_level: string
  darkest_hue: CoralHue | ''
  darkest_level: string
  diameter_cm: string
}

export function emptyColonyDraft(): ColonyDraft {
  return {
    coral_type: '', lightest_hue: '', lightest_level: '',
    darkest_hue: '', darkest_level: '', diameter_cm: '',
  }
}

export type ColonyProblem =
  | 'incomplete'
  | 'shade_order'
  | 'diameter'

/**
 * What is wrong with this draft row, or null when it is ready to submit.
 *
 * `shade_order` is the one worth naming separately: the chart is read
 * palest-first, and a diver who fills the darker shade into the lighter field
 * has transposed a pair rather than seen an impossible colony. The DB rejects
 * it too (`coral_colony_shade_order`), but a diver should not have to lose a
 * whole survey to a round trip to find that out.
 */
export function colonyProblem(draft: ColonyDraft): ColonyProblem | null {
  const lightest = Number(draft.lightest_level)
  const darkest = Number(draft.darkest_level)
  if (
    !draft.coral_type || !draft.lightest_hue || !draft.darkest_hue ||
    !draft.lightest_level || !draft.darkest_level
  ) return 'incomplete'
  if (darkest < lightest) return 'shade_order'
  if (draft.diameter_cm.trim() !== '') {
    const diameter = Number(draft.diameter_cm)
    if (!Number.isFinite(diameter) || diameter <= 0 || diameter > 2000) return 'diameter'
  }
  return null
}

/** A completed draft as the RPC wants it, or null when the row is not ready. */
export function colonyFromDraft(draft: ColonyDraft): CoralColony | null {
  if (colonyProblem(draft) !== null) return null
  const diameter = draft.diameter_cm.trim() === '' ? null : Number(draft.diameter_cm)
  return {
    coral_type: draft.coral_type as CoralType,
    lightest_hue: draft.lightest_hue as CoralHue,
    lightest_level: Number(draft.lightest_level) as CoralLevel,
    darkest_hue: draft.darkest_hue as CoralHue,
    darkest_level: Number(draft.darkest_level) as CoralLevel,
    diameter_cm: diameter,
  }
}
