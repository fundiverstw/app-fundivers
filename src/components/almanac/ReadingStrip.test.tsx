import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadingStrip, BOX_MIN_N } from './ReadingStrip'
import { summarize } from '../../lib/almanac-stats'
import { t } from '../../i18n'

const celsius = (v: number) => `${v.toFixed(1)}°C`

function renderStrip(values: number[], total = values.length) {
  return render(
    <ReadingStrip
      label={t.almanac.waterTemp}
      summary={summarize(values)!}
      total={total}
      format={celsius}
    />
  )
}

describe('ReadingStrip', () => {
  it('states a lone reading as a number instead of plotting a distribution', () => {
    const { container } = renderStrip([28.5])

    expect(screen.getByText('28.5°C')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
    // No "avg" qualifier either — one reading is the reading, not an average.
    expect(screen.queryByText(t.almanac.avgPrefix)).not.toBeInTheDocument()
  })

  it('keeps quiet about a count the day already states', () => {
    renderStrip([27.5, 28, 28.5])

    expect(screen.queryByText(t.almanac.observationCount(3))).not.toBeInTheDocument()
  })

  it('says how many reported a metric the rest of the day left blank', () => {
    renderStrip([27.5, 28], 6)

    expect(screen.getByText(t.almanac.observationCount(2))).toBeInTheDocument()
  })

  it('plots every value of a small sample as its own dot, with no box', () => {
    const { container } = renderStrip([27.5, 28, 28.5])

    expect(container.querySelectorAll('circle')).toHaveLength(3)
    expect(container.querySelectorAll('rect')).toHaveLength(0)
    expect(screen.getByText(t.almanac.avgPrefix)).toBeInTheDocument()
    expect(screen.getByText('28.0°C')).toBeInTheDocument()
    // The ends of the track are written out, so the axis is not the only reading.
    expect(screen.getByText('27.5°C')).toBeInTheDocument()
    expect(screen.getByText('28.5°C')).toBeInTheDocument()
  })

  it('adds the box and whiskers once the sample can support quartiles', () => {
    const values = Array.from({ length: BOX_MIN_N }, (_, i) => 20 + i)
    const { container } = renderStrip(values)

    expect(container.querySelectorAll('circle')).toHaveLength(BOX_MIN_N)
    expect(container.querySelectorAll('rect')).toHaveLength(1)
  })

  it('keeps an all-identical sample on the track instead of dividing by zero', () => {
    const { container } = renderStrip([26, 26, 26])

    const xs = [...container.querySelectorAll('circle')].map(c => Number(c.getAttribute('cx')))
    expect(xs.every(Number.isFinite)).toBe(true)
    expect(new Set(xs).size).toBe(1)
  })

  it('describes the plot for a reader who cannot see it', () => {
    renderStrip([27.5, 28, 28.5])

    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      t.almanac.plotAria(t.almanac.waterTemp, 3, '27.5°C', '28.5°C'),
    )
  })
})

describe('ReadingStrip — readings that share a value', () => {
  it('fans them across the track so the day does not read as thinner than it was', () => {
    const { container } = renderStrip([28, 28, 28, 30])

    const dots = [...container.querySelectorAll('circle')]
    const at28 = dots.filter(d => d.getAttribute('cx') === dots[0].getAttribute('cx'))
    expect(at28).toHaveLength(3)
    // Same reading, so the same position along the track — the axis still
    // means what it says.
    expect(new Set(at28.map(d => d.getAttribute('cx'))).size).toBe(1)
    // Three distinct heights, so three readings are visibly three.
    expect(new Set(at28.map(d => d.getAttribute('cy'))).size).toBe(3)
  })

  it('leaves a lone reading on the centre line', () => {
    const { container } = renderStrip([27, 28, 29])
    const cys = [...container.querySelectorAll('circle')].map(d => d.getAttribute('cy'))
    expect(new Set(cys).size).toBe(1)
  })

  it('keeps a big stack inside the track instead of spilling out of it', () => {
    const { container } = renderStrip(Array.from({ length: 12 }, () => 26))
    const cys = [...container.querySelectorAll('circle')].map(d => Number(d.getAttribute('cy')))
    expect(Math.min(...cys)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...cys)).toBeLessThanOrEqual(26)
  })

  it('draws the same day the same way every time it is looked at', () => {
    const once = renderStrip([28, 28, 30]).container.innerHTML
    const twice = renderStrip([28, 28, 30]).container.innerHTML
    expect(once).toBe(twice)
  })
})
