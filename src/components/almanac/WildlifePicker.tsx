/**
 * What a diver saw, chosen from the catalog rather than typed into a box.
 *
 * The box is what this replaces, and the reason is arithmetic: free text made
 * "turtle", "Turtle", "green turtle" and "ウミガメ" four different animals in
 * every tally the almanac takes. Here a sighting is an id, and every language's
 * word for the animal searches to the same id.
 *
 * Search is over every language the catalog carries, not just the app's. A
 * shop running in English still has divers who know the fish as ハタタテダイ,
 * and a picker that only matched the display language would send them back to
 * guessing at a name it would accept.
 *
 * Proposing is the escape hatch, and it asks for a scientific name on purpose.
 * A diver who cannot supply one is not stuck — they file at the level they are
 * sure of, and "some kind of goby" is Gobiidae, which is already in the list.
 */
import { useState } from 'react'
import { t } from '../../i18n'
import { siteConfig } from '../../config/site'
import {
  displayName, labelIsScientific, scientificNameProblem, searchTaxa, selectableTaxa,
  taxonIndex,
} from '../../lib/taxa'
import { TAXON_RANKS, type Taxon, type TaxonRank } from '../../types/database'
import {
  BTN_XS_GHOST, BTN_XS_PRIMARY, ERROR_NOTE_LIGHT, INPUT, INPUT_LABEL, TEXT_BODY,
  TEXT_SUBTLE, TEXT_WARNING,
} from '../../styles/tokens'

const MAX_RESULTS = 8

export interface TaxonProposal {
  rank: TaxonRank
  scientific_name: string
  common_name: string
}

