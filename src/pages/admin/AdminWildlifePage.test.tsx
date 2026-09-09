import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminWildlifePage } from './AdminWildlifePage'
import { t } from '../../i18n'
import type { Taxon, UnmatchedWildlife } from '../../types/database'

const w = t.admin.wildlife

const taxon = (over: Partial<Taxon> = {}): Taxon => ({
  id: 'taxon-turtle',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  rank: 'species',
  scientific_name: 'Chelonia mydas',
  authority: null,
  worms_aphia_id: null,
  parent_id: null,
  accepted_id: null,
  status: 'approved',
  proposed_by: null,
  reviewed_by: null,
  reviewed_at: null,
  staff_notes: null,
  taxon_names: [{
    id: 'name-1', created_at: '2026-01-01T00:00:00Z', taxon_id: 'taxon-turtle',
    lang: 'en', name: 'green sea turtle', is_primary: true,
  }],
  ...over,
})

const catalog: Taxon[] = [
  taxon(),
  taxon({
    id: 'taxon-proposed',
    scientific_name: 'Pterois volitans',
    status: 'pending',
    proposed_by: 'diver-1',
    taxon_names: [],
  }),
]

const unmatched: UnmatchedWildlife[] = [{ label: 'clownfish', sightings: 4, records: 3 }]

const fetchTaxa = vi.fn(async () => catalog)
const fetchUnmatchedWildlife = vi.fn(async () => unmatched)
const moderateTaxon = vi.fn(async () => {})
const mapUnmatchedWildlife = vi.fn(async () => 4)
const saveTaxon = vi.fn(async () => 'taxon-new')
const deleteTaxon = vi.fn(async () => {})

vi.mock('../../lib/wildlife', () => ({
  fetchTaxa: (...a: unknown[]) => fetchTaxa(...(a as [])),
  fetchUnmatchedWildlife: (...a: unknown[]) => fetchUnmatchedWildlife(...(a as [])),
  moderateTaxon: (...a: unknown[]) => moderateTaxon(...(a as [])),
  mapUnmatchedWildlife: (...a: unknown[]) => mapUnmatchedWildlife(...(a as [])),
  saveTaxon: (...a: unknown[]) => saveTaxon(...(a as [])),
  deleteTaxon: (...a: unknown[]) => deleteTaxon(...(a as [])),
  setTaxonName: vi.fn(async () => {}),
  deleteTaxonName: vi.fn(async () => {}),
}))

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../hooks/useToast', () => ({ useToast: () => toast }))

describe('AdminWildlifePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the catalog with the scientific name beside the local one', async () => {
    render(<AdminWildlifePage />)
    expect(await screen.findByText('green sea turtle')).toBeInTheDocument()
    expect(screen.getByText('Chelonia mydas')).toBeInTheDocument()
  })

  it('counts the proposals waiting, so the queue is visible without opening it', async () => {
    render(<AdminWildlifePage />)
    expect(await screen.findByRole('tab', { name: `${w.tabProposals} (1)` })).toBeInTheDocument()
  })

  it('approves a proposal', async () => {
    const user = userEvent.setup()
    render(<AdminWildlifePage />)
    await user.click(await screen.findByRole('tab', { name: `${w.tabProposals} (1)` }))
    await user.click(screen.getByRole('button', { name: w.approve }))

    await waitFor(() => expect(moderateTaxon).toHaveBeenCalledWith('taxon-proposed', 'approved'))
  })

  // The one operation that undoes a duplicate after the fact: the sightings
  // move and the losing name survives as a synonym pointing at the winner.
  it('merges a duplicate into the entry it duplicates', async () => {
    const user = userEvent.setup()
    render(<AdminWildlifePage />)
    await user.click(await screen.findByRole('tab', { name: `${w.tabProposals} (1)` }))
    await user.click(screen.getByRole('button', { name: w.mergeLabel }))
    await user.selectOptions(screen.getByLabelText(w.mergePick), 'taxon-turtle')
    await user.click(screen.getByRole('button', { name: w.mergeConfirm }))

    await waitFor(() => expect(moderateTaxon)
      .toHaveBeenCalledWith('taxon-proposed', 'rejected', 'taxon-turtle'))
  })

  it('maps a loose label onto a taxon, and says how many sightings moved', async () => {
    const user = userEvent.setup()
    render(<AdminWildlifePage />)
    await user.click(await screen.findByRole('tab', { name: `${w.tabUnmatched} (1)` }))
    expect(screen.getByText(w.unmatchedCount(4, 3))).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(w.mapTo), 'taxon-turtle')
    await user.click(screen.getByRole('button', { name: w.mapTo }))

    await waitFor(() => expect(mapUnmatchedWildlife).toHaveBeenCalledWith('clownfish', 'taxon-turtle'))
    expect(toast.success).toHaveBeenCalledWith(w.mapped(4))
  })

  // A pending proposal is not something to file new sightings against, and it
  // is not a merge target either — nothing may be pointed at a name nobody has
  // agreed to yet.
  it('offers only approved entries as a merge target', async () => {
    const user = userEvent.setup()
    render(<AdminWildlifePage />)
    await user.click(await screen.findByRole('tab', { name: `${w.tabProposals} (1)` }))
    await user.click(screen.getByRole('button', { name: w.mergeLabel }))

    const options = [...(screen.getByLabelText(w.mergePick) as HTMLSelectElement).options]
    expect(options.map(o => o.value)).toEqual(['', 'taxon-turtle'])
  })

  it('refuses to send a common name as a scientific one', async () => {
    const user = userEvent.setup()
    render(<AdminWildlifePage />)
    await user.click(await screen.findByRole('button', { name: w.newEntry }))
    await user.type(screen.getByLabelText(w.scientificLabel), 'lionfish')
    await user.click(screen.getByRole('button', { name: t.admin.waivers.save }))

    expect(toast.error).toHaveBeenCalledWith(w.badShape)
    expect(saveTaxon).not.toHaveBeenCalled()
  })
})
