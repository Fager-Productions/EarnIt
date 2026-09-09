import type {
  BonusTask,
  ChildProfile,
  Entry,
  MandatoryTask,
  PenaltyTask,
  PeriodType,
  RewardLevel,
  Settlement,
} from '../types'
import {
  getInitialInterestAnchor,
  getPeriodKey,
  getPeriodLabel,
  getPeriodStartDate,
} from './period'
import type { InterestPeriod } from './coreLogic'

export type PeriodOutcomeInput = {
  entries: Entry[]
  periodType: PeriodType
  periodKey: string
  mandatoryTasks: MandatoryTask[]
  bonusTasks: BonusTask[]
  penaltyTasks: PenaltyTask[]
  rewardLevels: RewardLevel[]
  baseAllowance: number
  carryIn: number
  penaltyEnabled: boolean
  bonusRequiresMandatory?: boolean
}

export type PeriodOutcome = {
  mandatoryMet: boolean
  netPoints: number
  pointsAvailable: number
  pointsSpent: number
  carryOut: number
  reachedLevelName: string
  basePaid: number
  extraPaid: number
  totalPaid: number
}

// Shared by the auto-settlement effect (past periods) and the live "current period" projection,
// so both always agree on how mandatory/bonus/penalty/levels translate into a payout.
export function computePeriodOutcome(input: PeriodOutcomeInput): PeriodOutcome {
  const periodEntries = input.entries.filter(
    (entry) => getPeriodKey(new Date(entry.timestamp), input.periodType) === input.periodKey,
  )

  const mandatoryCountMap: Record<string, number> = {}
  periodEntries
    .filter((entry) => entry.taskType === 'mandatory')
    .forEach((entry) => {
      mandatoryCountMap[entry.taskId] = (mandatoryCountMap[entry.taskId] ?? 0) + 1
    })

  const mandatoryMet = input.mandatoryTasks.every(
    (task) => (mandatoryCountMap[task.id] ?? 0) >= task.requiredCount,
  )

  const bonusPoints = periodEntries
    .filter((entry) => entry.taskType === 'bonus')
    .reduce((sum, entry) => {
      const task = input.bonusTasks.find((item) => item.id === entry.taskId)
      return sum + (task?.points ?? 0)
    }, 0)

  const penaltyPoints = input.penaltyEnabled
    ? periodEntries
        .filter((entry) => entry.taskType === 'penalty')
        .reduce((sum, entry) => {
          const task = input.penaltyTasks.find((item) => item.id === entry.taskId)
          return sum + (task?.points ?? 0)
        }, 0)
    : 0

  const netPoints = bonusPoints - penaltyPoints
  const pointsAvailable = Math.max(0, input.carryIn + netPoints)

  const sortedLevels = [...input.rewardLevels].sort((a, b) => a.minPoints - b.minPoints)
  const reachedLevel = sortedLevels.filter((level) => level.minPoints <= pointsAvailable).at(-1) ?? null

  const bonusCanApply = !input.bonusRequiresMandatory || mandatoryMet
  const extraPaid = bonusCanApply ? (reachedLevel?.extraAmount ?? 0) : 0
  const pointsSpent = bonusCanApply ? (reachedLevel?.minPoints ?? 0) : 0
  const carryOut = bonusCanApply ? Math.max(0, pointsAvailable - pointsSpent) : pointsAvailable
  const basePaid = mandatoryMet ? input.baseAllowance : 0

  return {
    mandatoryMet,
    netPoints,
    pointsAvailable,
    pointsSpent,
    carryOut,
    reachedLevelName: reachedLevel?.name ?? 'Ingen nivå',
    basePaid,
    extraPaid,
    totalPaid: basePaid + extraPaid,
  }
}

export function settlePastPeriods(
  profile: ChildProfile,
  interestPeriod: InterestPeriod,
  penaltyEnabled: boolean,
  bonusRequiresMandatory: boolean,
  now = new Date(),
): ChildProfile {
  const currentPeriodKey = getPeriodKey(now, profile.periodType)
  const settledKeys = new Set(
    profile.settlements
      .filter((settlement) => settlement.periodType === profile.periodType)
      .map((settlement) => settlement.periodKey),
  )
  const pendingPeriodKeys = Array.from(
    new Set(
      profile.entries
        .map((entry) => getPeriodKey(new Date(entry.timestamp), profile.periodType))
        .filter((periodKey) => periodKey !== currentPeriodKey && !settledKeys.has(periodKey)),
    ),
  ).sort(
    (a, b) =>
      getPeriodStartDate(a, profile.periodType).getTime() -
      getPeriodStartDate(b, profile.periodType).getTime(),
  )

  if (pendingPeriodKeys.length === 0) {
    return profile
  }

  let carryIn = profile.settlements[0]?.carryOut ?? profile.carryPoints
  const autoSettlements: Settlement[] = pendingPeriodKeys.map((periodKey) => {
    const outcome = computePeriodOutcome({
      entries: profile.entries,
      periodType: profile.periodType,
      periodKey,
      mandatoryTasks: profile.mandatoryTasks,
      bonusTasks: profile.bonusTasks,
      penaltyTasks: profile.penaltyTasks,
      rewardLevels: profile.rewardLevels,
      baseAllowance: profile.baseAllowance,
      carryIn,
      penaltyEnabled,
      bonusRequiresMandatory,
    })

    carryIn = outcome.carryOut
    return {
      id: crypto.randomUUID(),
      periodKey,
      periodLabel: getPeriodLabel(periodKey, profile.periodType),
      periodType: profile.periodType,
      mandatoryMet: outcome.mandatoryMet,
      basePaid: outcome.basePaid,
      extraPaid: outcome.extraPaid,
      totalPaid: outcome.totalPaid,
      pointsEarned: outcome.netPoints,
      pointsAvailable: outcome.pointsAvailable,
      pointsSpent: outcome.pointsSpent,
      carryOut: outcome.carryOut,
      reachedLevelName: outcome.reachedLevelName,
      createdAt: getInitialInterestAnchor(interestPeriod),
      withdrawnAmount: 0,
      paidAt: null,
    }
  })

  return {
    ...profile,
    carryPoints: carryIn,
    settlements: [...autoSettlements.reverse(), ...profile.settlements],
  }
}
