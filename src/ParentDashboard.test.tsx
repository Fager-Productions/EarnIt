import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ParentDashboard from './ParentDashboard'

const props: ComponentProps<typeof ParentDashboard> = {
  view: 'overview',
  mandatoryCompletionPct: 0,
  mandatoryDoneTotal: 0,
  mandatoryRequiredTotal: 0,
  pointsAvailableNow: 0,
  netPointsThisPeriod: 0,
  reachedLevelName: 'Ingen nivå',
  projectedExtra: 0,
  projectedTotalAllowance: 100,
  dashboardChildId: 'all',
  profiles: [],
  onDashboardChildChange: () => {},
  payoutChartData: [],
  levelProgressData: [],
  mandatoryProgressData: [],
  bonusContributionData: [],
  penaltyContributionData: [],
  penaltyEnabled: false,
  settlementHistoryData: [],
  historyFilter: 'all',
  onHistoryFilterChange: () => {},
}

describe('payout chart layout', () => {
  it.each([2, 3, 6])('renders a separate box for each of %i children, including zero earnings', (count) => {
    const payoutChartData = Array.from({ length: count }, (_, index) => ({
      id: `child-${index}`,
      name: `Barn ${index + 1}`,
      total: index === 0 ? 100 : 0,
    }))
    const markup = renderToStaticMarkup(<ParentDashboard {...props} payoutChartData={payoutChartData} />)
    expect(markup).toContain('class="payout-chart-grid"')
    expect(markup.match(/class="payout-child-card"/g)).toHaveLength(count)
    for (const child of payoutChartData) {
      expect(markup).toContain(`<h3>${child.name}</h3>`)
    }
  })

  it('keeps the single-child chart without a grid of boxes', () => {
    const markup = renderToStaticMarkup(
      <ParentDashboard {...props} payoutChartData={[{ id: 'child', name: 'Barn', total: 100 }]} />,
    )
    expect(markup).not.toContain('payout-child-card')
  })

  it('keeps the selected-child category chart without separate boxes', () => {
    const markup = renderToStaticMarkup(
      <ParentDashboard
        {...props}
        dashboardChildId="child"
        payoutChartData={[{ name: 'Fast lønn', amount: 100 }, { name: 'Bonus', amount: 20 }]}
      />,
    )
    expect(markup).not.toContain('payout-child-card')
  })

  it('shows the empty state when no child has earnings', () => {
    const markup = renderToStaticMarkup(
      <ParentDashboard {...props} payoutChartData={[{ name: 'Barn 1', total: 0 }, { name: 'Barn 2', total: 0 }]} />,
    )
    expect(markup).toContain('Ingen opptjening registrert i perioden ennå.')
    expect(markup).not.toContain('payout-child-card')
  })
})
