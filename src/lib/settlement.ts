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
  getPeriodKey,
  getPeriodLabel,
  getPeriodStartDate,
} from './period'
import type { InterestPeriod } from './coreLogic'
import { initializeBank } from './bank'

export type PeriodOutcomeInput = {
  entries: Entry[]
  periodType: PeriodType
  periodKey: string
  mandatoryTasks: MandatoryTask[]
  bonusTasks: BonusTask[]
  penaltyTasks: PenaltyTask[]
  rewardLevels: RewardLevel[]
  baseAllowance: number
  fixedAllowance?: number
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
  fixedPaid: number
  extraPaid: number
  totalPaid: number
}

// Shared by the auto-settlement effect (past periods) and the live "current period" projection,
// so both always agree on how mandatory/bonus/penalty/levels translate into a payout.
export function computePeriodOutcome(input: PeriodOutcomeInput): PeriodOutcome {
  const periodEntries = input.entries.filter(
    (entry) => (!entry.periodType || entry.periodType === input.periodType) &&
      getPeriodKey(new Date(entry.timestamp), input.periodType) === input.periodKey,
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
      return sum + (entry.points ?? task?.points ?? 0)
    }, 0)

  const penaltyPoints = input.penaltyEnabled
    ? periodEntries
        .filter((entry) => entry.taskType === 'penalty')
        .reduce((sum, entry) => {
          const task = input.penaltyTasks.find((item) => item.id === entry.taskId)
          return sum + (entry.points ?? task?.points ?? 0)
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
  const basePaid = mandatoryMet && input.mandatoryTasks.length > 0 ? input.baseAllowance : 0
  const fixedPaid = input.fixedAllowance ?? 0

  return {
    mandatoryMet,
    netPoints,
    pointsAvailable,
    pointsSpent,
    carryOut,
    reachedLevelName: reachedLevel?.name ?? 'Ingen nivå',
    basePaid,
    fixedPaid,
    extraPaid,
    totalPaid: fixedPaid + basePaid + extraPaid,
  }
}

export function settlePastPeriods(
  profile: ChildProfile,
  _interestPeriod: InterestPeriod,
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
  const pendingKeys = new Set(
    profile.entries
      .filter(entry => !entry.periodType || entry.periodType === profile.periodType)
      .map((entry) => getPeriodKey(new Date(entry.timestamp), profile.periodType))
      .filter((periodKey) => getPeriodStartDate(periodKey, profile.periodType) < getPeriodStartDate(currentPeriodKey, profile.periodType) && !settledKeys.has(periodKey)),
  )
  if (profile.allowanceStartAt) {
    const cursor = getPeriodStartDate(getPeriodKey(new Date(profile.allowanceStartAt), profile.periodType), profile.periodType)
    const currentStart = getPeriodStartDate(currentPeriodKey, profile.periodType)
    while (cursor < currentStart) {
      const key = getPeriodKey(cursor, profile.periodType)
      if (!settledKeys.has(key)) pendingKeys.add(key)
      if (profile.periodType === 'week') cursor.setDate(cursor.getDate() + 7)
      else cursor.setMonth(cursor.getMonth() + 1)
    }
  }
  const pendingPeriodKeys = Array.from(
    pendingKeys,
  ).sort(
    (a, b) =>
      getPeriodStartDate(a, profile.periodType).getTime() -
      getPeriodStartDate(b, profile.periodType).getTime(),
  )

  if (pendingPeriodKeys.length === 0) {
    return profile
  }

  const initialized = initializeBank(profile)
  let carryIn = profile.carryPoints
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
      fixedAllowance: profile.fixedAllowance,
      carryIn,
      penaltyEnabled,
      bonusRequiresMandatory,
    })

    carryIn = outcome.carryOut
    const end = getPeriodStartDate(periodKey, profile.periodType)
    if (profile.periodType === 'week') end.setDate(end.getDate() + 7)
    else end.setMonth(end.getMonth() + 1)
    return {
      id: crypto.randomUUID(),
      periodKey,
      periodLabel: getPeriodLabel(periodKey, profile.periodType),
      periodType: profile.periodType,
      mandatoryMet: outcome.mandatoryMet,
      basePaid: outcome.basePaid,
      fixedPaid: outcome.fixedPaid,
      extraPaid: outcome.extraPaid,
      totalPaid: outcome.totalPaid,
      pointsEarned: outcome.netPoints,
      pointsAvailable: outcome.pointsAvailable,
      pointsSpent: outcome.pointsSpent,
      carryOut: outcome.carryOut,
      reachedLevelName: outcome.reachedLevelName,
      createdAt: end.toISOString(),
      withdrawnAmount: 0,
      paidAt: null,
    }
  })

  return {
    ...initialized,
    carryPoints: carryIn,
    settlements: [...autoSettlements.reverse(), ...profile.settlements],
    transactions: [
      ...(initialized.transactions ?? []),
      ...[...autoSettlements].reverse().filter(item => item.totalPaid > 0).map(item => ({
        id: `salary-${item.id}`,
        type: 'salary' as const,
        amount: item.totalPaid,
        timestamp: item.createdAt,
        description: `${item.periodLabel}: fast ${item.fixedPaid ?? 0} kr, obligatorisk ${item.basePaid} kr, bonus ${item.extraPaid} kr`,
        settlementId: item.id,
      })),
    ],
  }
}
