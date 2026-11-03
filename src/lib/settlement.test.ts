import { describe, expect, it } from 'vitest'
import { computePeriodOutcome, settlePastPeriods } from './settlement'
import type { BonusTask, ChildProfile, Entry, MandatoryTask, PenaltyTask, RewardLevel } from '../types'
import { createDefaultProfile } from './state'
import { bankSummary } from './bank'

const mandatoryTasks: MandatoryTask[] = [{ id: 'm1', name: 'Rydde rom', requiredCount: 2 }]
const bonusTasks: BonusTask[] = [{ id: 'b1', name: 'Vaske bil', points: 5, upForGrabs: false }]
const penaltyTasks: PenaltyTask[] = [{ id: 'p1', name: 'Krangling', points: 3 }]
const rewardLevels: RewardLevel[] = [
  { id: 'l1', name: 'Bronse', minPoints: 5, extraAmount: 10 },
  { id: 'l2', name: 'Sølv', minPoints: 10, extraAmount: 25 },
]

function entry(taskType: Entry['taskType'], taskId: string, timestamp = '2026-01-05T10:00:00.000Z'): Entry {
  return { id: crypto.randomUUID(), taskType, taskId, timestamp }
}

describe('computePeriodOutcome', () => {
  it('adds independent fixed, mandatory and bonus pay using the same outcome', () => {
    const common = {
      periodType: 'week' as const, periodKey: '2026-W02', mandatoryTasks, bonusTasks, penaltyTasks, rewardLevels,
      baseAllowance: 100, fixedAllowance: 50, carryIn: 0, penaltyEnabled: false, bonusRequiresMandatory: false,
    }
    const incomplete = computePeriodOutcome({ ...common, entries: [entry('bonus', 'b1')] })
    expect(incomplete).toMatchObject({ fixedPaid: 50, basePaid: 0, extraPaid: 10, totalPaid: 60 })
    const complete = computePeriodOutcome({ ...common, entries: [entry('bonus', 'b1'), entry('mandatory', 'm1'), entry('mandatory', 'm1')] })
    expect(complete.totalPaid).toBe(160)
    expect(computePeriodOutcome({ ...common, entries: [entry('bonus', 'b1')], bonusRequiresMandatory: true }).totalPaid).toBe(50)
  })

  it('pays fixed salary for empty periods exactly once and never settles the future', () => {
    const profile = { ...createDefaultProfile(), fixedAllowance: 100, allowanceStartAt: '2026-09-07T10:00:00Z' }
    const now = new Date('2026-09-21T12:00:00Z')
    const settled = settlePastPeriods(profile, 'month', false, true, now)
    expect(settled.settlements).toHaveLength(2)
    expect(bankSummary(settled).balance).toBe(200)
    expect(settlePastPeriods(settled, 'month', false, true, now)).toBe(settled)
    const future = { ...profile, allowanceStartAt: '2026-10-01T10:00:00Z', entries: [entry('bonus', 'b1', '2026-10-05T10:00:00Z')] }
    expect(settlePastPeriods(future, 'month', false, true, now).settlements).toHaveLength(0)
  })

  it('respects manually reduced carry points instead of restoring the last settlement carry', () => {
    const profile = { ...createDefaultProfile(), fixedAllowance: 100, carryPoints: 2, allowanceStartAt: '2026-09-07T10:00:00Z' }
    const first = settlePastPeriods(profile, 'month', false, true, new Date('2026-09-14T12:00:00Z'))
    const next = settlePastPeriods({ ...first, carryPoints: 0 }, 'month', false, true, new Date('2026-09-21T12:00:00Z'))
    expect(next.carryPoints).toBe(0)
  })

  it('uses entry snapshots and does not reinterpret a weekly entry as monthly earnings', () => {
    const common = {
      entries: [{ ...entry('bonus', 'b1'), points: 5, periodType: 'week' as const }],
      periodType: 'week' as const, periodKey: '2026-W02', mandatoryTasks: [], bonusTasks: [], penaltyTasks: [], rewardLevels,
      baseAllowance: 100, fixedAllowance: 0, carryIn: 0, penaltyEnabled: false,
    }
    expect(computePeriodOutcome(common)).toMatchObject({ netPoints: 5, basePaid: 0 })
    expect(computePeriodOutcome({ ...common, periodType: 'month', periodKey: '2026-01' }).netPoints).toBe(0)
  })

  it('pays nothing when mandatory tasks are not met', () => {
    const outcome = computePeriodOutcome({
      entries: [entry('mandatory', 'm1')],
      periodType: 'week',
      periodKey: '2026-W02',
      mandatoryTasks,
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      baseAllowance: 100,
      carryIn: 0,
      penaltyEnabled: false,
    })

    expect(outcome.mandatoryMet).toBe(false)
    expect(outcome.basePaid).toBe(0)
    expect(outcome.totalPaid).toBe(0)
  })

  it('pays cumulative reached-level bonuses with the weekly allowance', () => {
    const outcome = computePeriodOutcome({
      entries: [
        entry('mandatory', 'm1'),
        entry('mandatory', 'm1'),
        entry('bonus', 'b1'),
        entry('bonus', 'b1'),
      ],
      periodType: 'week',
      periodKey: '2026-W02',
      mandatoryTasks,
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      baseAllowance: 100,
      carryIn: 0,
      penaltyEnabled: false,
    })

    expect(outcome.mandatoryMet).toBe(true)
    expect(outcome.netPoints).toBe(10)
    expect(outcome.reachedLevelName).toBe('Sølv')
    expect(outcome.basePaid).toBe(100)
    expect(outcome.extraPaid).toBe(35)
    expect(outcome.totalPaid).toBe(135)
    expect(outcome.carryOut).toBe(0)
  })

  it('sums every reached reward level and spends points only through the highest reached threshold', () => {
    const outcome = computePeriodOutcome({
      entries: [entry('bonus', 'b1')],
      periodType: 'week',
      periodKey: '2026-W02',
      mandatoryTasks: [],
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      baseAllowance: 0,
      carryIn: 10,
      penaltyEnabled: false,
      bonusRequiresMandatory: false,
    })
    expect(outcome.extraPaid).toBe(35)
    expect(outcome.pointsSpent).toBe(10)
    expect(outcome.carryOut).toBe(5)
  })

  it('ignores penalty points when penalties are disabled', () => {
    const outcome = computePeriodOutcome({
      entries: [entry('mandatory', 'm1'), entry('mandatory', 'm1'), entry('penalty', 'p1')],
      periodType: 'week',
      periodKey: '2026-W02',
      mandatoryTasks,
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      baseAllowance: 100,
      carryIn: 0,
      penaltyEnabled: false,
    })

    expect(outcome.netPoints).toBe(0)
  })

  it('can pay a reached bonus level without mandatory tasks when enabled', () => {
    const outcome = computePeriodOutcome({
      entries: [entry('bonus', 'b1')],
      periodType: 'week',
      periodKey: '2026-W02',
      mandatoryTasks,
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      baseAllowance: 100,
      carryIn: 0,
      penaltyEnabled: false,
      bonusRequiresMandatory: false,
    })

    expect(outcome.mandatoryMet).toBe(false)
    expect(outcome.extraPaid).toBe(10)
    expect(outcome.pointsSpent).toBe(5)
  })

  it('subtracts penalty points when penalties are enabled', () => {
    const outcome = computePeriodOutcome({
      entries: [entry('mandatory', 'm1'), entry('mandatory', 'm1'), entry('bonus', 'b1'), entry('penalty', 'p1')],
      periodType: 'week',
      periodKey: '2026-W02',
      mandatoryTasks,
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      baseAllowance: 100,
      carryIn: 0,
      penaltyEnabled: true,
    })

    expect(outcome.netPoints).toBe(2)
    expect(outcome.reachedLevelName).toBe('Ingen nivå')
    expect(outcome.extraPaid).toBe(0)
  })

  it('carries points forward across periods', () => {
    const outcome = computePeriodOutcome({
      entries: [entry('mandatory', 'm1'), entry('mandatory', 'm1')],
      periodType: 'week',
      periodKey: '2026-W02',
      mandatoryTasks,
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      baseAllowance: 100,
      carryIn: 8,
      penaltyEnabled: false,
    })

    expect(outcome.pointsAvailable).toBe(8)
    expect(outcome.reachedLevelName).toBe('Bronse')
    expect(outcome.carryOut).toBe(3)
  })

  it('only counts entries belonging to the requested period', () => {
    const outcome = computePeriodOutcome({
      entries: [
        entry('bonus', 'b1', '2026-01-05T10:00:00.000Z'),
        entry('bonus', 'b1', '2026-01-20T10:00:00.000Z'),
      ],
      periodType: 'week',
      periodKey: '2026-W02',
      mandatoryTasks: [],
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      baseAllowance: 50,
      carryIn: 0,
      penaltyEnabled: false,
    })

    expect(outcome.netPoints).toBe(5)
  })

  it('settles the previous week and carries unused points into the next one', () => {
    const profile: ChildProfile = {
      id: 'child-1',
      childName: 'Kaja',
      periodType: 'week',
      baseAllowance: 100,
      childPinHash: null,
      childPinSalt: null,
      childPinIterations: 120000,
      childPinPlain: null,
      mandatoryTasks: [],
      bonusTasks,
      penaltyTasks,
      rewardLevels,
      historyFilter: 'all',
      entries: [entry('bonus', 'b1', '2026-09-07T10:00:00.000Z')],
      settlements: [],
      carryPoints: 8,
      bankDeposits: 0,
    }

    const nextProfile = settlePastPeriods(profile, 'month', false, true, new Date('2026-09-14T00:00:00.000Z'))

    expect(nextProfile.settlements).toHaveLength(1)
    expect(nextProfile.settlements[0].pointsAvailable).toBe(13)
    expect(nextProfile.carryPoints).toBe(3)
    expect(nextProfile.entries).toHaveLength(1)
  })
})
