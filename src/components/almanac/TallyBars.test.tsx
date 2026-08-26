import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TallyBars } from './TallyBars'
import { tallyByCount, tallyOrdered } from '../../lib/almanac-stats'
import { t } from '../../i18n'
import { ALMANAC_CURRENT_STRENGTHS } from '../../types/database'

describe('TallyBars', () => {
  it('keeps an ordered scale whole, including the levels nobody reported', () => {
    render(
      <TallyBars
        label={t.almanac.current}
        entries={tallyOrdered(['light', 'light', 'moderate'], ALMANAC_CURRENT_STRENGTHS)}
        labelOf={v => t.almanac.currentStrengths[v]}
        ordered
      />
    )

    for (const level of ALMANAC_CURRENT_STRENGTHS) {
      expect(screen.getByText(t.almanac.currentStrengths[level])).toBeInTheDocument()
    }
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(ALMANAC_CURRENT_STRENGTHS.length - 2)
  })

  it('lists an unordered reading commonest first', () => {
    render(
      <TallyBars
        label={t.almanac.weather}
        entries={tallyByCount(['rain', 'clear', 'clear'])}
        labelOf={v => t.almanac.weathers[v]}
      />
    )

    const labels = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(labels[0]).toContain(t.almanac.weathers.clear)
    expect(labels[1]).toContain(t.almanac.weathers.rain)
  })

  it('renders nothing when the reading went unanswered', () => {
    const { container } = render(
      <TallyBars
        label={t.almanac.weather}
        entries={tallyByCount([null, null])}
        labelOf={v => t.almanac.weathers[v]}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when an ordered scale was never answered, rather than an empty axis', () => {
    const { container } = render(
      <TallyBars
        label={t.almanac.current}
        entries={tallyOrdered([null, null], ALMANAC_CURRENT_STRENGTHS)}
        labelOf={v => t.almanac.currentStrengths[v]}
        ordered
      />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
