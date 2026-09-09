/**
 * The wildlife catalog, curated.
 *
 * One row per animal, keyed by its scientific name; every language's word for
 * it hangs off that row. The page exists because the alternative — divers
 * typing names into a box — made one animal into as many entries as there were
 * spellings and languages, and every tally the almanac takes was counting
 * spellings rather than sightings.
 *
 * Three tabs, three jobs, in the order the work arrives: what divers have
 * proposed and nobody has ruled on, the free text left over from before the
 * catalog, and the catalog itself.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { t } from '../../i18n'
import { siteConfig } from '../../config/site'
import {
  commonName, displayName, lineageOf, ranksBelow, scientificNameProblem, searchTaxa,
  taxonIndex,
} from '../../lib/taxa'
import {
  deleteTaxon, deleteTaxonName, fetchTaxa, fetchUnmatchedWildlife, mapUnmatchedWildlife,
  moderateTaxon, saveTaxon, setTaxonName, type TaxonDraft,
} from '../../lib/wildlife'
import {
  TAXON_RANKS, type Taxon, type TaxonRank, type UnmatchedWildlife,
} from '../../types/database'
import { ConfirmModal, Labelled, Modal } from '../../components/admin/listing-ui'
import { TEXT_WARNING } from '../../styles/tokens'

const w = t.admin.wildlife
const wv = t.admin.waivers

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'
const ROW_BTN = 'text-xs font-semibold px-3 py-1 rounded-lg text-white'

type Tab = 'catalog' | 'proposals' | 'unmatched'

export function AdminWildlifePage() {
  const toast = useToast()
  const lang = siteConfig.locale.language
  const [taxa, setTaxa] = useState<Taxon[]>([])
  const [unmatched, setUnmatched] = useState<UnmatchedWildlife[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('catalog')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Taxon | null>(null)
  const [creating, setCreating] = useState(false)
  const [naming, setNaming] = useState<Taxon | null>(null)
  const [merging, setMerging] = useState<Taxon | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Taxon | null>(null)

  async function reload() {
    const [catalog, loose] = await Promise.all([fetchTaxa(), fetchUnmatchedWildlife()])
    setTaxa(catalog)
    setUnmatched(loose)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [catalog, loose] = await Promise.all([fetchTaxa(), fetchUnmatchedWildlife()])
        if (!cancelled) {
          setTaxa(catalog)
          setUnmatched(loose)
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const byId = taxonIndex(taxa)
  const approved = taxa.filter(taxon => taxon.status === 'approved' && taxon.accepted_id === null)
  const proposals = taxa.filter(taxon => taxon.status === 'pending')
  const shown = query.trim() ? searchTaxa(taxa, query, lang) : taxa

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action()
      toast.success(success)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function handleModerate(taxon: Taxon, status: 'approved' | 'rejected') {
    await run(() => moderateTaxon(taxon.id, status), status === 'approved' ? w.approved : w.rejected)
  }

  async function handleMerge(from: Taxon, keep: Taxon) {
    try {
      await moderateTaxon(from.id, 'rejected', keep.id)
      setMerging(null)
      await reload()
      toast.success(w.merged)
    } catch {
      toast.error(w.mergeFailed)
    }
  }

  async function handleMap(label: string, taxonId: string) {
    try {
      const moved = await mapUnmatchedWildlife(label, taxonId)
      await reload()
      toast.success(w.mapped(moved))
    } catch {
      toast.error(w.mapFailed)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{w.title}</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          {w.newEntry}
        </button>
      </div>
      <p className="text-sm text-white/80">{w.intro}</p>

      <div className="flex gap-2" role="tablist" aria-label={w.title}>
        <TabPill active={tab === 'catalog'} onClick={() => setTab('catalog')}>{w.tabCatalog}</TabPill>
        <TabPill active={tab === 'proposals'} onClick={() => setTab('proposals')}>
          {w.tabProposals}{proposals.length > 0 ? ` (${proposals.length})` : ''}
        </TabPill>
        <TabPill active={tab === 'unmatched'} onClick={() => setTab('unmatched')}>
          {w.tabUnmatched}{unmatched.length > 0 ? ` (${unmatched.length})` : ''}
        </TabPill>
      </div>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">{wv.loading}</p>
      ) : tab === 'catalog' ? (
        <>
          <input
            type="search"
            className={FIELD}
            placeholder={w.searchPh}
            aria-label={w.searchPh}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {taxa.length === 0 ? (
            <p className="text-sm text-white/70">{w.none}</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-white/70">{w.noMatches}</p>
          ) : (
            <ul className="space-y-2">
              {shown.map(taxon => (
                <li key={taxon.id}
                  className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-brand-900 text-sm truncate">
                      {displayName(taxon, lang)}
                      <span className="ml-2 text-xs text-brand-900/70">{t.wildlife.ranks[taxon.rank]}</span>
                      {taxon.status === 'pending' && (
                        <span className={`ml-2 text-xs ${TEXT_WARNING}`}>{t.wildlife.pendingBadge}</span>
                      )}
                      {taxon.accepted_id && (
                        <span className="ml-2 text-xs text-brand-900/70">
                          {w.synonymOf(byId.get(taxon.accepted_id)?.scientific_name ?? '—')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs italic text-brand-900/70 truncate">
                      {lineageOf(taxon, byId).map(step => step.scientific_name).join(' › ')}
                    </p>
                    <p className="text-xs text-brand-900/70 truncate">
                      {(taxon.taxon_names ?? [])
                        .map(name => `${name.lang}: ${name.name}`)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={() => setNaming(taxon)}
                      className={`${ROW_BTN} bg-brand-600 hover:bg-brand-500`}>{w.namesHeading}</button>
                    <button type="button" onClick={() => setMerging(taxon)}
                      className={`${ROW_BTN} bg-brand-600 hover:bg-brand-500`}>{w.mergeLabel}</button>
                    <button type="button" onClick={() => setEditing(taxon)}
                      className={`${ROW_BTN} bg-brand-900 hover:bg-brand-950`}>{wv.edit}</button>
                    <button type="button" onClick={() => setConfirmDelete(taxon)}
                      className={`${ROW_BTN} bg-red-700 hover:bg-red-800`}>{wv.delete}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : tab === 'proposals' ? (
        proposals.length === 0 ? (
          <p className="text-sm text-white/70">{w.proposalsEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {proposals.map(taxon => (
              <li key={taxon.id}
                className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
                <div>
                  <p className="font-medium text-brand-900 text-sm">
                    <span className="italic">{taxon.scientific_name}</span>
                    <span className="ml-2 text-xs text-brand-900/70">{t.wildlife.ranks[taxon.rank]}</span>
                  </p>
                  <p className="text-xs text-brand-900/70">
                    {(taxon.taxon_names ?? []).map(name => `${name.lang}: ${name.name}`).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleModerate(taxon, 'approved')}
                    className={`${ROW_BTN} bg-emerald-700 hover:bg-emerald-800`}>{w.approve}</button>
                  <button type="button" onClick={() => setMerging(taxon)}
                    className={`${ROW_BTN} bg-brand-600 hover:bg-brand-500`}>{w.mergeLabel}</button>
                  <button type="button" onClick={() => handleModerate(taxon, 'rejected')}
                    className={`${ROW_BTN} bg-red-700 hover:bg-red-800`}>{w.reject}</button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : unmatched.length === 0 ? (
        <p className="text-sm text-white/70">{w.unmatchedEmpty}</p>
      ) : (
        <>
          <p className="text-sm text-white/80">{w.unmatchedIntro}</p>
          <ul className="space-y-2">
            {unmatched.map(row => (
              <UnmatchedRow
                key={row.label}
                row={row}
                candidates={approved}
                lang={lang}
                onMap={taxonId => handleMap(row.label, taxonId)}
              />
            ))}
          </ul>
        </>
      )}

      {(creating || editing) && (
        <TaxonForm
          taxon={editing}
          taxa={taxa}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => {
            setCreating(false)
            setEditing(null)
            toast.success(w.saved)
            await reload()
          }}
          onError={message => toast.error(message)}
        />
      )}

      {naming && (
        <NamesModal
          taxon={naming}
          onClose={() => setNaming(null)}
          onChanged={async () => {
            const catalog = await fetchTaxa()
            setTaxa(catalog)
            setNaming(current => current && (catalog.find(x => x.id === current.id) ?? null))
          }}
          onError={message => toast.error(message)}
        />
      )}

      {merging && (
        <MergeModal
          from={merging}
          candidates={approved.filter(candidate => candidate.id !== merging.id)}
          lang={lang}
          onClose={() => setMerging(null)}
          onConfirm={keep => handleMerge(merging, keep)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={w.deleteTitle}
          body={w.deleteBody(confirmDelete.scientific_name)}
          confirmLabel={wv.delete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const target = confirmDelete
            setConfirmDelete(null)
            await run(() => deleteTaxon(target.id), w.deleted)
          }}
        />
      )}
    </div>
  )
}

function TabPill({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
        active ? 'bg-brand-600 text-white' : 'bg-white/70 text-brand-900 hover:bg-white/90'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * One catalog entry.
 *
 * The parent list offers only ranks above this one, because that is the rule
 * the database enforces and a dropdown that let an admin pick a genus for a
 * family would be offering a save that cannot succeed.
 */
