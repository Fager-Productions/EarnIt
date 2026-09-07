import type { BonusTask, Entry, MandatoryTask, PenaltyTask, PeriodType, RewardLevel } from '../types'
import { getPeriodKey } from './period'

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

  const bonusCanApply = mandatoryMet
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
