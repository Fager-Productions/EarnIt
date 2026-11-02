import type { AppState, BonusTask, ChildProfile, Entry, HistoryFilter, MandatoryTask, ParentSettings, PenaltyTask, PeriodType, RewardLevel, Settlement } from '../types'
import { AUTH_ITERATIONS } from './auth'
import { bankSummary, initializeBank } from './bank'

export const STORAGE_KEY = 'ukelonn-app-state-v2'
export const DEFAULT_CHILD_NAME = 'Barnets navn'

export const EMPTY_CHILD_PROFILE: ChildProfile = {
  id: '__empty-child__',
  childName: 'Ingen barn',
  periodType: 'week',
  baseAllowance: 0,
  fixedAllowance: 0,
  childPinHash: null,
  childPinSalt: null,
  childPinIterations: AUTH_ITERATIONS,
  childPinPlain: null,
  mandatoryTasks: [],
  bonusTasks: [],
  penaltyTasks: [],
  rewardLevels: [],
  historyFilter: 'all',
  entries: [],
  settlements: [],
  carryPoints: 0,
  bankDeposits: 0,
  transactions: [],
  interestCheckpoints: {},
}

export function createDefaultProfile(name = DEFAULT_CHILD_NAME): ChildProfile {
  return {
    id: crypto.randomUUID(),
    childName: name,
    periodType: 'week',
    baseAllowance: 0,
    fixedAllowance: 0,
    allowanceStartAt: new Date().toISOString(),
    childPinHash: null,
    childPinSalt: null,
    childPinIterations: AUTH_ITERATIONS,
    childPinPlain: null,
    mandatoryTasks: [],
    bonusTasks: [],
    penaltyTasks: [],
    rewardLevels: [],
    historyFilter: 'all',
    entries: [],
    settlements: [],
    carryPoints: 0,
    bankDeposits: 0,
    transactions: [],
    interestCheckpoints: {},
  }
}

const initialProfile = createDefaultProfile(DEFAULT_CHILD_NAME)
export const initialState: AppState = {
  profiles: [initialProfile],
  activeChildId: initialProfile.id,
  parentSettings: {
    passwordHash: null,
    passwordSalt: null,
    passwordIterations: AUTH_ITERATIONS,
    childPinHash: null,
    childPinSalt: null,
    childPinIterations: AUTH_ITERATIONS,
    penaltyEnabled: false,
    bonusRequiresMandatory: true,
    interestRatePct: 0,
    interestPeriod: 'month',
    parentAccounts: [],
    legacyPin: '1234',
  },
}

