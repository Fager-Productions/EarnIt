import type { AppState, BonusTask, ChildProfile, Entry, HistoryFilter, MandatoryTask, ParentSettings, PenaltyTask, PeriodType, RewardLevel, Settlement } from '../types'
import { AUTH_ITERATIONS } from './auth'

export const STORAGE_KEY = 'ukelonn-app-state-v2'
export const DEFAULT_CHILD_NAME = 'Barnets navn'

export const EMPTY_CHILD_PROFILE: ChildProfile = {
  id: '__empty-child__',
  childName: 'Ingen barn',
  periodType: 'week',
  baseAllowance: 0,
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
}

export function createDefaultProfile(name = DEFAULT_CHILD_NAME): ChildProfile {
  return {
    id: crypto.randomUUID(),
    childName: name,
    periodType: 'week',
    baseAllowance: 0,
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
    const mappedProfiles = candidate.profiles.map((profile) => ({
      ...createDefaultProfile(profile.childName || 'Barn'),
      ...profile,
      childPinHash: profile.childPinHash ?? candidate.parentSettings?.childPinHash ?? null,
      childPinSalt: profile.childPinSalt ?? candidate.parentSettings?.childPinSalt ?? null,
      childPinIterations:
        profile.childPinIterations ?? candidate.parentSettings?.childPinIterations ?? AUTH_ITERATIONS,
      childPinPlain: profile.childPinPlain ?? null,
      mandatoryTasks: profile.mandatoryTasks ?? [],
      bonusTasks: (profile.bonusTasks ?? []).map((task) => ({
        ...task,
        upForGrabs: task.upForGrabs ?? false,
      })),
      penaltyTasks: profile.penaltyTasks ?? [],
      rewardLevels: profile.rewardLevels ?? [],
      historyFilter: profile.historyFilter ?? 'all',
      entries: profile.entries ?? [],
      settlements: (profile.settlements ?? []).map((settlement) => ({
        ...settlement,
        withdrawnAmount: Math.max(0, settlement.withdrawnAmount ?? 0),
        paidAt: settlement.paidAt ?? null,
      })),
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
    migrated.entries = candidate.entries ?? []
    migrated.settlements = (candidate.settlements ?? []).map((settlement) => ({
      ...settlement,
      withdrawnAmount: Math.max(0, settlement.withdrawnAmount ?? 0),
      paidAt: settlement.paidAt ?? null,
    }))
    migrated.carryPoints = candidate.carryPoints ?? 0

    return {
      profiles: [migrated],
      activeChildId: migrated.id,
      parentSettings: {
        passwordHash: null,
        passwordSalt: null,
        passwordIterations: AUTH_ITERATIONS,
        childPinHash: null,
        childPinSalt: null,
        childPinIterations: AUTH_ITERATIONS,
        penaltyEnabled: false,
        interestRatePct: 0,
        interestPeriod: 'month',
        parentAccounts: [],
        legacyPin: '1234',
      },
    }
  }

  return initialState
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