function TaxonForm({ taxon, taxa, onClose, onSaved, onError }: {
  taxon: Taxon | null
  taxa: Taxon[]
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const [rank, setRank] = useState<TaxonRank>(taxon?.rank ?? 'species')
  const [scientific, setScientific] = useState(taxon?.scientific_name ?? '')
  const [authority, setAuthority] = useState(taxon?.authority ?? '')
  const [aphia, setAphia] = useState(taxon?.worms_aphia_id?.toString() ?? '')
  const [parentId, setParentId] = useState(taxon?.parent_id ?? '')
  const [submitting, setSubmitting] = useState(false)

  const parents = taxa.filter(candidate =>
    candidate.id !== taxon?.id
    && candidate.accepted_id === null
    && ranksBelow(candidate.rank).includes(rank))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const problem = scientificNameProblem(rank, scientific)
    if (problem) {
      onError(problem === 'blank' ? t.wildlife.propose.blank : w.badShape)
      return
    }
    setSubmitting(true)
    try {
      const draft: TaxonDraft = {
        rank,
        scientific_name: scientific.trim(),
        authority: authority.trim() || null,
        worms_aphia_id: aphia.trim() ? Number(aphia.trim()) : null,
        parent_id: parentId || null,
      }
      await saveTaxon(draft, taxon?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="taxon-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="taxon-form-title" className="text-lg font-bold text-brand-900">
          {taxon ? w.editTitle : w.newTitle}
        </h2>

        <Labelled label={w.rankLabel}>
          <select className={FIELD} value={rank} onChange={e => setRank(e.target.value as TaxonRank)}>
            {TAXON_RANKS.map(value => (
              <option key={value} value={value}>{t.wildlife.ranks[value]}</option>
            ))}
          </select>
        </Labelled>

        <Labelled label={w.scientificLabel}>
          <input className={FIELD} value={scientific} placeholder={w.scientificPh}
            onChange={e => setScientific(e.target.value)} />
        </Labelled>
        <p className="text-xs text-brand-900/70">{w.scientificHint}</p>

        <Labelled label={w.parentLabel}>
          <select className={FIELD} value={parentId} onChange={e => setParentId(e.target.value)}>
            <option value="">{w.parentNone}</option>
            {parents.map(candidate => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.scientific_name} ({t.wildlife.ranks[candidate.rank]})
              </option>
            ))}
          </select>
        </Labelled>
        <p className="text-xs text-brand-900/70">{w.parentHint}</p>

        <Labelled label={w.authorityLabel}>
          <input className={FIELD} value={authority} placeholder={w.authorityPh}
            onChange={e => setAuthority(e.target.value)} />
        </Labelled>

        <Labelled label={w.wormsLabel}>
          <input className={FIELD} inputMode="numeric" value={aphia}
            onChange={e => setAphia(e.target.value)} />
        </Labelled>
        <p className="text-xs text-brand-900/70">{w.wormsHint}</p>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-brand-900 border border-surface-300 hover:bg-surface-50">
            {wv.cancel}
          </button>
          <button type="submit" disabled={submitting}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50">
            {wv.save}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * The names one animal answers to.
 *
 * A language code rather than a fixed list of three: the database accepts any
 * BCP-47 tag, and a shop whose divers speak something this app has no catalog
 * for still has a word for the fish.
 */
function NamesModal({ taxon, onClose, onChanged, onError }: {
  taxon: Taxon
  onClose: () => void
  onChanged: () => Promise<void>
  onError: (message: string) => void
}) {
  const [lang, setLang] = useState(siteConfig.locale.language as string)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await setTaxonName(taxon.id, lang.trim(), name.trim(), !commonName(taxon, lang.trim()))
      setName('')
      await onChanged()
    } catch {
      onError(w.nameTaken)
    } finally {
      setBusy(false)
    }
  }

  async function remove(nameId: string) {
    setBusy(true)
    try {
      await deleteTaxonName(nameId)
      await onChanged()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal labelledBy="taxon-names-title" onClose={onClose}>
      <h2 id="taxon-names-title" className="text-lg font-bold text-brand-900">
        {w.namesHeading} — <span className="italic">{taxon.scientific_name}</span>
      </h2>
      <p className="text-xs text-brand-900/70">{w.namesHint}</p>

      <ul className="space-y-1">
        {(taxon.taxon_names ?? []).map(row => (
          <li key={row.id} className="flex items-center justify-between gap-2 text-sm text-brand-900">
            <span>
              <span className="text-xs text-brand-900/70">{row.lang}</span> {row.name}
              {row.is_primary && <span className="ml-2 text-xs text-brand-900/70">{w.primaryLabel}</span>}
            </span>
            <button type="button" disabled={busy} onClick={() => remove(row.id)}
              className={`${ROW_BTN} bg-red-700 hover:bg-red-800 disabled:opacity-50`}>{wv.delete}</button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex items-end gap-2">
        <div className="w-24">
          <Labelled label={w.langLabel}>
            <input className={FIELD} value={lang} placeholder={w.langPh}
              onChange={e => setLang(e.target.value)} />
          </Labelled>
        </div>
        <div className="flex-1">
          <Labelled label={w.nameLabel}>
            <input className={FIELD} value={name} onChange={e => setName(e.target.value)} />
          </Labelled>
        </div>
        <button type="submit" disabled={busy}
          className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-2 rounded-lg disabled:opacity-50">
          {w.addName}
        </button>
      </form>

      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">
          {w.done}
        </button>
      </div>
    </Modal>
  )
}

/**
 * Folding one entry into another.
 *
 * Which row survives is a decision only a person can make, so it is picked
 * rather than inferred. The loser keeps existing as a synonym: divers and old
 * records still use the name, and a name that resolves to the right animal is
 * worth more than a name that resolves to nothing.
 */
function MergeModal({ from, candidates, lang, onClose, onConfirm }: {
  from: Taxon
  candidates: Taxon[]
  lang: string
  onClose: () => void
  onConfirm: (keep: Taxon) => void
}) {
  const [keepId, setKeepId] = useState('')
  const keep = candidates.find(candidate => candidate.id === keepId) ?? null

  return (
    <Modal labelledBy="taxon-merge-title" onClose={onClose}>
      <h2 id="taxon-merge-title" className="text-lg font-bold text-brand-900">{w.mergeTitle}</h2>
      <p className="text-sm text-brand-900/80">{w.mergeBody(from.scientific_name)}</p>
      <Labelled label={w.mergePick}>
        <select className={FIELD} value={keepId} onChange={e => setKeepId(e.target.value)}>
          <option value="">—</option>
          {candidates.map(candidate => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.scientific_name} · {displayName(candidate, lang)}
            </option>
          ))}
        </select>
      </Labelled>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">
          {wv.cancel}
        </button>
        <button type="button" disabled={!keep} onClick={() => keep && onConfirm(keep)}
          className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg">
          {w.mergeConfirm}
        </button>
      </div>
    </Modal>
  )
}

/** One loose label, with what it is standing on and where it should go. */
function UnmatchedRow({ row, candidates, lang, onMap }: {
  row: UnmatchedWildlife
  candidates: Taxon[]
  lang: string
  onMap: (taxonId: string) => Promise<void>
}) {
  const [taxonId, setTaxonId] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <li className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
      <div>
        <p className="font-medium text-brand-900 text-sm">{row.label}</p>
        <p className="text-xs text-brand-900/70">{w.unmatchedCount(row.sightings, row.records)}</p>
      </div>
      <div className="flex items-end gap-2">
        <select className={FIELD} value={taxonId} onChange={e => setTaxonId(e.target.value)}
          aria-label={w.mapTo}>
          <option value="">—</option>
          {candidates.map(candidate => (
            <option key={candidate.id} value={candidate.id}>
              {displayName(candidate, lang)} · {candidate.scientific_name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!taxonId || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onMap(taxonId)
            } finally {
              setBusy(false)
            }
          }}
          className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-2 rounded-lg disabled:opacity-50"
        >
          {w.mapTo}
        </button>
      </div>
    </li>
  )
}