export function safeNumber(value: string, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function isLegacySeedProfile(profile: ChildProfile): boolean {
  const looksLikeSeedName = ['mille', 'barn'].includes(profile.childName.trim().toLowerCase())
  const hasNoConfiguredLogin = !profile.childPinHash && !profile.childPinSalt
  const hasNoCustomData =
    profile.mandatoryTasks.length === 0 &&
    profile.bonusTasks.length === 0 &&
    profile.penaltyTasks.length === 0 &&
    profile.rewardLevels.length === 0 &&
    profile.entries.length === 0 &&
    profile.settlements.length === 0 &&
    profile.carryPoints === 0

  return looksLikeSeedName && profile.baseAllowance === 0 && hasNoConfiguredLogin && hasNoCustomData
}

export function isDefaultChildName(value: string): boolean {
  return value.trim().toLowerCase() === DEFAULT_CHILD_NAME.toLowerCase()
}

export function formatChildNameForDisplay(name: string): string {
  if (isDefaultChildName(name)) {
    return `${name} (endres i Innstillinger)`
  }
  return name
}

export function getBonusTaskKey(name: string, points: number): string {
  return `${name.trim().toLowerCase()}::${Math.max(1, Math.floor(points))}`
}

export function normalizeLoadedState(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') {
    return initialState
  }

  const candidate = raw as Partial<Omit<AppState, 'parentSettings'>> & {
    parentSettings?: Partial<ParentSettings> & { parentPin?: string }
    childName?: string
    periodType?: PeriodType
    baseAllowance?: number
    mandatoryTasks?: MandatoryTask[]
    bonusTasks?: BonusTask[]
    penaltyTasks?: PenaltyTask[]
    rewardLevels?: RewardLevel[]
    historyFilter?: HistoryFilter
    entries?: Entry[]
    settlements?: Settlement[]
    carryPoints?: number
  }

  if (Array.isArray(candidate.profiles)) {
    const mappedProfiles = candidate.profiles.map((profile) => initializeBank({
      ...createDefaultProfile(profile.childName || 'Barn'),
      ...profile,
      fixedAllowance: Math.max(0, safeNumber(String(profile.fixedAllowance ?? 0))),
      baseAllowance: Math.max(0, safeNumber(String(profile.baseAllowance ?? 0))),
      carryPoints: Math.max(0, safeNumber(String(profile.carryPoints ?? 0))),
      allowanceStartAt: profile.allowanceStartAt ?? profile.entries?.map(entry => entry.timestamp).sort()[0] ?? new Date().toISOString(),
      transactions: profile.transactions,
      childPinHash: profile.childPinHash ?? candidate.parentSettings?.childPinHash ?? null,
      childPinSalt: profile.childPinSalt ?? candidate.parentSettings?.childPinSalt ?? null,
      childPinIterations:
        profile.childPinIterations ?? candidate.parentSettings?.childPinIterations ?? AUTH_ITERATIONS,
      childPinPlain: profile.childPinPlain ?? null,
      mandatoryTasks: (profile.mandatoryTasks ?? []).map((task) => ({
        ...task,
        requiredCount: Math.max(1, Math.floor(safeNumber(String(task.requiredCount), 1))),
      })),
      bonusTasks: (profile.bonusTasks ?? []).map((task) => ({
        ...task,
        points: Math.max(1, Math.floor(safeNumber(String(task.points), 1))),
        upForGrabs: task.upForGrabs ?? false,
      })),
      penaltyTasks: (profile.penaltyTasks ?? []).map((task) => ({
        ...task,
        points: Math.max(1, Math.floor(safeNumber(String(task.points), 1))),
      })),
      rewardLevels: (profile.rewardLevels ?? []).map((level) => ({
        ...level,
        minPoints: Math.max(1, Math.floor(safeNumber(String(level.minPoints), 1))),
        extraAmount: Math.max(0, Math.floor(safeNumber(String(level.extraAmount), 0))),
      })),
      historyFilter: profile.historyFilter ?? 'all',
      entries: (profile.entries ?? []).map(entry => ({ ...entry, periodType: entry.periodType ?? profile.periodType })),
      settlements: (profile.settlements ?? []).map((settlement) => ({
        ...settlement,
        withdrawnAmount: Math.max(0, settlement.withdrawnAmount ?? (settlement.paidAt ? settlement.totalPaid : 0)),
        paidAt: settlement.paidAt ?? null,
      })),
      bankDeposits: Math.max(0, profile.bankDeposits ?? 0),
    }))

    const filteredProfiles =
      mappedProfiles.length === 1 && isLegacySeedProfile(mappedProfiles[0])
        ? []
        : mappedProfiles

    const profiles = filteredProfiles.length > 0
      ? filteredProfiles
      : [createDefaultProfile(DEFAULT_CHILD_NAME)]

    const activeChildId =
      profiles.find((p) => p.id === candidate.activeChildId)?.id ?? profiles[0]?.id ?? ''

    return {
      profiles,
      activeChildId,
      parentSettings: {
        passwordHash: candidate.parentSettings?.passwordHash ?? null,
        passwordSalt: candidate.parentSettings?.passwordSalt ?? null,
        passwordIterations: candidate.parentSettings?.passwordIterations ?? AUTH_ITERATIONS,
        childPinHash: candidate.parentSettings?.childPinHash ?? null,
        childPinSalt: candidate.parentSettings?.childPinSalt ?? null,
        childPinIterations: candidate.parentSettings?.childPinIterations ?? AUTH_ITERATIONS,
        penaltyEnabled: candidate.parentSettings?.penaltyEnabled ?? false,
        bonusRequiresMandatory: candidate.parentSettings?.bonusRequiresMandatory ?? true,
        interestRatePct: Math.max(0, candidate.parentSettings?.interestRatePct ?? 0),
        interestPeriod: candidate.parentSettings?.interestPeriod ?? 'month',
        parentAccounts: candidate.parentSettings?.parentAccounts ?? [],
        legacyPin: candidate.parentSettings?.legacyPin ?? candidate.parentSettings?.parentPin,
      },
    }
  }

  if (candidate.childName) {
    const migrated = createDefaultProfile(candidate.childName)
    migrated.periodType = candidate.periodType ?? 'week'
    migrated.baseAllowance = candidate.baseAllowance ?? 120
    migrated.childPinHash = candidate.parentSettings?.childPinHash ?? null
    migrated.childPinSalt = candidate.parentSettings?.childPinSalt ?? null
    migrated.childPinIterations = candidate.parentSettings?.childPinIterations ?? AUTH_ITERATIONS
    migrated.childPinPlain = null
    migrated.mandatoryTasks = candidate.mandatoryTasks ?? migrated.mandatoryTasks
    migrated.bonusTasks = candidate.bonusTasks ?? migrated.bonusTasks
    migrated.penaltyTasks = candidate.penaltyTasks ?? migrated.penaltyTasks
    migrated.rewardLevels = candidate.rewardLevels ?? migrated.rewardLevels
    migrated.historyFilter = candidate.historyFilter ?? 'all'
    migrated.entries = (candidate.entries ?? []).map(entry => ({ ...entry, periodType: entry.periodType ?? migrated.periodType }))
    migrated.settlements = (candidate.settlements ?? []).map((settlement) => ({
      ...settlement,
      withdrawnAmount: Math.max(0, settlement.withdrawnAmount ?? (settlement.paidAt ? settlement.totalPaid : 0)),
      paidAt: settlement.paidAt ?? null,
    }))
    migrated.carryPoints = candidate.carryPoints ?? 0
    migrated.bankDeposits = Math.max(0, (candidate as { bankDeposits?: number }).bankDeposits ?? 0)
    migrated.transactions = undefined
    migrated.allowanceStartAt = migrated.entries.map(entry => entry.timestamp).sort()[0] ?? new Date().toISOString()

    return {
      profiles: [initializeBank(migrated)],
      activeChildId: migrated.id,
      parentSettings: {
        passwordHash: null,
        passwordSalt: null,
        passwordIterations: AUTH_ITERATIONS,
        childPinHash: null,
        childPinSalt: null,
        childPinIterations: AUTH_ITERATIONS,
        penaltyEnabled: false,
        bonusRequiresMandatory: true,
        interestRatePct: 0,
        interestPeriod: 'month',
        parentAccounts: [],
        legacyPin: '1234',
      },
    }
  }

  return initialState
}

