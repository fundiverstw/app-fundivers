# Coral surveys

Crowdsourced coral-condition monitoring at `/coral`, moderated by shop staff
before anything is published. Migration `20260822000000_coral_surveys.sql`.

## Why this is not the almanac

The almanac already has a `coral_health` column — one ordinal judgment,
`excellent` to `bleaching`, filed once per site per day per diver. That is the
right shape for a page summarizing a day's conditions, and the wrong shape for
answering whether a reef is bleaching. A single word carries no colony count, no
depth, no water temperature at the moment of the observation, and no reference
standard another observer could reproduce. Two divers who disagree cannot be
told apart from one reef that changed.

A coral survey is the measurement instead, and both surfaces stay: a diver
filing conditions still says how the coral looked, and a diver doing a survey
records colonies.

## The instrument

The [CoralWatch Coral Health Chart](https://coralwatch.org) is a printed card:
four hue columns (B, C, D, E) and six lightness levels. The diver holds it
against a colony and records the palest and the darkest shade they can match.
Level 1 is bleached tissue; level 6 is fully pigmented. Pigmentation tracks
symbiotic algal density, which is what makes a by-eye match against a printed
reference a measurement rather than an opinion.

Adopting the published scale is deliberate. A project-specific scale would make
these records incomparable with a decade of existing volunteer data, and the
comparison is most of the scientific value.

## Shape

A survey is two tables, because a survey is a header plus a set of
observations:

- **`coral_surveys`** — site, date, time of day, depth, water temperature,
  method (`random` / `transect` / `quadrat`), optional transect length, notes,
  and the moderation columns.
- **`coral_survey_colonies`** — one row per colony: growth form, the four chart
  coordinates, and an optional diameter.

Time of day is not decoration. Chart matching is done by eye against ambient
light, so a survey at 08:00 and one at 16:00 on the same colony are not directly
comparable and the analysis has to be able to tell.

### Rules the schema holds

- `darkest_level >= lightest_level`. The chart is read palest first, so the
  reverse is a transposed pair rather than an observation. The form catches it
  first (`colonyProblem` returns `shade_order`) so a diver does not lose a
  survey to a round trip.
- Hue, level, growth form and method are closed vocabularies.
- One survey per `(site_id, surveyed_on, diver_id)` — a second submission for
  the same site-day is a revision.
- Colonies cascade with their survey; the site FK is `ON DELETE RESTRICT`, so a
  site carrying surveys is retired with `active = false`, never deleted.

## Writes are RPC-only

`authenticated` is granted **SELECT** and nothing else on both tables. Every
write goes through a `SECURITY DEFINER` function, so the rules about who may
change what, and when, live in one place:

| Function | Who | What |
| --- | --- | --- |
| `submit_coral_survey` | any signed-in diver | Files a pending survey, or revises the one they already filed for that site and day. Refuses a future date, an empty colony list, more than 100 colonies, and any revision of a survey staff have ruled on. |
| `coral_surveys_in_range` | any signed-in diver | Approved surveys over a date window, colonies aggregated into each row. |
| `coral_pending_surveys` | staff / admin | The review queue. Raises `42501` otherwise. |
| `moderate_coral_survey` | staff / admin | Approve or reject, with an optional note back to the diver. |

Colonies arrive as `jsonb` rather than parallel arrays. A colony is six
correlated values, and six same-length array arguments is a shape that goes
wrong silently the first time one of them is short.

**Revision replaces the colony list wholesale.** Merging would leave rows from
an earlier attempt standing in a survey nobody meant to include them in.

## Arithmetic

`src/lib/coral-survey.ts` holds the vocabulary and every derived figure, with no
network access, so the page and any later analysis compute the same numbers:

- `colonyScore` — the midpoint of a colony's palest and darkest level. The
  midpoint rather than the minimum on purpose: a colony pale at one branch tip
  and pigmented elsewhere is not a bleached colony, and scoring it by its worst
  patch would report a reef as bleaching every time the sun moved.
- `isBleached` — judged on the *darkest* shade. If even the most pigmented part
  of the colony is at the pale end, there is nothing left to find.
- `summarizeSurvey` — count, mean score, bleached count and fraction, and a
  per-growth-form breakdown so a survey of nothing but soft coral cannot be read
  as a statement about the whole reef. Returns nulls rather than zeros for an
  empty survey: a mean of 0 would read as total bleaching.

## Surfaces

`/coral` (`src/pages/CoralPage.tsx`) has the same three sections as the almanac,
for the same three roles: the review queue (staff only), the submission form,
and the approved history. The site picker offers active **dive** sites only —
coral is a question about reefs, not about adventure locations.

Number inputs use `step="any"`. A stepped number input fails native constraint
validation on a value the browser judges off-step, and a form that fails
validation never fires its submit handler — silently, with no message.

## Research context

The three crowdsourcing components — the almanac, the site-map editor and this
— are the subject of the PADI Foundation application in
`ignore/padi-foundation-grant.md`, which states what each is for and what the
study measures about the quality of the data each collects.
