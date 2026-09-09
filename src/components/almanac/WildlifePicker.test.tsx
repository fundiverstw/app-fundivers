import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WildlifePicker } from './WildlifePicker'
import { t } from '../../i18n'
import type { Taxon } from '../../types/database'

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

const catalog = [
  taxon(),
  taxon({
    id: 'taxon-manta',
    scientific_name: 'Mobula alfredi',
    taxon_names: [{
      id: 'name-2', created_at: '2026-01-01T00:00:00Z', taxon_id: 'taxon-manta',
      lang: 'en', name: 'reef manta ray', is_primary: true,
    }],
  }),
]

function setup(props: Partial<Parameters<typeof WildlifePicker>[0]> = {}) {
  const onChange = vi.fn()
  const onPropose = vi.fn(async () => 'taxon-new')
  render(
    <WildlifePicker
      taxa={catalog}
      selected={[]}
      onChange={onChange}
      onPropose={onPropose}
      {...props}
    />,
  )
  return { onChange, onPropose, user: userEvent.setup() }
}

describe('picking wildlife', () => {
  it('offers nothing until something is typed, rather than the whole catalog', () => {
    setup()
    expect(screen.queryByRole('button', { name: /green sea turtle/ })).not.toBeInTheDocument()
  })

  it('files the taxon id, not the label the diver read', async () => {
    const { onChange, user } = setup()
    await user.type(screen.getByPlaceholderText(t.wildlife.searchPh), 'manta')
    await user.click(await screen.findByRole('button', { name: /reef manta ray/ }))
    expect(onChange).toHaveBeenCalledWith(['taxon-manta'])
  })

  it('leaves an already-chosen animal out of the results', async () => {
    const { user } = setup({ selected: ['taxon-turtle'] })
    await user.type(screen.getByPlaceholderText(t.wildlife.searchPh), 'turtle')
    expect(screen.getByText(t.wildlife.noMatches)).toBeInTheDocument()
  })

  it('takes one back off the list', async () => {
    const { onChange, user } = setup({ selected: ['taxon-turtle', 'taxon-manta'] })
    await user.click(screen.getByRole('button', { name: t.wildlife.remove('green sea turtle') }))
    expect(onChange).toHaveBeenCalledWith(['taxon-manta'])
  })

  // Read-only on purpose: the label came from before the catalog existed, and
  // deciding which animal it meant is staff's call, not the diver's.
  it('shows a pre-catalog label as something it cannot edit', () => {
    setup({ unmatched: ['clownfish'] })
    expect(screen.getByText('clownfish')).toBeInTheDocument()
    expect(screen.getByText(t.wildlife.unmatchedBadge)).toBeInTheDocument()
  })

  it('marks a proposal of the diver\'s own as waiting on staff', () => {
    setup({
      taxa: [...catalog, taxon({ id: 'taxon-mine', scientific_name: 'Pterois volitans', status: 'pending', taxon_names: [] })],
      selected: ['taxon-mine'],
    })
    expect(screen.getByText(t.wildlife.pendingBadge)).toBeInTheDocument()
  })
})

describe('proposing an animal the catalog does not have', () => {
  it('sends the rank and the scientific name, and selects what comes back', async () => {
    const { onChange, onPropose, user } = setup()
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.open }))
    await user.type(screen.getByLabelText(t.wildlife.propose.scientific), 'Pterois volitans')
    await user.type(screen.getByLabelText(t.wildlife.propose.otherName(1)), 'lionfish')
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.submit }))

    expect(onPropose).toHaveBeenCalledWith({
      rank: 'species',
      scientific_name: 'Pterois volitans',
      common_names: ['lionfish'],
    })
    expect(onChange).toHaveBeenCalledWith(['taxon-new'])
  })

  // A common name in the scientific-name box is the exact input the catalog
  // exists to stop being stored, so it never reaches the database.
  it('refuses a common name before the round trip', async () => {
    const { onPropose, user } = setup()
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.open }))
    await user.type(screen.getByLabelText(t.wildlife.propose.scientific), 'lionfish')
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.submit }))

    expect(screen.getByText(t.wildlife.propose.binomial)).toBeInTheDocument()
    expect(onPropose).not.toHaveBeenCalled()
  })

  // A fish is a lionfish and a turkeyfish and a firefish. The name a one-box
  // form made the diver drop is the one the next diver would have searched for.
  it('takes every name the diver knows it by', async () => {
    const { onPropose, user } = setup()
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.open }))
    await user.type(screen.getByLabelText(t.wildlife.propose.scientific), 'Pterois volitans')
    await user.type(screen.getByLabelText(t.wildlife.propose.otherName(1)), 'lionfish')
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.addName }))
    await user.type(screen.getByLabelText(t.wildlife.propose.otherName(2)), 'turkeyfish')
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.submit }))

    expect(onPropose).toHaveBeenCalledWith(expect.objectContaining({
      common_names: ['lionfish', 'turkeyfish'],
    }))
  })

  it('drops the blanks and the repeats rather than sending them', async () => {
    const { onPropose, user } = setup()
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.open }))
    await user.type(screen.getByLabelText(t.wildlife.propose.scientific), 'Pterois volitans')
    await user.type(screen.getByLabelText(t.wildlife.propose.otherName(1)), 'lionfish')
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.addName }))
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.addName }))
    await user.type(screen.getByLabelText(t.wildlife.propose.otherName(3)), ' lionfish ')
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.submit }))

    expect(onPropose).toHaveBeenCalledWith(expect.objectContaining({
      common_names: ['lionfish'],
    }))
  })

  it('takes a name row back off again', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.open }))
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.addName }))
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.removeName(2) }))

    expect(screen.queryByLabelText(t.wildlife.propose.otherName(2))).not.toBeInTheDocument()
  })

  it('carries what was searched for into the form, so it is not typed twice', async () => {
    const { user } = setup()
    await user.type(screen.getByPlaceholderText(t.wildlife.searchPh), 'Pterois volitans')
    await user.click(screen.getByRole('button', { name: t.wildlife.propose.open }))
    expect((screen.getByLabelText(t.wildlife.propose.scientific) as HTMLInputElement).value)
      .toBe('Pterois volitans')
  })
})