export function parseBackupState(raw: unknown): AppState {
  const object = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  if (!object(raw) || (!Array.isArray(raw.profiles) && typeof raw.childName !== 'string')) {
    throw new Error('Filen er ikke en Ukelønn-sikkerhetskopi.')
  }
  const profiles = Array.isArray(raw.profiles) ? raw.profiles : [raw]
  const profileIds = new Set<string>()
  for (const profile of profiles) {
    if (!object(profile) || typeof profile.childName !== 'string' ||
      !['week', 'month'].includes(String(profile.periodType))) {
      throw new Error('Sikkerhetskopien har en ugyldig barneprofil.')
    }
    if (Array.isArray(raw.profiles)) {
      if (typeof profile.id !== 'string' || profileIds.has(profile.id)) throw new Error('Ugyldige eller dupliserte profil-ID-er.')
      profileIds.add(profile.id)
    }
    for (const key of ['baseAllowance', 'fixedAllowance', 'bankDeposits', 'carryPoints']) {
      const value = profile[key]
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw new Error(`Ugyldig verdi for ${key}.`)
      }
    }
    for (const key of ['mandatoryTasks', 'bonusTasks', 'penaltyTasks', 'rewardLevels', 'entries', 'settlements', 'transactions']) {
      const items = profile[key]
      if (items === undefined && ['penaltyTasks', 'transactions'].includes(key)) continue
      if (!Array.isArray(items)) throw new Error(`Sikkerhetskopien har ugyldig ${key}.`)
      const ids = new Set<string>()
      for (const item of items) {
        if (!object(item) || typeof item.id !== 'string' || ids.has(item.id)) throw new Error(`Ugyldig ID i ${key}.`)
        ids.add(item.id)
        for (const numberKey of ['amount', 'points', 'requiredCount', 'minPoints', 'extraAmount', 'totalPaid', 'withdrawnAmount']) {
          if (item[numberKey] !== undefined && (typeof item[numberKey] !== 'number' || !Number.isFinite(item[numberKey]))) {
            throw new Error(`Ugyldig beløp eller poeng i ${key}.`)
          }
        }
        if (['entries', 'transactions'].includes(key) &&
          (typeof item.timestamp !== 'string' || !Number.isFinite(new Date(item.timestamp).getTime()))) {
          throw new Error(`Ugyldig dato i ${key}.`)
        }
        if (key === 'transactions' && !['salary', 'deposit', 'withdrawal', 'interest', 'opening', 'points'].includes(String(item.type))) {
          throw new Error('Ugyldig transaksjonstype.')
        }
        if (key === 'transactions') {
          if (typeof item.amount !== 'number' ||
            (item.type === 'withdrawal' ? item.amount >= 0 : item.type === 'points' ? item.amount !== 0 : item.amount <= 0)) {
            throw new Error('Ugyldig transaksjonsbeløp.')
          }
          if (item.type === 'withdrawal') {
            if (!Array.isArray(item.allocations) || item.allocations.some(allocation =>
              !object(allocation) || typeof allocation.transactionId !== 'string' ||
              typeof allocation.amount !== 'number' || !Number.isFinite(allocation.amount) || allocation.amount <= 0)) {
              throw new Error('Uttaket mangler gyldig fordeling mot innskudd.')
            }
            const allocated = item.allocations.reduce((sum: number, allocation: { amount: number }) => sum + allocation.amount, 0)
            if (Math.abs(allocated + item.amount) > 0.005) throw new Error('Uttaksbeløpet stemmer ikke med fordelingen.')
          }
        }
      }
    }
  }
  const normalized = normalizeLoadedState(raw)
  for (const profile of normalized.profiles) {
    if (bankSummary(profile).balance < 0) throw new Error('Sikkerhetskopien har negativ banksaldo.')
  }
  return normalized
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return initialState
    }
    const parsed = JSON.parse(raw)
    return normalizeLoadedState(parsed)
  } catch {
    return initialState
  }
}