interface Props {
  taxa: Taxon[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Files the proposal and returns the id to select. The page owns this: the
   *  picker knows what a diver asked for, not how the catalog is written to. */
  onPropose: (proposal: TaxonProposal) => Promise<string>
  /** Loose labels this record carried before the catalog existed. Shown so a
   *  diver editing an old entry can see everything it says, and read-only
   *  because the mapping is staff's to make. */
  unmatched?: string[]
}

export function WildlifePicker({
  taxa, selected, onChange, onPropose, unmatched = [],
}: Props) {
  const lang = siteConfig.locale.language
  const [query, setQuery] = useState('')
  const [proposing, setProposing] = useState(false)
  const [rank, setRank] = useState<TaxonRank>('species')
  const [scientific, setScientific] = useState('')
  const [common, setCommon] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const byId = taxonIndex(taxa)
  const catalog = selectableTaxa(taxa)
  const matches = searchTaxa(catalog, query, lang)
    .filter(taxon => !selected.includes(taxon.id))
    .slice(0, MAX_RESULTS)

  const add = (id: string) => {
    if (!selected.includes(id)) onChange([...selected, id])
    setQuery('')
  }

  const openProposal = () => {
    setProposing(true)
    setProblem(null)
    setScientific(query.trim())
  }

  const closeProposal = () => {
    setProposing(false)
    setProblem(null)
    setScientific('')
    setCommon('')
  }

  const submitProposal = async () => {
    const shape = scientificNameProblem(rank, scientific)
    if (shape) {
      setProblem(shape === 'blank'
        ? t.wildlife.propose.blank
        : shape === 'binomial' ? t.wildlife.propose.binomial : t.wildlife.propose.oneWord)
      return
    }
    setSaving(true)
    setProblem(null)
    try {
      const id = await onPropose({
        rank,
        scientific_name: scientific.trim(),
        common_name: common.trim(),
      })
      add(id)
      closeProposal()
    } catch {
      setProblem(t.wildlife.propose.failed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <fieldset className="mt-3">
      <legend className={INPUT_LABEL}>{t.wildlife.label}</legend>

      {(selected.length > 0 || unmatched.length > 0) && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {selected.map(id => {
            const taxon = byId.get(id)
            const label = taxon ? displayName(taxon, lang) : id
            return (
              <li
                key={id}
                className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2 py-1"
              >
                <span className={`text-sm ${TEXT_BODY}`}>{label}</span>
                {taxon && !labelIsScientific(taxon, lang) && (
                  <span className={`text-xs italic ${TEXT_SUBTLE}`}>{taxon.scientific_name}</span>
                )}
                {taxon?.status === 'pending' && (
                  <span className={`text-xs ${TEXT_WARNING}`}>{t.wildlife.pendingBadge}</span>
                )}
                <button
                  type="button"
                  className={BTN_XS_GHOST}
                  aria-label={t.wildlife.remove(label)}
                  onClick={() => onChange(selected.filter(other => other !== id))}
                >
                  ×
                </button>
              </li>
            )
          })}
          {unmatched.map(label => (
            <li
              key={label}
              className="flex items-center gap-2 rounded-lg border border-dashed border-white/15 px-2 py-1"
              title={t.wildlife.unmatchedHint}
            >
              <span className={`text-sm ${TEXT_SUBTLE}`}>{label}</span>
              <span className={`text-xs ${TEXT_SUBTLE}`}>{t.wildlife.unmatchedBadge}</span>
            </li>
          ))}
        </ul>
      )}

      <label className="block">
        <span className="sr-only">{t.wildlife.searchPh}</span>
        <input
          type="search"
          className={INPUT}
          placeholder={t.wildlife.searchPh}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </label>
      <p className={`mt-1 text-xs ${TEXT_SUBTLE}`}>{t.wildlife.hint}</p>

      {query.trim() !== '' && (
        <ul className="mt-2 space-y-1">
          {matches.map(taxon => (
            <li key={taxon.id}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/10"
                onClick={() => add(taxon.id)}
              >
                <span className={`text-sm ${TEXT_BODY}`}>{displayName(taxon, lang)}</span>
                {!labelIsScientific(taxon, lang) && (
                  <span className={`text-xs italic ${TEXT_SUBTLE}`}>{taxon.scientific_name}</span>
                )}
                <span className={`ml-auto text-xs ${TEXT_SUBTLE}`}>{t.wildlife.ranks[taxon.rank]}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className={`px-2 text-xs ${TEXT_SUBTLE}`}>{t.wildlife.noMatches}</li>
          )}
        </ul>
      )}

      {!proposing && (
        <button type="button" className={`${BTN_XS_GHOST} mt-2`} onClick={openProposal}>
          {t.wildlife.propose.open}
        </button>
      )}

      {proposing && (
        <div className="mt-2 rounded-lg border border-white/15 p-3">
          <p className={`text-sm ${TEXT_BODY}`}>{t.wildlife.propose.heading}</p>
          <p className={`mt-1 text-xs ${TEXT_SUBTLE}`}>{t.wildlife.propose.blurb}</p>

          <label className="mt-2 block">
            <span className={INPUT_LABEL}>{t.wildlife.propose.rank}</span>
            <select
              className={INPUT}
              value={rank}
              onChange={e => setRank(e.target.value as TaxonRank)}
            >
              {TAXON_RANKS.map(r => (
                <option key={r} value={r}>{t.wildlife.ranks[r]}</option>
              ))}
            </select>
          </label>

          <label className="mt-2 block">
            <span className={INPUT_LABEL}>{t.wildlife.propose.scientific}</span>
            <input
              type="text"
              className={INPUT}
              placeholder={t.wildlife.propose.scientificPh}
              value={scientific}
              onChange={e => setScientific(e.target.value)}
            />
          </label>

          <label className="mt-2 block">
            <span className={INPUT_LABEL}>{t.wildlife.propose.common}</span>
            <input
              type="text"
              className={INPUT}
              placeholder={t.wildlife.propose.commonPh}
              value={common}
              onChange={e => setCommon(e.target.value)}
            />
          </label>

          {problem && <p className={`mt-2 ${ERROR_NOTE_LIGHT}`}>{problem}</p>}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={BTN_XS_PRIMARY}
              disabled={saving}
              onClick={submitProposal}
            >
              {t.wildlife.propose.submit}
            </button>
            <button type="button" className={BTN_XS_GHOST} onClick={closeProposal}>
              {t.wildlife.propose.cancel}
            </button>
          </div>
        </div>
      )}
    </fieldset>
  )
}
