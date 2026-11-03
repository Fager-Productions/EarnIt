import type { InterestPeriod } from './lib/coreLogic'

export type PeriodType = 'week' | 'month'
export type UserRole = 'child' | 'parent'
export type HistoryFilter = 'all' | PeriodType
export type AppTab = 'overview' | 'tasks' | 'logs' | 'history' | 'settings' | 'account'
export type PaymentStatusFilter = 'all' | 'unpaid' | 'paid'

export type MandatoryTask = {
  id: string
  name: string
  requiredCount: number
}

export type BonusTask = {
  id: string
  name: string
  points: number
  repeatEachPeriod?: boolean
  createdPeriodKey?: string
  // If true, completion is capped at 1 total across every child the task is assigned to (first come, first served).
  // If false, each assigned child can complete their own copy once per period.
  upForGrabs: boolean
}

export type PenaltyTask = {
  id: string
  name: string
  points: number
}

export type RewardLevel = {
  id: string
  name: string
  minPoints: number
  extraAmount: number
}

export type ParentAccount = {
  id: string
  username: string
  passwordHash: string
  passwordSalt: string
  passwordIterations: number
  mustChangePassword: boolean
  createdAt: string
}

export type Entry = {
  id: string
  taskType: 'mandatory' | 'bonus' | 'penalty'
  taskId: string
  timestamp: string
  periodType?: PeriodType
  taskName?: string
  points?: number
}

export type BankTransaction = {
  id: string
  type: 'salary' | 'deposit' | 'withdrawal' | 'interest' | 'opening' | 'points'
  amount: number
  timestamp: string
  description: string
  settlementId?: string
  allocations?: { transactionId: string; amount: number }[]
  pointsDelta?: number
}

export type Settlement = {
  id: string
  periodKey: string
  periodLabel: string
  periodType: PeriodType
  mandatoryMet: boolean
  basePaid: number
  fixedPaid?: number
  extraPaid: number
  totalPaid: number
  pointsEarned: number
  pointsAvailable: number
  pointsSpent: number
  carryOut: number
  reachedLevelName: string
  createdAt: string
  withdrawnAmount: number
  paidAt: string | null
}

export type ChildProfile = {
  id: string
  childName: string
  periodType: PeriodType
  baseAllowance: number
  fixedAllowance?: number
  allowanceStartAt?: string
  childPinHash: string | null
  childPinSalt: string | null
  childPinIterations: number
  childPinPlain: string | null
  mandatoryTasks: MandatoryTask[]
  bonusTasks: BonusTask[]
  penaltyTasks: PenaltyTask[]
  rewardLevels: RewardLevel[]
  historyFilter: HistoryFilter
  entries: Entry[]
  settlements: Settlement[]
  carryPoints: number
  bankDeposits: number
  transactions?: BankTransaction[]
  interestCheckpoints?: Record<string, { anchor: string; periods: number }>
}

export type ParentSettings = {
  passwordHash: string | null
  passwordSalt: string | null
  passwordIterations: number
  childPinHash: string | null
  childPinSalt: string | null
  childPinIterations: number
  penaltyEnabled: boolean
  bonusRequiresMandatory: boolean
  interestRatePct: number
  interestPeriod: InterestPeriod
  parentAccounts: ParentAccount[]
  legacyPin?: string
}

export type AppState = {
  profiles: ChildProfile[]
  activeChildId: string
  parentSettings: ParentSettings
  sharedBonusClaims?: { taskName: string; points: number; timestamp: string; childName: string }[]
}

export type DeferredInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
