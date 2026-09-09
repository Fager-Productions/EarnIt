import { describe, expect, it } from 'vitest'
import { computePeriodOutcome, settlePastPeriods } from './settlement'
import type { BonusTask, ChildProfile, Entry, MandatoryTask, PenaltyTask, RewardLevel } from '../types'

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

  it('pays base allowance and reached-level bonus when mandatory tasks are met', () => {
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
    expect(outcome.extraPaid).toBe(25)
    expect(outcome.totalPaid).toBe(125)
    expect(outcome.carryOut).toBe(0)
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
