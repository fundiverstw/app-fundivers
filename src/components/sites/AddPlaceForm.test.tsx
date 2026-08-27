import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddPlaceForm } from './AddPlaceForm'
import { t } from '../../i18n'

const { findSimilar, create } = vi.hoisted(() => ({
  findSimilar: vi.fn(),
  create: vi.fn(),
}))

vi.mock('../../lib/dive-sites', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/dive-sites')>()),
  findSimilarDiveSites: (...a: unknown[]) => findSimilar(...a),
  createDiveSite: (...a: unknown[]) => create(...a),
}))

const batCave = {
  id: 'site-bat', name: 'Bat Cave', name_zh_tw: '蝙蝠洞', name_ja: 'バット・ケーブ',
  kind: 'dive' as const, region: 'Keelung', verified: true, active: true,
  matched_name: 'Bat Cave', score: 1,
}

beforeEach(() => {
  findSimilar.mockReset().mockResolvedValue([])
  create.mockReset().mockResolvedValue('new-site-id')
})

function renderForm(over: Partial<Parameters<typeof AddPlaceForm>[0]> = {}) {
  const props = {
    kind: 'dive' as const,
    onAdded: vi.fn(),
    onCancel: vi.fn(),
    onPick: vi.fn(),
    ...over,
  }
  render(<AddPlaceForm {...props} />)
  return props
}

const s = t.sites

describe('AddPlaceForm', () => {
  it('adds a place with the names in every language the diver knows', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.type(screen.getByLabelText(s.nameEn), 'Sharks Point')
    await user.type(screen.getByLabelText(s.nameZh), '鯊魚點')
    await user.type(screen.getByLabelText(s.region), 'Yilan')
    await user.click(screen.getByRole('button', { name: s.addPlace }))

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Sharks Point', name_zh_tw: '鯊魚點', name_ja: '', region: 'Yilan', kind: 'dive',
    })))
    await waitFor(() => expect(props.onAdded).toHaveBeenCalledWith('new-site-id'))
  })

  it('offers what the catalog already has, with the names that make it recognisable', async () => {
    findSimilar.mockResolvedValue([batCave])
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(s.nameEn), 'Batcave')

    expect(await screen.findByText(s.maybeExists)).toBeInTheDocument()
    expect(screen.getByText('Bat Cave')).toBeInTheDocument()
    // Its other names and area are what let a diver judge the suggestion.
    expect(screen.getByText(/蝙蝠洞/)).toBeInTheDocument()
    expect(screen.getByText(/Keelung/)).toBeInTheDocument()
  })

  it('takes the existing place instead of adding a second one', async () => {
    findSimilar.mockResolvedValue([batCave])
    const user = userEvent.setup()
    const props = renderForm()

    await user.type(screen.getByLabelText(s.nameEn), 'Batcave')
    await user.click(await screen.findByRole('button', { name: s.useThis }))

    expect(props.onPick).toHaveBeenCalledWith('site-bat')
    expect(create).not.toHaveBeenCalled()
  })

  // A warning, not a wall: two genuinely different sites can have similar
  // names. The button changes its wording so the diver knows what they are
  // overriding.
  it('still lets them add it, saying plainly that is what they are doing', async () => {
    findSimilar.mockResolvedValue([batCave])
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(s.nameEn), 'Batcave')
    await screen.findByText(s.maybeExists)
    expect(screen.queryByRole('button', { name: s.addPlace })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: s.addAnyway }))
    await waitFor(() => expect(create).toHaveBeenCalled())
  })

  it('searches on the Chinese name too, so it finds the English row', async () => {
    findSimilar.mockResolvedValue([batCave])
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(s.nameZh), '蝙蝠洞')

    await waitFor(() => expect(findSimilar).toHaveBeenCalledWith('蝙蝠洞', 'dive'))
    expect(await screen.findByText(s.maybeExists)).toBeInTheDocument()
  })

  it('drops the suggestions when the name is cleared', async () => {
    findSimilar.mockResolvedValue([batCave])
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(s.nameEn), 'Batcave')
    await screen.findByText(s.maybeExists)

    await user.clear(screen.getByLabelText(s.nameEn))
    await waitFor(() => expect(screen.queryByText(s.maybeExists)).not.toBeInTheDocument())
  })

  it('refuses a nameless place and half a coordinate, without calling the RPC', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: s.addPlace }))
    expect(await screen.findByText(s.nameRequired)).toBeInTheDocument()

    await user.type(screen.getByLabelText(s.nameEn), 'Half Located')
    await user.type(screen.getByLabelText(s.latitude), '25.1')
    await user.click(screen.getByRole('button', { name: s.addPlace }))
    expect(await screen.findByText(s.coordsBoth)).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  // The diver came here to file an observation. A search backend having a bad
  // day must not take the form down with it.
  it('still lets them add a place when the search itself fails', async () => {
    findSimilar.mockRejectedValue(new Error('search is down'))
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(s.nameEn), 'Sharks Point')
    await user.click(screen.getByRole('button', { name: s.addPlace }))

    await waitFor(() => expect(create).toHaveBeenCalled())
  })

  it('surfaces a refusal from the database rather than swallowing it', async () => {
    create.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(s.nameEn), 'Bat Cave')
    await user.click(screen.getByRole('button', { name: s.addPlace }))

    expect(await screen.findByText(/duplicate key/)).toBeInTheDocument()
  })
})
