import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { InterestPeriod } from './lib/coreLogic'
import './App.css'
import type {
  AppState,
  AppTab,
  BonusTask,
  ChildProfile,
  HistoryFilter,
  PaymentStatusFilter,
  PenaltyTask,
  PeriodType,
  RewardLevel,
  UserRole,
} from './types'
import {
  ADMIN_LOGIN_ENABLED,
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  AUTH_IDLE_TIMEOUT_MS,
  AUTH_ITERATIONS,
  AUTH_LOCK_MAX_ATTEMPTS,
  AUTH_LOCK_MS,
  AUTH_SESSION_KEY,
  CHILD_AUTH_ENDPOINT,
  authenticateChildCodeWithBackend,
  createChildCodeCandidate,
  createRandomHex,
  derivePasswordHash,
  getParentPasswordStrengthLabel,
  isValidChildCode,
  isValidParentPassword,
} from './lib/auth'
import {
  formatDateRangeLabel,
  getMonthKey,
  getPeriodKey,
  getPeriodLabel,
  getPeriodStartDate,
  getPeriodSummaryLabel,
  isBonusTaskAvailableInPeriod,
  isEntryInCurrentPeriod,
} from './lib/period'
import {
  DEFAULT_CHILD_NAME,
  EMPTY_CHILD_PROFILE,
  STORAGE_KEY,
  createDefaultProfile,
  formatChildNameForDisplay,
  getBonusTaskKey,
  initialState,
  isDefaultChildName,
  loadState,
  parseBackupState,
  safeNumber,
} from './lib/state'
import { settlePastPeriods } from './lib/settlement'
import { computePeriodOutcome } from './lib/settlement'
import { accrueBankInterest, bankSummary as summarizeBank, depositToBank, resetInterestSchedule, roundMoney, settlementBankSummary, withdrawFromBank } from './lib/bank'
import type { CloudContext } from './lib/backend'
import InstallHelp from './InstallHelp'

const ParentDashboard = lazy(() => import('./ParentDashboard'))

function App({ cloud }: { cloud?: CloudContext } = {}) {
  const previouslyFocusedValueInput = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<AppState>(() => cloud?.state ?? loadState())
  const [role, setRole] = useState<UserRole>(cloud?.role ?? 'child')
  const [now, setNow] = useState(() => new Date())
  const [cloudBusy, setCloudBusy] = useState(false)
  const savingRef = useRef(false)
  const [cloudCodes, setCloudCodes] = useState<Record<string, string>>({})
  const [parentPreviewChildView, setParentPreviewChildView] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(Boolean(cloud))
  const [isParentUnlocked, setIsParentUnlocked] = useState(cloud?.role === 'parent')
  const [parentUsernameInput, setParentUsernameInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [showPasswordInput, setShowPasswordInput] = useState(false)
  const [isParentAdminSession, setIsParentAdminSession] = useState(false)
  const [mustChangeParentPasswordAccountId, setMustChangeParentPasswordAccountId] = useState<string | null>(null)
  const [firstLoginNewPassword, setFirstLoginNewPassword] = useState('')
  const [showFirstLoginNewPassword, setShowFirstLoginNewPassword] = useState(false)
  const [childPinInput, setChildPinInput] = useState('')
  const [showChildPinInput, setShowChildPinInput] = useState(false)
  const [rememberParentSession, setRememberParentSession] = useState(true)
  const [authAttempts, setAuthAttempts] = useState(0)
  const [authLockedUntil, setAuthLockedUntil] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<AppTab>('overview')
  const [dashboardChildId, setDashboardChildId] = useState('all')
  const [bankChildId, setBankChildId] = useState('all')
  const [penaltyTargetChildIdByTask, setPenaltyTargetChildIdByTask] = useState<Record<string, string>>({})

  const [newChildName, setNewChildName] = useState('')
  const [newParentAccountUsername, setNewParentAccountUsername] = useState('')
  const [newParentAccountPassword, setNewParentAccountPassword] = useState('')
  const [showNewParentAccountPassword, setShowNewParentAccountPassword] = useState(false)
  const [newParentAccountMustChangePassword, setNewParentAccountMustChangePassword] = useState(true)
  const [visibleChildCodeById, setVisibleChildCodeById] = useState<Record<string, boolean>>({})
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState<PaymentStatusFilter>('all')

  const [newMandatoryName, setNewMandatoryName] = useState('')
  const [newMandatoryCount, setNewMandatoryCount] = useState('1')
  const [newBonusName, setNewBonusName] = useState('')
  const [newBonusPoints, setNewBonusPoints] = useState(1)
  const [newBonusUpForGrabs, setNewBonusUpForGrabs] = useState(false)
  const [newBonusRepeatEachPeriod, setNewBonusRepeatEachPeriod] = useState(false)
  const [newPenaltyName, setNewPenaltyName] = useState('')
  const [newPenaltyPoints, setNewPenaltyPoints] = useState(1)
  const [newLevelName, setNewLevelName] = useState('')
  const [newLevelPoints, setNewLevelPoints] = useState(5)
  const [newLevelAmount, setNewLevelAmount] = useState(10)
  const [depositAmountInput, setDepositAmountInput] = useState('')
  const [withdrawalAmountInput, setWithdrawalAmountInput] = useState('')
  const [bankWithdrawalMode, setBankWithdrawalMode] = useState<'money' | 'points'>('money')
  const [taskTargetChildIds, setTaskTargetChildIds] = useState<string[]>([])
  const [editingBaseAllowance, setEditingBaseAllowance] = useState(false)
  const [baseAllowanceEditingChildId, setBaseAllowanceEditingChildId] = useState<string | null>(null)
  const [baseAllowanceDraft, setBaseAllowanceDraft] = useState(0)
  const [levelUpToast, setLevelUpToast] = useState<string | null>(null)
  const previousLevelByChildRef = useRef<Record<string, string | null>>({})
  const toastTimerRef = useRef<number | null>(null)
  const parentIdleTimerRef = useRef<number | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const persist = useCallback(async (next: AppState): Promise<boolean> => {
    if (savingRef.current) {
      window.alert('Vent til den pågående lagringen er ferdig.')
      return false
    }

    savingRef.current = true
    setCloudBusy(true)
    try {
      const rateChanged = next.parentSettings.interestRatePct !== state.parentSettings.interestRatePct ||
        next.parentSettings.interestPeriod !== state.parentSettings.interestPeriod
      const prepared = {
        ...next,
        profiles: next.profiles.map(profile => {
          const accrued = accrueBankInterest(profile, rateChanged ? state.parentSettings : next.parentSettings)
          return rateChanged ? resetInterestSchedule(accrued) : accrued
        }),
      }
      if (cloud) {
        if (cloud.role !== 'parent') {
          setState(next)
          return true
        }
        setState(await cloud.saveState(prepared))
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prepared))
        setState(prepared)
      }
      return true
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Kunne ikke lagre endringen.')
      return false
    } finally {
      savingRef.current = false
      setCloudBusy(false)
    }
  }, [cloud, state.parentSettings])

  const activeProfile =
    state.profiles.find((profile) => profile.id === state.activeChildId) ?? state.profiles[0] ?? EMPTY_CHILD_PROFILE
  const hasProfiles = state.profiles.length > 0

  const currentPeriodKey = getPeriodKey(now, activeProfile.periodType)
  const currentPeriodLabel = getPeriodLabel(currentPeriodKey, activeProfile.periodType)
  const currentPeriodRangeLabel = useMemo(
    () => formatDateRangeLabel(now, activeProfile.periodType),
    [activeProfile.periodType, now],
  )

  const currentPeriodEntries = useMemo(
    () =>
      activeProfile.entries.filter((entry) =>
        isEntryInCurrentPeriod(entry, activeProfile.periodType, currentPeriodKey),
      ),
    [activeProfile.entries, activeProfile.periodType, currentPeriodKey],
  )
  const previousRegistrationPeriods = useMemo(() => {
    const currentPeriodStart = getPeriodStartDate(currentPeriodKey, activeProfile.periodType)
    const periods = new Map<string, ChildProfile['entries']>()

    activeProfile.entries.forEach((entry) => {
      if (entry.periodType && entry.periodType !== activeProfile.periodType) return
      const periodKey = getPeriodKey(new Date(entry.timestamp), activeProfile.periodType)
      if (getPeriodStartDate(periodKey, activeProfile.periodType) >= currentPeriodStart) return
      const entries = periods.get(periodKey) ?? []
      entries.push(entry)
      periods.set(periodKey, entries)
    })

    return Array.from(periods, ([periodKey, entries]) => ({ periodKey, entries })).sort(
      (a, b) =>
        getPeriodStartDate(b.periodKey, activeProfile.periodType).getTime() -
        getPeriodStartDate(a.periodKey, activeProfile.periodType).getTime(),
    )
  }, [activeProfile.entries, activeProfile.periodType, currentPeriodKey])

  useEffect(() => {
    const refresh = () => setNow(new Date())
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const remoteState = cloud?.state
  useEffect(() => {
    if (remoteState) {
      // Synchronizes confirmed remote state; no optimistic writes to financial data.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(remoteState)
    }
  }, [remoteState])

  const mandatoryCountMap = useMemo(() => {
    const map: Record<string, number> = {}
    currentPeriodEntries
      .filter((entry) => entry.taskType === 'mandatory')
      .forEach((entry) => {
        map[entry.taskId] = (map[entry.taskId] ?? 0) + 1
      })
    return map
  }, [currentPeriodEntries])

  const mandatoryMet = useMemo(
    () =>
      activeProfile.mandatoryTasks.every(
        (task) => (mandatoryCountMap[task.id] ?? 0) >= task.requiredCount,
      ),
    [activeProfile.mandatoryTasks, mandatoryCountMap],
  )

  const bonusPointsThisPeriod = useMemo(
    () =>
      currentPeriodEntries
        .filter((entry) => entry.taskType === 'bonus')
        .reduce((sum, entry) => {
          const task = activeProfile.bonusTasks.find((item) => item.id === entry.taskId)
          return sum + (entry.points ?? task?.points ?? 0)
        }, 0),
    [currentPeriodEntries, activeProfile.bonusTasks],
  )

  const penaltyPointsThisPeriod = useMemo(
    () => {
      if (!state.parentSettings.penaltyEnabled) {
        return 0
      }
      return currentPeriodEntries
        .filter((entry) => entry.taskType === 'penalty')
        .reduce((sum, entry) => {
          const task = activeProfile.penaltyTasks.find((item) => item.id === entry.taskId)
          return sum + (entry.points ?? task?.points ?? 0)
        }, 0)
    },
    [currentPeriodEntries, activeProfile.penaltyTasks, state.parentSettings.penaltyEnabled],
  )

  const netPointsThisPeriod = bonusPointsThisPeriod - penaltyPointsThisPeriod

  const bonusCountMap = useMemo(() => {
    const map: Record<string, number> = {}
    currentPeriodEntries
      .filter((entry) => entry.taskType === 'bonus')
      .forEach((entry) => {
        map[entry.taskId] = (map[entry.taskId] ?? 0) + 1
      })
    return map
  }, [currentPeriodEntries])

  const pointsAvailableNow = Math.max(0, activeProfile.carryPoints + netPointsThisPeriod)

  const sortedLevels = useMemo(
    () => [...activeProfile.rewardLevels].sort((a, b) => a.minPoints - b.minPoints),
    [activeProfile.rewardLevels],
  )

  const reachedLevelNow =
    sortedLevels.filter((level) => level.minPoints <= pointsAvailableNow).at(-1) ?? null

  const currentOutcome = computePeriodOutcome({
    ...activeProfile,
    periodKey: currentPeriodKey,
    carryIn: activeProfile.carryPoints,
    penaltyEnabled: state.parentSettings.penaltyEnabled,
    bonusRequiresMandatory: state.parentSettings.bonusRequiresMandatory,
  })
  const projectedCarryOut = currentOutcome.carryOut
  const projectedTotalAllowance = currentOutcome.totalPaid

  const mandatoryRequiredTotal = activeProfile.mandatoryTasks.reduce(
    (sum, task) => sum + task.requiredCount,
    0,
  )
  const mandatoryDoneTotal = activeProfile.mandatoryTasks.reduce(
    (sum, task) => sum + Math.min(task.requiredCount, mandatoryCountMap[task.id] ?? 0),
    0,
  )
  const mandatoryCompletionPct =
    mandatoryRequiredTotal > 0
      ? Math.round((mandatoryDoneTotal / mandatoryRequiredTotal) * 100)
      : 0

  const nextLevel = sortedLevels.find((level) => level.minPoints > pointsAvailableNow) ?? null
  const sortedBonusTasks = useMemo(
    () =>
      [...activeProfile.bonusTasks].sort((a, b) =>
        a.name.localeCompare(b.name, 'nb-NO', { sensitivity: 'base' }),
      ),
    [activeProfile.bonusTasks],
  )
  const activeProfileBonusTaskByKey = useMemo(() => {
    const map = new Map<string, BonusTask>()
    activeProfile.bonusTasks
      .filter(task => isBonusTaskAvailableInPeriod(task, currentPeriodKey))
      .forEach(task => map.set(getBonusTaskKey(task.name, task.points), task))
    return map
  }, [activeProfile.bonusTasks, currentPeriodKey])

  const sharedBonusTasks = useMemo(() => {
    const taskMap = new Map<
      string,
      {
        key: string
        name: string
        points: number
        upForGrabs: boolean
        childNames: string[]
      }
    >()

    state.profiles.forEach((profile) => {
      const periodKey = getPeriodKey(now, profile.periodType)
      profile.bonusTasks
        .filter(task => isBonusTaskAvailableInPeriod(task, periodKey))
        .forEach((task) => {
          const key = getBonusTaskKey(task.name, task.points)
          const existing = taskMap.get(key)
          if (!existing) {
            taskMap.set(key, {
              key,
              name: task.name,
              points: task.points,
              upForGrabs: task.upForGrabs,
              childNames: [profile.childName],
            })
            return
          }
          if (!existing.childNames.includes(profile.childName)) {
            existing.childNames.push(profile.childName)
          }
        })
    })

    return Array.from(taskMap.values())
      .map((item) => ({
        ...item,
        childNames: [...item.childNames].sort((a, b) =>
          a.localeCompare(b, 'nb-NO', { sensitivity: 'base' }),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nb-NO', { sensitivity: 'base' }))
  }, [state.profiles, now])

  const sharedBonusEntriesThisPeriod = useMemo(() => {
    const entries = state.profiles.flatMap((profile) => {
      const profileCurrentPeriodKey = getPeriodKey(now, profile.periodType)
      return profile.entries
        .filter((entry) => entry.taskType === 'bonus')
        .filter((entry) => isEntryInCurrentPeriod(entry, profile.periodType, profileCurrentPeriodKey))
        .map((entry) => {
          const task = profile.bonusTasks.find((item) => item.id === entry.taskId)
          return {
            id: `${profile.id}:${entry.id}`,
            taskName: task?.name ?? 'Ukjent oppgave',
            points: task?.points ?? 0,
            timestamp: entry.timestamp,
            childName: profile.childName,
            taskKey: getBonusTaskKey(task?.name ?? 'Ukjent oppgave', task?.points ?? 1),
          }
        })
    })

    const remoteClaims = cloud?.role === 'child' ? (state.sharedBonusClaims ?? [])
      .filter(claim => !entries.some(entry => entry.timestamp === claim.timestamp && entry.taskName === claim.taskName && entry.childName === claim.childName))
      .map(claim => ({
        ...claim, id: `claim:${claim.taskName}:${claim.timestamp}:${claim.childName}`,
        taskKey: getBonusTaskKey(claim.taskName, claim.points),
      })) : []
    return [...entries, ...remoteClaims].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
  }, [state.profiles, state.sharedBonusClaims, cloud?.role, now])

  const sharedBonusCountByTaskKey = useMemo(() => {
    const map = new Map<string, number>()
    sharedBonusEntriesThisPeriod.forEach((entry) => {
      map.set(entry.taskKey, (map.get(entry.taskKey) ?? 0) + 1)
    })
    return map
  }, [sharedBonusEntriesThisPeriod])

  const bonusTakenByChildByTaskKey = useMemo(() => {
    const map = new Map<string, string>()
    sharedBonusEntriesThisPeriod.forEach((entry) => {
      if (!map.has(entry.taskKey)) {
        map.set(entry.taskKey, entry.childName)
      }
    })
    return map
  }, [sharedBonusEntriesThisPeriod])

  const childPinConfigured =
    Boolean(CHILD_AUTH_ENDPOINT) ||
    state.profiles.some((profile) => Boolean(profile.childPinHash && profile.childPinSalt))

  const dashboardProfileData = useMemo(() => state.profiles.map((profile) => {
    const periodKey = getPeriodKey(now, profile.periodType)
    const periodEntries = profile.entries.filter((entry) =>
      isEntryInCurrentPeriod(entry, profile.periodType, periodKey),
    )
    const mandatoryCountMap = new Map<string, number>()
    const bonusCountMap = new Map<string, number>()
    const penaltyCountMap = new Map<string, number>()
    periodEntries.forEach((entry) => {
      const target = entry.taskType === 'mandatory'
        ? mandatoryCountMap
        : entry.taskType === 'bonus'
          ? bonusCountMap
          : penaltyCountMap
      target.set(entry.taskId, (target.get(entry.taskId) ?? 0) + 1)
    })

    const mandatoryRequiredTotal = profile.mandatoryTasks.reduce((sum, task) => sum + task.requiredCount, 0)
    const mandatoryDoneTotal = profile.mandatoryTasks.reduce(
      (sum, task) => sum + Math.min(task.requiredCount, mandatoryCountMap.get(task.id) ?? 0),
      0,
    )
    const mandatoryMet = mandatoryDoneTotal >= mandatoryRequiredTotal
    const bonusPoints = periodEntries.filter(entry => entry.taskType === 'bonus').reduce(
      (sum, entry) => sum + (entry.points ?? profile.bonusTasks.find(task => task.id === entry.taskId)?.points ?? 0), 0)
    const penaltyPoints = state.parentSettings.penaltyEnabled
      ? periodEntries.filter(entry => entry.taskType === 'penalty').reduce(
        (sum, entry) => sum + (entry.points ?? profile.penaltyTasks.find(task => task.id === entry.taskId)?.points ?? 0), 0)
      : 0
    const pointsAvailable = Math.max(0, profile.carryPoints + bonusPoints - penaltyPoints)
    const sortedLevels = [...profile.rewardLevels].sort((a, b) => a.minPoints - b.minPoints)
    const reachedLevel = sortedLevels.filter((level) => level.minPoints <= pointsAvailable).at(-1) ?? null
    const nextLevel = sortedLevels.find((level) => level.minPoints > pointsAvailable) ?? null
    const outcome = computePeriodOutcome({
      ...profile, periodKey, carryIn: profile.carryPoints,
      penaltyEnabled: state.parentSettings.penaltyEnabled,
      bonusRequiresMandatory: state.parentSettings.bonusRequiresMandatory,
    })
    const projectedExtra = outcome.extraPaid
    const projectedTotalAllowance = outcome.totalPaid

    return {
      profile,
      mandatoryRequiredTotal,
      mandatoryDoneTotal,
      mandatoryCompletionPct: mandatoryRequiredTotal > 0
        ? Math.round((mandatoryDoneTotal / mandatoryRequiredTotal) * 100)
        : 0,
      mandatoryMet,
      pointsAvailable,
      netPoints: bonusPoints - penaltyPoints,
      reachedLevelName: reachedLevel?.name ?? 'Ingen nivå',
      nextLevelPoints: nextLevel?.minPoints ?? pointsAvailable,
      projectedExtra,
      projectedTotalAllowance,
      projectedCarryOut: outcome.carryOut,
      bonusPoints,
      penaltyPoints,
      payout: {
        id: profile.id,
        name: profile.childName,
        fastlønn: outcome.fixedPaid,
        grunnlønn: outcome.basePaid,
        bonus: projectedExtra,
        total: projectedTotalAllowance,
      },
      mandatory: profile.mandatoryTasks.map((task) => ({
        name: task.name,
        gjort: Math.min(task.requiredCount, mandatoryCountMap.get(task.id) ?? 0),
        krav: task.requiredCount,
      })),
      bonus: profile.bonusTasks.map((task) => ({
        name: task.name,
        poeng: (bonusCountMap.get(task.id) ?? 0) * task.points,
      })),
      penalty: profile.penaltyTasks.map((task) => ({
        name: task.name,
        trekk: (penaltyCountMap.get(task.id) ?? 0) * task.points,
      })),
      settlements: profile.settlements.slice(0, 6).reverse().map((settlement) => ({
        periode: `${profile.childName}: ${settlement.periodLabel}`,
        utbetaling: settlement.totalPaid,
        poeng: settlement.pointsEarned,
        periodType: settlement.periodType,
      })),
    }
  }), [state.parentSettings.penaltyEnabled, state.parentSettings.bonusRequiresMandatory, state.profiles, now])

  const effectiveDashboardChildId = dashboardChildId !== 'all' && state.profiles.some((profile) => profile.id === dashboardChildId)
    ? dashboardChildId
    : 'all'
  const dashboardSelection = effectiveDashboardChildId === 'all'
    ? dashboardProfileData
    : dashboardProfileData.filter((item) => item.profile.id === effectiveDashboardChildId)
  const dashboardIsAll = effectiveDashboardChildId === 'all'
  const dashboardSelected = dashboardSelection[0]
  const dashboardMandatoryRequiredTotal = dashboardSelection.reduce((sum, item) => sum + item.mandatoryRequiredTotal, 0)
  const dashboardMandatoryDoneTotal = dashboardSelection.reduce((sum, item) => sum + item.mandatoryDoneTotal, 0)
  const dashboardMandatoryCompletionPct = dashboardMandatoryRequiredTotal > 0
    ? Math.round((dashboardMandatoryDoneTotal / dashboardMandatoryRequiredTotal) * 100)
    : 0
  const dashboardPointsAvailable = dashboardSelection.reduce((sum, item) => sum + item.pointsAvailable, 0)
  const dashboardNetPoints = dashboardSelection.reduce((sum, item) => sum + item.netPoints, 0)
  const dashboardProjectedExtra = dashboardSelection.reduce((sum, item) => sum + item.projectedExtra, 0)
  const dashboardProjectedTotalAllowance = dashboardSelection.reduce((sum, item) => sum + item.projectedTotalAllowance, 0)
  const dashboardProjectedCarryOut = dashboardSelection.reduce((sum, item) => sum + item.projectedCarryOut, 0)
  const dashboardBonusPoints = dashboardSelection.reduce((sum, item) => sum + item.bonusPoints, 0)
  const dashboardPenaltyPoints = dashboardSelection.reduce((sum, item) => sum + item.penaltyPoints, 0)
  const dashboardMandatoryMet = dashboardSelection.every((item) => item.mandatoryMet)
  const dashboardUnpaidSummary = dashboardSelection.reduce(
    (summary, item) => {
      const unpaid = summarizeBank(item.profile)
      return {
        principal: roundMoney(summary.principal + unpaid.principal),
        totalWithInterest: roundMoney(summary.totalWithInterest + unpaid.balance),
        interest: roundMoney(summary.interest + unpaid.interest),
      }
    },
    { principal: 0, totalWithInterest: 0, interest: 0 },
  )
  const dashboardTotalEarnedAllowance = dashboardSelection.reduce(
    (sum, item) => sum + item.profile.settlements.reduce((total, settlement) => total + settlement.totalPaid, 0),
    0,
  )
  const dashboardTotalWithdrawnAllowance = dashboardSelection.reduce(
    (sum, item) => sum + summarizeBank(item.profile).withdrawn,
    0,
  )
  const dashboardPayoutChartData = dashboardIsAll
    ? dashboardSelection.map((item) => item.payout)
    : [
      { name: 'Fast lønn', amount: dashboardSelected?.payout.fastlønn ?? 0 },
      { name: 'Obligatorisk lønn', amount: dashboardSelected?.payout.grunnlønn ?? 0 },
      { name: 'Bonus', amount: dashboardSelected?.payout.bonus ?? 0 },
      { name: 'Total', amount: dashboardSelected?.payout.total ?? 0 },
    ]
  const dashboardLevelProgressData = dashboardSelection.map((item) => ({
    name: dashboardIsAll ? item.profile.childName : 'Poeng',
    na: item.pointsAvailable,
    mal: item.nextLevelPoints,
  }))
  const combineChartValues = (key: 'mandatory' | 'bonus' | 'penalty') => {
    const values = new Map<string, { name: string; gjort?: number; krav?: number; poeng?: number; trekk?: number }>()
    dashboardSelection.forEach((item) => {
      item[key].forEach((value) => {
        const existing = values.get(value.name) ?? { name: value.name }
        if (key === 'mandatory') {
          const mandatoryValue = value as { gjort: number; krav: number }
          existing.gjort = (existing.gjort ?? 0) + mandatoryValue.gjort
          existing.krav = (existing.krav ?? 0) + mandatoryValue.krav
        } else if (key === 'bonus') {
          const bonusValue = value as { poeng: number }
          existing.poeng = (existing.poeng ?? 0) + bonusValue.poeng
        } else {
          const penaltyValue = value as { trekk: number }
          existing.trekk = (existing.trekk ?? 0) + penaltyValue.trekk
        }
        values.set(value.name, existing)
      })
    })
    return Array.from(values.values())
  }
  const dashboardMandatoryProgressData = combineChartValues('mandatory') as Array<{ name: string; gjort: number; krav: number }>
  const dashboardBonusContributionData = combineChartValues('bonus') as Array<{ name: string; poeng: number }>
  const dashboardPenaltyContributionData = combineChartValues('penalty') as Array<{ name: string; trekk: number }>
  const dashboardSettlementHistoryData = dashboardSelection.flatMap((item) => item.settlements)

  const unpaidSummary = summarizeBank(activeProfile)
  const unpaidSettlementsTotalWithInterest = unpaidSummary.balance
  const unpaidSettlementsInterest = unpaidSummary.interest
  const childSavingsBeforeInterest = unpaidSummary.principal

  const effectiveBankChildId =
    bankChildId !== 'all' && state.profiles.some((profile) => profile.id === bankChildId)
      ? bankChildId
      : 'all'
  const bankProfiles = effectiveBankChildId === 'all'
    ? state.profiles
    : state.profiles.filter((profile) => profile.id === effectiveBankChildId)
  const bankSelectedProfile = effectiveBankChildId === 'all' ? null : bankProfiles[0] ?? null
  const bankSummary = useMemo(
    () =>
      bankProfiles.reduce(
        (summary, profile) => {
          const unpaid = summarizeBank(profile)
          return {
            earned: roundMoney(summary.earned + profile.settlements.reduce((total, settlement) => total + settlement.totalPaid, 0)),
            deposits: roundMoney(summary.deposits + unpaid.deposits),
            withdrawn: roundMoney(summary.withdrawn + unpaid.withdrawn),
            interest: roundMoney(summary.interest + unpaid.interest),
            balance: roundMoney(summary.balance + unpaid.balance),
          }
        },
        { earned: 0, deposits: 0, withdrawn: 0, interest: 0, balance: 0 },
      ),
    [bankProfiles],
  )
  const bankSelectedBalance = bankSelectedProfile
    ? summarizeBank(bankSelectedProfile).balance
    : 0

  const paidThisMonthTotal = useMemo(() => {
    const currentMonthKey = getMonthKey(new Date())
    return roundMoney(-(activeProfile.transactions ?? [])
      .filter(transaction => transaction.type === 'withdrawal')
      .filter(transaction => getMonthKey(new Date(transaction.timestamp)) === currentMonthKey)
      .reduce((sum, transaction) => sum + transaction.amount, 0))
  }, [activeProfile.transactions])

  const totalEarnedAllowance = useMemo(
    () => activeProfile.settlements.reduce((sum, settlement) => sum + settlement.totalPaid, 0),
    [activeProfile.settlements],
  )

  const totalWithdrawnAllowance = useMemo(
    () => summarizeBank(activeProfile).withdrawn,
    [activeProfile],
  )

  function getChildrenForTask(
    taskType: 'mandatory' | 'bonus' | 'penalty',
    taskName: string,
    pointsOrCount?: number,
  ): string[] {
    const normalizedName = taskName.trim().toLowerCase()
    if (!normalizedName) {
      return []
    }

    return state.profiles
      .filter((profile) => {
        if (taskType === 'mandatory') {
          return profile.mandatoryTasks.some(
            (task) =>
              task.name.trim().toLowerCase() === normalizedName &&
              task.requiredCount === (pointsOrCount ?? task.requiredCount),
          )
        }
        if (taskType === 'bonus') {
          return profile.bonusTasks.some(
            (task) =>
              task.name.trim().toLowerCase() === normalizedName &&
              task.points === (pointsOrCount ?? task.points),
          )
        }
        return profile.penaltyTasks.some(
          (task) =>
            task.name.trim().toLowerCase() === normalizedName &&
            task.points === (pointsOrCount ?? task.points),
        )
      })
      .map((profile) => profile.childName)
  }

  const previousSettlementTotal = activeProfile.settlements[0]?.totalPaid ?? null
  const payoutTrendDiff =
    previousSettlementTotal === null ? null : projectedTotalAllowance - previousSettlementTotal
  const payoutTrendLabel =
    payoutTrendDiff === null
      ? 'Ingen tidligere periode'
      : payoutTrendDiff > 0
        ? `Opp ${payoutTrendDiff} kr vs forrige periode`
        : payoutTrendDiff < 0
          ? `Ned ${Math.abs(payoutTrendDiff)} kr vs forrige periode`
          : 'Uendret vs forrige periode'

  const topBonusTask = useMemo(() => {
    const ranked = sortedBonusTasks
      .map((task) => ({
        name: task.name,
        points: (bonusCountMap[task.id] ?? 0) * task.points,
      }))
      .sort((a, b) => b.points - a.points)
    return ranked[0] && ranked[0].points > 0 ? ranked[0] : null
  }, [bonusCountMap, sortedBonusTasks])

  const visibleSettlements = useMemo(() => {
    if (historyPaymentFilter === 'all') {
      return activeProfile.settlements
    }
    if (historyPaymentFilter === 'paid') {
      return activeProfile.settlements.filter(
        (settlement) => settlement.totalPaid - (settlement.withdrawnAmount ?? 0) <= 0,
      )
    }
    return activeProfile.settlements.filter(
      (settlement) => settlement.totalPaid - (settlement.withdrawnAmount ?? 0) > 0,
    )
  }, [activeProfile.settlements, historyPaymentFilter])

  const settlementInterestById = useMemo(() => {
    return new Map(
      activeProfile.settlements.map((settlement) =>
        [settlement.id, settlementBankSummary(activeProfile, settlement.id)]),
    )
  }, [activeProfile])

  const hasConfiguredLevels = sortedLevels.length > 0
  const nextLevelProgressPct = !hasConfiguredLevels
    ? 0
    : nextLevel
      ? Math.min(100, Math.round((pointsAvailableNow / nextLevel.minPoints) * 100))
      : 100
  const maxExtraAmount = sortedLevels.reduce((sum, level) => sum + level.extraAmount, 0)
  const maxPossiblePayout = (activeProfile.fixedAllowance ?? 0) +
    (activeProfile.mandatoryTasks.length > 0 ? activeProfile.baseAllowance : 0) + maxExtraAmount
  const payoutProgressPct =
    maxPossiblePayout > 0 ? Math.round((projectedTotalAllowance / maxPossiblePayout) * 100) : 0

  const earnedStars = Math.min(5, Math.max(0, Math.floor(nextLevelProgressPct / 20)))
  const mandatoryTaskCompletedCount = activeProfile.mandatoryTasks.filter(
    (task) => (mandatoryCountMap[task.id] ?? 0) >= task.requiredCount,
  ).length
  const childBadges = [
    {
      label: 'Oppgavehelt',
      unlocked: activeProfile.mandatoryTasks.length > 0 &&
        mandatoryTaskCompletedCount === activeProfile.mandatoryTasks.length,
      kind: 'mandatory',
    },
    {
      label: 'Nivåmester',
      unlocked: reachedLevelNow !== null,
      kind: 'level',
    },
  ]
  const hasCelebration = reachedLevelNow !== null && mandatoryMet
  const adminTempPasswordStrength = getParentPasswordStrengthLabel(newParentAccountPassword)
  const firstLoginPasswordStrength = getParentPasswordStrengthLabel(firstLoginNewPassword)
  const isParentMode = role === 'parent' && isParentUnlocked
  const isParentPasswordResetRequired = Boolean(mustChangeParentPasswordAccountId)
  const isParentLockedToPasswordReset = isParentMode && isParentPasswordResetRequired
  const canManage = isParentMode && !isParentPasswordResetRequired
  const isChildMode = isLoggedIn && (!isParentMode || parentPreviewChildView)
  const mustRenameDefaultChildBeforeTaskSetup = hasProfiles && isDefaultChildName(activeProfile.childName)
  const canRegisterTasks = isLoggedIn && role === 'child'
  const canManageTaskSetup = canManage && !isChildMode && !mustRenameDefaultChildBeforeTaskSetup

  useEffect(() => {
    if (!isLoggedIn || (cloud && cloud.role !== 'parent') || savingRef.current) {
      return
    }

    let hasChanges = false
    const nextProfiles = state.profiles.map((profile) => {
      const settledProfile = accrueBankInterest(settlePastPeriods(
        profile,
        state.parentSettings.interestPeriod,
        state.parentSettings.penaltyEnabled,
        state.parentSettings.bonusRequiresMandatory,
        now,
      ), state.parentSettings, now)

      if (settledProfile !== profile) {
        hasChanges = true
      }

      return settledProfile
    })

    if (hasChanges) {
      // Lazy settlement synchronizes the persisted ledger after a clock or remote-state change.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void persist({ ...state, profiles: nextProfiles })
    }
  }, [
    isLoggedIn,
    state,
    cloud,
    now,
    persist,
  ])

  function saveParentSession() {
    localStorage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({
        expiresAt: Date.now() + AUTH_IDLE_TIMEOUT_MS,
      }),
    )
  }

  function clearParentSession() {
    localStorage.removeItem(AUTH_SESSION_KEY)
  }

  useEffect(() => {
    // Drops ids of profiles that were removed elsewhere; not derivable in render since it must persist user selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTaskTargetChildIds((previous) =>
      previous.filter((id) => state.profiles.some((profile) => profile.id === id)),
    )
  }, [activeProfile.id, state.profiles])

  useEffect(() => {
    if (!canManage || activeTab !== 'tasks') {
      return
    }
    if (taskTargetChildIds.length === 0 && state.profiles.length > 0) {
      // Seeds default selection on first visit to the tasks tab.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTaskTargetChildIds(state.profiles.map((profile) => profile.id))
    }
  }, [activeTab, canManage, state.profiles, taskTargetChildIds.length])

  useEffect(() => {
    if (cloud) return
    try {
      const raw = localStorage.getItem(AUTH_SESSION_KEY)
      if (!raw) {
        return
      }
      const parsed = JSON.parse(raw) as { expiresAt?: number }
      if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
        // Restores an existing parent session from localStorage on mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRole('parent')
        setIsLoggedIn(true)
        setIsParentUnlocked(true)
        setActiveTab('overview')
      } else {
        clearParentSession()
      }
    } catch {
      clearParentSession()
    }
  }, [cloud])

  useEffect(() => {
    const previousLevel = previousLevelByChildRef.current[activeProfile.id] ?? null
    const currentLevel = reachedLevelNow?.name ?? null

    if (previousLevel !== null && currentLevel !== null && previousLevel !== currentLevel) {
      setLevelUpToast(`${activeProfile.childName} nådde ${currentLevel}!`)
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
      toastTimerRef.current = window.setTimeout(() => {
        setLevelUpToast(null)
      }, 2800)
    }

    previousLevelByChildRef.current[activeProfile.id] = currentLevel
  }, [activeProfile.childName, activeProfile.id, reachedLevelNow?.name])

  useEffect(() => {
    if (!isParentMode || cloud) {
      if (parentIdleTimerRef.current) {
        window.clearTimeout(parentIdleTimerRef.current)
      }
      return
    }

    const refreshSession = () => {
      if (parentIdleTimerRef.current) {
        window.clearTimeout(parentIdleTimerRef.current)
      }
      parentIdleTimerRef.current = window.setTimeout(() => {
        setIsParentUnlocked(false)
        setIsLoggedIn(false)
        clearParentSession()
        window.alert('Foreldretilgang ble logget ut etter inaktivitet.')
      }, AUTH_IDLE_TIMEOUT_MS)

      const raw = localStorage.getItem(AUTH_SESSION_KEY)
      if (raw) {
        saveParentSession()
      }
    }

    refreshSession()
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    events.forEach((eventName) => window.addEventListener(eventName, refreshSession, { passive: true }))

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, refreshSession))
      if (parentIdleTimerRef.current) {
        window.clearTimeout(parentIdleTimerRef.current)
      }
    }
  }, [isParentMode, cloud])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
      if (parentIdleTimerRef.current) {
        window.clearTimeout(parentIdleTimerRef.current)
      }
    }
  }, [])

  function updateActiveProfile(updater: (profile: ChildProfile) => ChildProfile) {
    const nextProfiles = state.profiles.map((profile) =>
      profile.id === activeProfile.id ? updater(profile) : profile,
    )
    return persist({ ...state, profiles: nextProfiles })
  }

  function updateProfileById(profileId: string, updater: (profile: ChildProfile) => ChildProfile) {
    const nextProfiles = state.profiles.map((profile) =>
      profile.id === profileId ? updater(profile) : profile,
    )
    const nextActiveId =
      state.activeChildId === profileId ? profileId : state.activeChildId
    persist({ ...state, profiles: nextProfiles, activeChildId: nextActiveId })
  }

  function updateSelectedChildrenForTasks(childId: string, isSelected: boolean) {
    setTaskTargetChildIds((previous) => {
      if (isSelected) {
        if (previous.includes(childId)) {
          return previous
        }
        return [...previous, childId]
      }
      return previous.filter((id) => id !== childId)
    })
  }

  function updateTargetProfiles(updater: (profile: ChildProfile) => ChildProfile): boolean {
    if (taskTargetChildIds.length === 0) {
      window.alert('Velg minst ett barn for å legge til oppgaven.')
      return false
    }
    const targetIds = taskTargetChildIds
    const targetSet = new Set(targetIds)
    persist({
      ...state,
      profiles: state.profiles.map((profile) => (targetSet.has(profile.id) ? updater(profile) : profile)),
    })
    return true
  }

  function selectAllTargetChildren() {
    setTaskTargetChildIds(state.profiles.map((profile) => profile.id))
  }

  function clearTargetChildren() {
    setTaskTargetChildIds([])
  }

  function updateHistoryFilterForActiveChild(historyFilter: HistoryFilter) {
    updateActiveProfile((profile) => ({
      ...profile,
      historyFilter,
    }))
  }

  function switchRole(nextRole: UserRole) {
    setRole(nextRole)
    if (nextRole !== 'parent') {
      setParentPreviewChildView(false)
      setMustChangeParentPasswordAccountId(null)
    }
    setIsParentAdminSession(false)
    setParentUsernameInput('')
    setPasswordInput('')
    setShowPasswordInput(false)
    setFirstLoginNewPassword('')
    setShowFirstLoginNewPassword(false)
    setChildPinInput('')
    setShowChildPinInput(false)
  }

  async function loginAsChild(event?: FormEvent) {
    event?.preventDefault()

    const enteredPin = childPinInput.trim()
    if (!isValidChildCode(enteredPin)) {
      window.alert('Barnekode må være minst 8 tegn og inneholde både bokstaver og tall.')
      return
    }

    if (CHILD_AUTH_ENDPOINT) {
      try {
        const childId = await authenticateChildCodeWithBackend(enteredPin)
        const matchedProfile = state.profiles.find((profile) => profile.id === childId)
        if (!matchedProfile) {
          window.alert('Koden ble godkjent, men barnet finnes ikke lokalt i appen.')
          return
        }

        if (state.activeChildId !== matchedProfile.id) {
          persist({
            ...state,
            activeChildId: matchedProfile.id,
          })
        }

        setRole('child')
        setParentPreviewChildView(false)
        setIsParentUnlocked(false)
        setIsLoggedIn(true)
        setActiveTab('overview')
        setPasswordInput('')
        setShowPasswordInput(false)
        setChildPinInput('')
        setShowChildPinInput(false)
        return
      } catch {
        window.alert('Feil barnekode.')
        return
      }
    }

    const candidates = state.profiles.filter(
      (profile) => Boolean(profile.childPinHash && profile.childPinSalt),
    )

    if (candidates.length === 0) {
      window.alert('Forelder må opprette minst én barnekode først.')
      return
    }

    let matchedProfile: ChildProfile | null = null
    for (const profile of candidates) {
      const hash = await derivePasswordHash(
        enteredPin,
        profile.childPinSalt as string,
        profile.childPinIterations,
      )
      if (hash === profile.childPinHash) {
        matchedProfile = profile
        break
      }
    }

    if (!matchedProfile) {
      window.alert('Feil barnekode')
      return
    }

    if (state.activeChildId !== matchedProfile.id) {
      persist({
        ...state,
        activeChildId: matchedProfile.id,
      })
    }

    setRole('child')
    setParentPreviewChildView(false)
    setIsParentUnlocked(false)
    setIsLoggedIn(true)
    setActiveTab('overview')
    setPasswordInput('')
    setShowPasswordInput(false)
    setChildPinInput('')
    setShowChildPinInput(false)
  }

  function logoutApp() {
    if (cloud) {
      void cloud.logout().catch(error => window.alert(error instanceof Error ? error.message : 'Kunne ikke logge ut.'))
      return
    }
    setIsLoggedIn(false)
    setRole('child')
    setParentPreviewChildView(false)
    setIsParentUnlocked(false)
    setIsParentAdminSession(false)
    setMustChangeParentPasswordAccountId(null)
    setParentUsernameInput('')
    setPasswordInput('')
    setShowPasswordInput(false)
    setFirstLoginNewPassword('')
    setShowFirstLoginNewPassword(false)
    setChildPinInput('')
    setShowChildPinInput(false)
    setActiveTab('overview')
    clearParentSession()
  }

  async function unlockParentMode(event: FormEvent) {
    event.preventDefault()

    if (!parentUsernameInput.trim() || !passwordInput.trim()) {
      return
    }

    if (authLockedUntil && authLockedUntil > Date.now()) {
      const secondsLeft = Math.ceil((authLockedUntil - Date.now()) / 1000)
      window.alert(`For mange feilforsøk. Prøv igjen om ${secondsLeft} sekunder.`)
      return
    }

    const enteredUsername = parentUsernameInput.trim()
    const enteredPassword = passwordInput.trim()

    const isAdminLogin =
      ADMIN_LOGIN_ENABLED &&
      enteredUsername.toLowerCase() === ADMIN_USERNAME.toLowerCase() &&
      enteredPassword === ADMIN_PASSWORD

    if (isAdminLogin) {
      setRole('parent')
      setParentPreviewChildView(false)
      setIsParentUnlocked(true)
      setIsParentAdminSession(true)
      setIsLoggedIn(true)
      setActiveTab('overview')
      setParentUsernameInput('')
      setPasswordInput('')
      setShowPasswordInput(false)
      setAuthAttempts(0)
      setAuthLockedUntil(null)
      if (rememberParentSession) {
        saveParentSession()
      } else {
        clearParentSession()
      }
      return
    }

    const matchedAccount = state.parentSettings.parentAccounts.find(
      (account) => account.username.toLowerCase() === enteredUsername.toLowerCase(),
    )

    if (matchedAccount) {
      const hash = await derivePasswordHash(
        enteredPassword,
        matchedAccount.passwordSalt,
        matchedAccount.passwordIterations,
      )
      if (hash === matchedAccount.passwordHash) {
        setRole('parent')
        setParentPreviewChildView(false)
        setIsParentUnlocked(true)
        setIsParentAdminSession(false)
        setIsLoggedIn(true)
        setActiveTab('overview')
        setParentUsernameInput('')
        setPasswordInput('')
        setShowPasswordInput(false)
        setAuthAttempts(0)
        setAuthLockedUntil(null)
        if (rememberParentSession) {
          saveParentSession()
        } else {
          clearParentSession()
        }

        if (matchedAccount.mustChangePassword) {
          setMustChangeParentPasswordAccountId(matchedAccount.id)
          setFirstLoginNewPassword('')
          setShowFirstLoginNewPassword(false)
          setActiveTab('settings')
        }
        return
      }
    }

    const nextAttempts = authAttempts + 1
    setAuthAttempts(nextAttempts)
    if (nextAttempts >= AUTH_LOCK_MAX_ATTEMPTS) {
      setAuthAttempts(0)
      setAuthLockedUntil(Date.now() + AUTH_LOCK_MS)
      window.alert('For mange feilforsøk. Innlogging er midlertidig låst.')
      return
    }
    window.alert('Feil brukernavn eller passord')
  }

  async function createInitialParentAccount(event: FormEvent) {
    event.preventDefault()
    if (ADMIN_LOGIN_ENABLED || state.parentSettings.parentAccounts.length > 0) {
      return
    }

    const username = parentUsernameInput.trim()
    const password = passwordInput.trim()
    if (username.length < 3) {
      window.alert('Brukernavn må være minst 3 tegn.')
      return
    }
    if (!isValidParentPassword(password)) {
      window.alert('Passord må være minst 8 tegn og inneholde minst ett tall og ett spesialtegn.')
      return
    }

    const salt = createRandomHex(16)
    const hash = await derivePasswordHash(password, salt, AUTH_ITERATIONS)
    const account = {
      id: crypto.randomUUID(),
      username,
      passwordHash: hash,
      passwordSalt: salt,
      passwordIterations: AUTH_ITERATIONS,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
    }
    persist({
      ...state,
      parentSettings: {
        ...state.parentSettings,
        parentAccounts: [...state.parentSettings.parentAccounts, account],
      },
    })

    setRole('parent')
    setIsParentUnlocked(true)
    setIsParentAdminSession(false)
    setIsLoggedIn(true)
    setActiveTab('overview')
    setParentUsernameInput('')
    setPasswordInput('')
    setShowPasswordInput(false)
    if (rememberParentSession) {
      saveParentSession()
    } else {
      clearParentSession()
    }
  }

  async function completeFirstParentPasswordChange(event: FormEvent) {
    event.preventDefault()
    if (!mustChangeParentPasswordAccountId) {
      return
    }

    const sanitized = firstLoginNewPassword.trim()
    if (!isValidParentPassword(sanitized)) {
      window.alert('Passord må være minst 8 tegn og inneholde minst ett tall og ett spesialtegn.')
      return
    }

    const salt = createRandomHex(16)
    const hash = await derivePasswordHash(sanitized, salt, AUTH_ITERATIONS)

    persist({
      ...state,
      parentSettings: {
        ...state.parentSettings,
        parentAccounts: state.parentSettings.parentAccounts.map((account) =>
          account.id === mustChangeParentPasswordAccountId
            ? {
                ...account,
                passwordHash: hash,
                passwordSalt: salt,
                passwordIterations: AUTH_ITERATIONS,
                mustChangePassword: false,
              }
            : account,
        ),
      },
    })

    setMustChangeParentPasswordAccountId(null)
    setFirstLoginNewPassword('')
    setShowFirstLoginNewPassword(false)
    window.alert('Passord oppdatert. Foreldrekontoen er klar til bruk.')
  }

  async function addChildProfile(event: FormEvent) {
    event.preventDefault()
    if (!newChildName.trim()) {
      window.alert('Skriv inn navn på barnet.')
      return
    }
    if (cloud) {
      const newProfile = createDefaultProfile(newChildName.trim())
      if (await persist({ ...state, profiles: [...state.profiles, newProfile], activeChildId: newProfile.id })) {
        setNewChildName('')
        window.alert('Barnet er opprettet. Trykk «Generer kode» for å opprette barnets innlogging.')
      }
      return
    }

    const generatedCode = await generateUniqueChildCode()
    if (!generatedCode) {
      window.alert('Fant ikke en ledig kode akkurat nå. Prøv igjen.')
      return
    }

    const salt = createRandomHex(16)
    const hash = await derivePasswordHash(generatedCode, salt, AUTH_ITERATIONS)
    const newProfile = createDefaultProfile(newChildName.trim())
    newProfile.childPinHash = hash
    newProfile.childPinSalt = salt
    newProfile.childPinIterations = AUTH_ITERATIONS
    newProfile.childPinPlain = generatedCode

    const next = {
      ...state,
      profiles: [...state.profiles, newProfile],
      activeChildId: newProfile.id,
    }
    persist(next)
    setNewChildName('')
    setVisibleChildCodeById((previous) => ({
      ...previous,
      [newProfile.id]: true,
    }))
    window.alert(`Barnet ${newProfile.childName} ble opprettet med automatisk kode. Trykk "Vis kode" i modulen "Barnets profil og kode".`)
  }

  async function removeChildProfile(profileId: string) {
    if (state.profiles.length <= 1) {
      window.alert('Du må ha minst ett barn i appen.')
      return
    }
    const profile = state.profiles.find((item) => item.id === profileId)
    if (!profile) {
      return
    }
    const confirmation = window.prompt(
      `Slette ${profile.childName}? Barnets profil, oppgaver, registreringer, historikk og bankdata blir fjernet. Dette kan ikke angres.\n\nSkriv slette for å bekrefte.`,
    )
    if (confirmation === null) {
      return
    }
    if (confirmation.trim().toLowerCase() !== 'slette') {
      window.alert('Barnet ble ikke slettet. Du må skrive slette for å bekrefte.')
      return
    }
    if (cloud) {
      try {
        await cloud.removeChildLogin(profileId)
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Kunne ikke fjerne barnets innlogging.')
        return
      }
    }
    const remaining = state.profiles.filter((p) => p.id !== profileId)
    const nextActiveId = remaining.some((profile) => profile.id === state.activeChildId)
      ? state.activeChildId
      : remaining[0].id
    persist({
      ...state,
      profiles: remaining,
      activeChildId: nextActiveId,
    })
    setVisibleChildCodeById((previous) => {
      const next = { ...previous }
      delete next[profileId]
      return next
    })
  }

  async function createParentAccessAccount(event: FormEvent) {
    event.preventDefault()
    if (!isParentAdminSession) {
      return
    }

    const username = newParentAccountUsername.trim()
    const tempPassword = newParentAccountPassword.trim()

    if (username.length < 3) {
      window.alert('Brukernavn må være minst 3 tegn.')
      return
    }

    if (ADMIN_LOGIN_ENABLED && username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
      window.alert('Dette brukernavnet er reservert for admin.')
      return
    }

    if (!isValidParentPassword(tempPassword)) {
      window.alert('Midlertidig passord må være minst 8 tegn og inneholde minst ett tall og ett spesialtegn.')
      return
    }

    const usernameTaken = state.parentSettings.parentAccounts.some(
      (account) => account.username.toLowerCase() === username.toLowerCase(),
    )
    if (usernameTaken) {
      window.alert('Brukernavnet er allerede i bruk. Velg et annet.')
      return
    }

    const salt = createRandomHex(16)
    const hash = await derivePasswordHash(tempPassword, salt, AUTH_ITERATIONS)

    persist({
      ...state,
      parentSettings: {
        ...state.parentSettings,
        parentAccounts: [
          ...state.parentSettings.parentAccounts,
          {
            id: crypto.randomUUID(),
            username,
            passwordHash: hash,
            passwordSalt: salt,
            passwordIterations: AUTH_ITERATIONS,
            mustChangePassword: newParentAccountMustChangePassword,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    })

    setNewParentAccountUsername('')
    setNewParentAccountPassword('')
    setShowNewParentAccountPassword(false)
    setNewParentAccountMustChangePassword(true)
    if (newParentAccountMustChangePassword) {
      window.alert(`Foreldrekonto ${username} er opprettet. Brukeren må bytte passord ved første innlogging.`)
      return
    }
    window.alert(`Foreldrekonto ${username} er opprettet med valgt brukernavn og passord.`)
  }

  async function findChildCodeConflict(code: string, excludedProfileId?: string): Promise<string | null> {
    for (const profile of state.profiles) {
      if (excludedProfileId && profile.id === excludedProfileId) {
        continue
      }
      if (!profile.childPinHash || !profile.childPinSalt) {
        continue
      }
      const existingHash = await derivePasswordHash(
        code,
        profile.childPinSalt,
        profile.childPinIterations,
      )
      if (existingHash === profile.childPinHash) {
        return profile.childName
      }
    }
    return null
  }

  async function generateCodeForProfile(profileId: string) {
    const profile = state.profiles.find((item) => item.id === profileId)
    if (!profile) {
      return
    }
    if (cloud) {
      try {
        const code = await cloud.createChildLogin(profileId)
        setCloudCodes(previous => ({ ...previous, [profileId]: code }))
        setVisibleChildCodeById(previous => ({ ...previous, [profileId]: true }))
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Kunne ikke opprette barnekode.')
      }
      return
    }
    if (profile.childPinHash && profile.childPinSalt) {
      window.alert('Barnekode finnes allerede. Fjern kode først hvis du vil lage en ny.')
      return
    }
    const candidate = await generateUniqueChildCode(profileId)
    if (!candidate) {
      window.alert('Fant ikke en ledig kode akkurat nå. Prøv igjen.')
      return
    }

    const salt = createRandomHex(16)
    const hash = await derivePasswordHash(candidate, salt, AUTH_ITERATIONS)

    updateProfileById(profileId, (item) => ({
      ...item,
      childPinHash: hash,
      childPinSalt: salt,
      childPinIterations: AUTH_ITERATIONS,
      childPinPlain: candidate,
    }))

    setVisibleChildCodeById((previous) => ({
      ...previous,
      [profileId]: true,
    }))
  }

  async function replaceChildPinForProfile(profileId: string) {
    if (cloud) {
      if (window.confirm('Opprette ny barnekode? Den gamle koden slutter å virke.')) {
        await generateCodeForProfile(profileId)
      }
      return
    }
    const profile = state.profiles.find((item) => item.id === profileId)
    if (!profile) {
      return
    }
    if (
      !window.confirm(
        `Lage ny kode for ${profile.childName}? Gammel kode slutter å virke med en gang.`,
      )
    ) {
      return
    }

    const candidate = await generateUniqueChildCode(profileId)
    if (!candidate) {
      window.alert('Fant ikke en ledig kode akkurat nå. Prøv igjen.')
      return
    }

    const salt = createRandomHex(16)
    const hash = await derivePasswordHash(candidate, salt, AUTH_ITERATIONS)

    updateProfileById(profileId, (item) => ({
      ...item,
      childPinHash: hash,
      childPinSalt: salt,
      childPinIterations: AUTH_ITERATIONS,
      childPinPlain: candidate,
    }))

    setVisibleChildCodeById((previous) => ({
      ...previous,
      [profileId]: true,
    }))
    window.alert(`Ny kode er laget for ${profile.childName}.`)
  }

  async function generateUniqueChildCode(excludedProfileId?: string): Promise<string | null> {
    const maxAttempts = 50
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = createChildCodeCandidate(10)
      const conflictName = await findChildCodeConflict(candidate, excludedProfileId)
      if (!conflictName) {
        return candidate
      }
    }
    return null
  }

  async function removeChildPinForProfile(profileId: string) {
    if (!canManage) {
      return
    }
    if (!window.confirm('Fjerne barnekoden? Barnet kan ikke logge inn før en ny kode er opprettet.')) {
      return
    }
    if (cloud) {
      try {
        await cloud.removeChildLogin(profileId)
        setCloudCodes(previous => {
          const next = { ...previous }
          delete next[profileId]
          return next
        })
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Kunne ikke fjerne barnekoden.')
      }
      return
    }

    updateProfileById(profileId, (profile) => ({
      ...profile,
      childPinHash: null,
      childPinSalt: null,
      childPinPlain: null,
    }))
    setVisibleChildCodeById((previous) => ({
      ...previous,
      [profileId]: false,
    }))
  }

  function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  function exportBackupJson() {
    downloadTextFile(
      `ukelonn-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(state, null, 2),
      'application/json;charset=utf-8',
    )
  }

  function exportSettlementsCsv() {
    const header = 'Barn,Periode,Utbetaling,Status,UtbetaltDato\n'
    const rows = state.profiles.flatMap((profile) =>
      profile.settlements.map((settlement) => {
        const status = settlement.paidAt ? 'Utbetalt' : 'Ikke utbetalt'
        const paidDate = settlement.paidAt
          ? new Date(settlement.paidAt).toLocaleDateString('nb-NO')
          : ''
        return [
          profile.childName,
          settlement.periodLabel,
          settlement.totalPaid,
          status,
          paidDate,
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(',')
      }),
    )
    downloadTextFile(
      `ukelonn-utbetalinger-${new Date().toISOString().slice(0, 10)}.csv`,
      `${header}${rows.join('\n')}`,
      'text/csv;charset=utf-8',
    )
  }

  function exportTransactionsCsv() {
    const rows = state.profiles.flatMap(profile => (profile.transactions ?? []).map(transaction =>
      [profile.childName, transaction.timestamp, transaction.type, transaction.amount, transaction.pointsDelta ?? '', transaction.description]
        .map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')))
    downloadTextFile(`ukelonn-transaksjoner-${new Date().toISOString().slice(0, 10)}.csv`,
      `Barn,Dato,Type,Belop,Poeng,Beskrivelse\n${rows.join('\n')}`, 'text/csv;charset=utf-8')
  }

  async function importBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const next = parseBackupState(JSON.parse(text))
      if (!window.confirm('Gjenopprette denne sikkerhetskopien? Den erstatter familiens nåværende data.')) return
      if (await persist(next)) window.alert('Backup importert.')
    } catch {
      window.alert('Kunne ikke importere filen. Sjekk at den er gyldig JSON-backup.')
    } finally {
      event.target.value = ''
    }
  }

  async function addEntry(taskType: 'mandatory' | 'bonus' | 'penalty', taskId: string) {
    if (!canRegisterTasks) {
      return
    }
    if (cloud?.role === 'child') {
      if (taskType === 'penalty') return
      if (savingRef.current) return
      savingRef.current = true
      setCloudBusy(true)
      try {
        setState(await cloud.registerEntry(taskType, taskId))
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Kunne ikke registrere oppgaven.')
      } finally {
        savingRef.current = false
        setCloudBusy(false)
      }
      return
    }
    const task = taskType === 'mandatory' ? activeProfile.mandatoryTasks.find(item => item.id === taskId)
      : taskType === 'bonus' ? activeProfile.bonusTasks.find(item => item.id === taskId)
        : activeProfile.penaltyTasks.find(item => item.id === taskId)
    if (!task) {
      window.alert('Oppgaven finnes ikke lenger.')
      return
    }
    if (taskType === 'mandatory' && 'requiredCount' in task && (mandatoryCountMap[taskId] ?? 0) >= task.requiredCount) {
      window.alert('Alle nødvendige registreringer for denne oppgaven er allerede fullført.')
      return
    }
    if (taskType === 'penalty' && !state.parentSettings.penaltyEnabled) {
      if (canManage) {
        window.alert('Poengtrekk er deaktivert. Aktiver trekk i foreldreinnstillinger først.')
      }
      return
    }
    if (taskType === 'bonus') {
      const task = activeProfile.bonusTasks.find((item) => item.id === taskId)
      if (task?.upForGrabs) {
        const key = getBonusTaskKey(task.name, task.points)
        if ((sharedBonusCountByTaskKey.get(key) ?? 0) > 0) {
          window.alert('Denne ekstraoppgaven er allerede tatt av noen denne perioden.')
          return
        }
      } else if (task) {
        if ((bonusCountMap[task.id] ?? 0) > 0) {
          window.alert('Du har allerede gjort denne oppgaven denne perioden.')
          return
        }
      }
    }
    updateActiveProfile((profile) => ({
      ...profile,
      entries: [
        ...profile.entries,
        {
          id: crypto.randomUUID(),
          taskType,
          taskId,
          timestamp: new Date().toISOString(),
          periodType: profile.periodType,
          taskName: task.name,
          points: 'points' in task ? task.points : 0,
        },
      ],
    }))
  }

  function registerPenalty(taskId: string, childId: string) {
    if (!canManage || !state.parentSettings.penaltyEnabled) {
      return
    }
    updateProfileById(childId, (profile) => ({
      ...profile,
      entries: [
        ...profile.entries,
        {
          id: crypto.randomUUID(),
          taskType: 'penalty',
          taskId,
          timestamp: new Date().toISOString(),
          periodType: profile.periodType,
          taskName: profile.penaltyTasks.find(task => task.id === taskId)?.name,
          points: profile.penaltyTasks.find(task => task.id === taskId)?.points,
        },
      ],
    }))
  }

  async function removeEntry(entryId: string) {
    const entry = activeProfile.entries.find(item => item.id === entryId)
    if (entry?.taskType === 'penalty' && (!canManage || isChildMode)) {
      window.alert('Bare foreldre i foreldervisning kan angre poengtrekk.')
      return
    }
    if (!canManage && !canRegisterTasks) {
      return
    }
    if (cloud?.role === 'child') {
      if (savingRef.current) return
      savingRef.current = true
      setCloudBusy(true)
      try {
        setState(await cloud.removeEntry(entryId))
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Kunne ikke angre registreringen.')
      } finally {
        savingRef.current = false
        setCloudBusy(false)
      }
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      entries: profile.entries.filter((entry) => entry.id !== entryId),
    }))
  }

  function renderRegistrationEntry(entry: ChildProfile['entries'][number], allowRemove: boolean) {
    const taskName =
      entry.taskType === 'mandatory'
        ? activeProfile.mandatoryTasks.find((task) => task.id === entry.taskId)?.name
        : entry.taskType === 'bonus'
          ? activeProfile.bonusTasks.find((task) => task.id === entry.taskId)?.name
          : activeProfile.penaltyTasks.find((task) => task.id === entry.taskId)?.name

    return (
      <li key={entry.id}>
        <div>
          <strong>{entry.taskName ?? taskName ?? 'Ukjent oppgave'}</strong>
          <p className="mini">
            {entry.taskType === 'mandatory'
              ? 'Obligatorisk'
              : entry.taskType === 'bonus'
                ? 'Ekstra'
                : 'Trekk'}{' '}
            -{' '}
            {new Date(entry.timestamp).toLocaleString('nb-NO')}
          </p>
        </div>
        {allowRemove && ((!isChildMode && canManage) || canRegisterTasks && entry.taskType !== 'penalty') && (
          <button
            type="button"
            className="danger"
            onClick={() => removeEntry(entry.id)}
          >
            Fjern
          </button>
        )}
      </li>
    )
  }

  function addMandatoryTask(event: FormEvent) {
    event.preventDefault()
    const requiredCount = Number(newMandatoryCount)
    if (!newMandatoryCount.trim() || !Number.isSafeInteger(requiredCount) || requiredCount < 1) {
      window.alert('Antall ganger må være et heltall på minst 1.')
      return
    }
    if (mustRenameDefaultChildBeforeTaskSetup) {
      window.alert(`Endre barnenavnet fra "${DEFAULT_CHILD_NAME}" før du lager oppgaver.`)
      return
    }
    if (!canManage || !newMandatoryName.trim()) {
      return
    }
    const success = updateTargetProfiles((profile) => ({
      ...profile,
      mandatoryTasks: [
        ...profile.mandatoryTasks,
        {
          id: crypto.randomUUID(),
          name: newMandatoryName.trim(),
          requiredCount,
        },
      ],
    }))
    if (!success) {
      return
    }
    setNewMandatoryName('')
    setNewMandatoryCount('1')
  }

  function addBonusTask(event: FormEvent) {
    event.preventDefault()
    if (mustRenameDefaultChildBeforeTaskSetup) {
      window.alert(`Endre barnenavnet fra "${DEFAULT_CHILD_NAME}" før du lager oppgaver.`)
      return
    }
    if (!canManage || !newBonusName.trim()) {
      return
    }
    const success = updateTargetProfiles((profile) => ({
      ...profile,
      bonusTasks: [
        ...profile.bonusTasks,
        {
          id: crypto.randomUUID(),
          name: newBonusName.trim(),
          points: Math.max(1, Math.floor(newBonusPoints)),
          upForGrabs: newBonusUpForGrabs,
          repeatEachPeriod: newBonusRepeatEachPeriod,
          createdPeriodKey: getPeriodKey(now, profile.periodType),
        },
      ],
    }))
    if (!success) {
      return
    }
    setNewBonusName('')
    setNewBonusPoints(1)
    setNewBonusUpForGrabs(false)
    setNewBonusRepeatEachPeriod(false)
  }

  function addPenaltyTask(event: FormEvent) {
    event.preventDefault()
    if (mustRenameDefaultChildBeforeTaskSetup) {
      window.alert(`Endre barnenavnet fra "${DEFAULT_CHILD_NAME}" før du lager oppgaver.`)
      return
    }
    if (!canManage || !newPenaltyName.trim()) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      penaltyTasks: [
        ...profile.penaltyTasks,
        {
          id: crypto.randomUUID(),
          name: newPenaltyName.trim(),
          points: Math.max(1, Math.floor(newPenaltyPoints)),
        },
      ],
    }))
    setNewPenaltyName('')
    setNewPenaltyPoints(1)
  }

  async function addRewardLevel(event: FormEvent) {
    event.preventDefault()
    if (mustRenameDefaultChildBeforeTaskSetup) {
      window.alert(`Endre barnenavnet fra "${DEFAULT_CHILD_NAME}" før du lager oppgaver.`)
      return
    }
    if (!canManage) {
      return
    }
    if (!newLevelName.trim()) {
      window.alert('Skriv et navn på bonusnivået.')
      return
    }
    const saved = await updateActiveProfile((profile) => ({
      ...profile,
      rewardLevels: [
        ...profile.rewardLevels,
        {
          id: crypto.randomUUID(),
          name: newLevelName.trim(),
          minPoints: Math.max(1, Math.floor(newLevelPoints)),
          extraAmount: Math.max(0, Math.floor(newLevelAmount)),
        },
      ],
    }))
    if (!saved) {
      return
    }
    setNewLevelName('')
    setNewLevelPoints(5)
    setNewLevelAmount(10)
  }

  function updateLevel(levelId: string, updates: Partial<RewardLevel>) {
    if (!canManage) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      rewardLevels: profile.rewardLevels.map((level) =>
        level.id === levelId ? { ...level, ...updates } : level,
      ),
    }))
  }

  function updatePenaltyTask(taskId: string, updates: Partial<PenaltyTask>) {
    if (!canManage) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      penaltyTasks: profile.penaltyTasks.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task,
      ),
    }))
  }

  function removeMandatoryTask(taskId: string) {
    if (!canManage) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      mandatoryTasks: profile.mandatoryTasks.filter((task) => task.id !== taskId),
    }))
  }

  function removeBonusTask(taskId: string) {
    if (!canManage) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      bonusTasks: profile.bonusTasks.filter((task) => task.id !== taskId),
    }))
  }

  function removeLevel(levelId: string) {
    if (!canManage) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      rewardLevels: profile.rewardLevels.filter((level) => level.id !== levelId),
    }))
  }

  function removePenaltyTask(taskId: string) {
    if (!canManage) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      penaltyTasks: profile.penaltyTasks.filter((task) => task.id !== taskId),
    }))
  }

  function resetAllData() {
    if (!canManage) {
      return
    }
    if (!window.confirm('Slette alle registreringer, oppgaver og nivåer for aktivt barn?')) {
      return
    }
    updateActiveProfile((profile) => ({
      ...createDefaultProfile(profile.childName),
      id: profile.id,
      childName: profile.childName,
    }))
  }

  function resetEntireAppData() {
    if (!canManage || !isParentAdminSession) {
      return
    }
    if (!window.confirm('Nullstille hele appen? Dette sletter alle barn, oppgaver, historikk og foreldrekontoer.')) {
      return
    }
    const typedConfirmation = window.prompt('Skriv NULLSTILL for å bekrefte full nullstilling av appdata.')
    if ((typedConfirmation ?? '').trim().toUpperCase() !== 'NULLSTILL') {
      window.alert('Nullstilling avbrutt. Bekreftelsestekst stemte ikke.')
      return
    }

    localStorage.removeItem(STORAGE_KEY)
    clearParentSession()

    setState(initialState)
    setIsLoggedIn(false)
    setRole('child')
    setParentPreviewChildView(false)
    setIsParentUnlocked(false)
    setIsParentAdminSession(false)
    setMustChangeParentPasswordAccountId(null)
    setParentUsernameInput('')
    setPasswordInput('')
    setShowPasswordInput(false)
    setFirstLoginNewPassword('')
    setShowFirstLoginNewPassword(false)
    setActiveTab('overview')
  }

  function registerDepositToBank(event: FormEvent) {
    event.preventDefault()
    if (!canManage || !bankSelectedProfile) {
      return
    }

    if (bankWithdrawalMode === 'points') {
      const points = Number(depositAmountInput)
      if (!depositAmountInput.trim() || !Number.isSafeInteger(points) || points <= 0 ||
        !Number.isSafeInteger(bankSelectedProfile.carryPoints + points)) {
        window.alert('Skriv inn et gyldig heltall større enn 0 poeng.')
        return
      }
      updateProfileById(bankSelectedProfile.id, (profile) => ({
        ...profile,
        carryPoints: profile.carryPoints + points,
        transactions: [...(profile.transactions ?? []), {
          id: crypto.randomUUID(),
          type: 'points',
          amount: 0,
          timestamp: new Date().toISOString(),
          description: `Manuelt tillegg: ${points} overførte poeng`,
          pointsDelta: points,
        }],
      }))
      setDepositAmountInput('')
      return
    }

    const requestedAmount = roundMoney(Math.max(0, safeNumber(depositAmountInput, 0)))
    if (requestedAmount <= 0) {
      window.alert('Skriv inn et innskudd større enn 0 kr.')
      return
    }

    updateProfileById(bankSelectedProfile.id, (profile) =>
      depositToBank(accrueBankInterest(profile, state.parentSettings), requestedAmount))
    setDepositAmountInput('')
  }

  function registerWithdrawalFromBank(event: FormEvent) {
    event.preventDefault()
    if (!canManage || !bankSelectedProfile) {
      return
    }

    const requestedAmount = bankWithdrawalMode === 'points'
      ? Math.floor(Math.max(0, safeNumber(withdrawalAmountInput, 0)))
      : roundMoney(Math.max(0, safeNumber(withdrawalAmountInput, 0)))
    if (requestedAmount <= 0) {
      const message = bankWithdrawalMode === 'points'
        ? 'Skriv inn et poengtrekk større enn 0.'
        : 'Skriv inn et uttak større enn 0 kr.'
      window.alert(message)
      return
    }

    if (bankWithdrawalMode === 'points') {
      if (requestedAmount > bankSelectedProfile.carryPoints) {
        window.alert(`Maks poengtrekk akkurat nå er ${bankSelectedProfile.carryPoints} poeng.`)
        return
      }

      updateProfileById(bankSelectedProfile.id, (profile) => ({
        ...profile,
        carryPoints: Math.max(0, profile.carryPoints - requestedAmount),
        transactions: [...(profile.transactions ?? []), {
          id: crypto.randomUUID(), type: 'points', amount: 0,
          timestamp: new Date().toISOString(), description: `Manuelt trekk: ${requestedAmount} overførte poeng`,
          pointsDelta: -requestedAmount,
        }],
      }))
      setWithdrawalAmountInput('')
      return
    }

    const accrued = accrueBankInterest(bankSelectedProfile, state.parentSettings)
    const availableBalance = summarizeBank(accrued).balance
    if (requestedAmount > availableBalance) {
      window.alert(`Maks uttak akkurat nå er ${availableBalance} kr.`)
      return
    }

    updateProfileById(bankSelectedProfile.id, () => withdrawFromBank(accrued, requestedAmount))

    setWithdrawalAmountInput('')
  }

  return (
    <main
      className={`app-shell ${isLoggedIn && !isChildMode ? 'parent-view' : ''}`}
      aria-busy={cloudBusy}
      onFocusCapture={(event) => {
        const input = event.target
        if (input instanceof HTMLInputElement && input.type === 'number') {
          input.select()
        }
      }}
      onPointerDownCapture={(event) => {
        const input = event.target
        previouslyFocusedValueInput.current =
          input instanceof HTMLInputElement && input.type === 'number' &&
          input.ownerDocument.activeElement === input ? input : null
      }}
      onClickCapture={(event) => {
        const input = event.target
        if (input instanceof HTMLInputElement && input.type === 'number') {
          input.select()
          if (previouslyFocusedValueInput.current === input) {
            // Number inputs do not support setSelectionRange.
            input.ownerDocument.getSelection()?.collapseToEnd()
          }
        }
      }}
      onBlurCapture={() => {
        previouslyFocusedValueInput.current = null
      }}
    >
      <fieldset disabled={cloudBusy} className="app-content">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">ØrnIt</p>
          <div className="hero-title-row">
            <h1>
              <span className="hero-brand">ØrnIt</span>
              <span className="hero-slogan">Bygg vaner. Spar smart</span>
            </h1>
            <div className="hero-title-icons" aria-hidden="true">
              <img src="/money-bills.svg" alt="" />
              <img src="/credit-card.svg" alt="" />
            </div>
          </div>
        </div>
        <div className="hero-side">
          {isLoggedIn && !isChildMode && (
            <div className="hero-actions">
              {isLoggedIn && !isChildMode && (
                <button type="button" className="logout-mini parent-logout" onClick={logoutApp}>
                  Logg ut
                </button>
              )}
            </div>
          )}
          {isLoggedIn && isChildMode && (
            <div className="child-header">
              <div className="hero-profile-row">
                {canManage && parentPreviewChildView ? (
                  <select
                    className="child-name-box hero-child-name child-preview-selector"
                    aria-label="Velg barn å forhåndsvise"
                    value={hasProfiles ? activeProfile.id : ''}
                    disabled={!hasProfiles}
                    onChange={(event) => persist({ ...state, activeChildId: event.target.value })}
                  >
                    {state.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.childName}</option>
                    ))}
                    {!hasProfiles && <option value="">Ingen barn opprettet</option>}
                  </select>
                ) : (
                <p className="child-name-box">
                  <strong className="hero-child-name">{hasProfiles ? activeProfile.childName : 'Ingen barn opprettet'}</strong>
                </p>
                )}
                <button type="button" className="logout-mini" onClick={logoutApp}>
                  Logg ut
                </button>
              </div>
              <p className="hero-period">
                <strong>{currentPeriodRangeLabel}</strong>
              </p>
            </div>
          )}
        </div>
      </header>
      {!isLoggedIn && <InstallHelp />}

      {!isLoggedIn && (
        <section className="card auth-card">
          <h2>Logg inn</h2>
          <p className="mini login-help">Forsiden viser kun innlogging. Funksjonene blir tilgjengelige etter innlogging.</p>
          <div className="role-switch">
            <button
              type="button"
              className={role === 'child' ? 'primary' : ''}
              onClick={() => switchRole('child')}
            >
              Barn
            </button>
            <button
              type="button"
              className={role === 'parent' ? 'primary' : ''}
              onClick={() => switchRole('parent')}
            >
              Forelder
            </button>
          </div>

          {role === 'child' && (
            <>
              <p className="mini login-help">
                {CHILD_AUTH_ENDPOINT
                  ? 'Skriv din unike kode. Koden sjekkes mot backend, og navnet ditt velges automatisk.'
                  : 'Skriv din unike kode. Navnet ditt velges automatisk.'}
              </p>
              <form className="inline-form password-form" onSubmit={loginAsChild}>
                <input
                  type={showChildPinInput ? 'text' : 'password'}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Skriv barnekode (minst 8, bokstaver + tall)"
                  value={childPinInput}
                  onChange={(event) => setChildPinInput(event.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                />
                <button type="button" onClick={() => setShowChildPinInput((value) => !value)}>
                  {showChildPinInput ? 'Skjul' : 'Vis'}
                </button>
                <button className="primary" type="submit" disabled={!childPinConfigured}>
                  Logg inn som barn
                </button>
              </form>
            </>
          )}

          {role === 'parent' && (
            !ADMIN_LOGIN_ENABLED && state.parentSettings.parentAccounts.length === 0 ? (
              <form className="inline-form password-form" onSubmit={createInitialParentAccount}>
                <p className="mini login-help">
                  Opprett den første foreldrekontoen for å komme i gang. Konto og appdata lagres bare i denne nettleseren,
                  ikke på en server eller andre enheter.
                </p>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Velg brukernavn (minst 3 tegn)"
                  value={parentUsernameInput}
                  onChange={(event) => setParentUsernameInput(event.target.value)}
                />
                <input
                  type={showPasswordInput ? 'text' : 'password'}
                  placeholder="Velg passord"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                />
                <button type="button" onClick={() => setShowPasswordInput((value) => !value)}>
                  {showPasswordInput ? 'Skjul' : 'Vis'}
                </button>
                <p className="mini login-help">
                  Passordstyrke: <strong>{getParentPasswordStrengthLabel(passwordInput)}</strong>. Minst 8 tegn, ett tall og ett spesialtegn.
                </p>
                <label className="mini remember-check">
                  <input
                    type="checkbox"
                    checked={rememberParentSession}
                    onChange={(event) => setRememberParentSession(event.target.checked)}
                  />
                  Husk meg på denne enheten
                </label>
                <button className="primary" type="submit">
                  Opprett foreldrekonto
                </button>
              </form>
            ) : (
              <form className="inline-form password-form" onSubmit={unlockParentMode}>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Brukernavn for forelder"
                  value={parentUsernameInput}
                  onChange={(event) => setParentUsernameInput(event.target.value)}
                />
                <input
                  type={showPasswordInput ? 'text' : 'password'}
                  placeholder="Passord"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                />
                <button type="button" onClick={() => setShowPasswordInput((value) => !value)}>
                  {showPasswordInput ? 'Skjul' : 'Vis'}
                </button>
                {ADMIN_LOGIN_ENABLED && (
                  <p className="mini login-help">
                    Admin logger inn med brukernavn <strong>{ADMIN_USERNAME}</strong> og sitt admin-passord.
                  </p>
                )}
                <label className="mini remember-check">
                  <input
                    type="checkbox"
                    checked={rememberParentSession}
                    onChange={(event) => setRememberParentSession(event.target.checked)}
                  />
                  Husk meg på denne enheten
                </label>
                <button className="primary" type="submit">
                  Logg inn som forelder
                </button>
              </form>
            )
          )}
        </section>
      )}

      {isLoggedIn && (
      <>

      {levelUpToast && (
        <aside className="level-up-toast" role="status" aria-live="polite">
          <strong>Nytt nivå!</strong>
          <span>{levelUpToast}</span>
        </aside>
      )}

      <nav className="tab-nav" aria-label="Hovedfaner">
        {!isParentLockedToPasswordReset && (
          <>
            <button
              type="button"
              className={activeTab === 'overview' ? 'primary' : ''}
              onClick={() => setActiveTab('overview')}
            >
              {isChildMode ? 'Hjem' : 'Oversikt'}
            </button>
            <button
              type="button"
              className={activeTab === 'tasks' ? 'primary' : ''}
              onClick={() => setActiveTab('tasks')}
            >
              Oppgaver
            </button>
            {!isChildMode && (
              <button
                type="button"
                className={activeTab === 'logs' ? 'primary' : ''}
                onClick={() => setActiveTab('logs')}
              >
                Registreringer
              </button>
            )}
            <button
              type="button"
              className={activeTab === 'history' ? 'primary' : ''}
              onClick={() => setActiveTab('history')}
            >
              {isChildMode ? 'Tidligere' : 'Historikk'}
            </button>
          </>
        )}
        {(isChildMode || (canManage && !isChildMode)) && (
          <button
            type="button"
            className={activeTab === 'account' ? 'primary' : ''}
            onClick={() => setActiveTab('account')}
          >
            Banken
          </button>
        )}
        {(canManage || isParentLockedToPasswordReset) && !isChildMode && (
          <button
            type="button"
            className={activeTab === 'settings' ? 'primary' : ''}
            onClick={() => setActiveTab('settings')}
          >
            Innstillinger
          </button>
        )}
      </nav>

      {canManage && hasProfiles && (
        <section className="parent-toolbar" aria-label="Foreldrekontroller">
          <div className="role-switch preview-switch">
            <button
              type="button"
              className={!parentPreviewChildView ? 'primary' : ''}
              onClick={() => setParentPreviewChildView(false)}
            >
              Foreldervisning
            </button>
            <button
              type="button"
              className={parentPreviewChildView ? 'primary' : ''}
              onClick={() => {
                setParentPreviewChildView(true)
                setActiveTab('overview')
              }}
            >
              Forhåndsvis barnesiden
            </button>
          </div>
        </section>
      )}

      {activeTab === 'overview' && (!isChildMode ? (
        <Suspense fallback={<section className="card">Laster foreldre-dashboard...</section>}>
          <ParentDashboard
            view="overview"
            mandatoryCompletionPct={dashboardMandatoryCompletionPct}
            mandatoryDoneTotal={dashboardMandatoryDoneTotal}
            mandatoryRequiredTotal={dashboardMandatoryRequiredTotal}
            pointsAvailableNow={dashboardPointsAvailable}
            netPointsThisPeriod={dashboardNetPoints}
            reachedLevelName={dashboardIsAll ? 'Flere nivåer' : (dashboardSelected?.reachedLevelName ?? 'Ingen nivå')}
            projectedExtra={dashboardProjectedExtra}
            projectedTotalAllowance={dashboardProjectedTotalAllowance}
            dashboardChildId={effectiveDashboardChildId}
            profiles={state.profiles.map((profile) => ({ id: profile.id, childName: formatChildNameForDisplay(profile.childName) }))}
            onDashboardChildChange={setDashboardChildId}
            payoutChartData={dashboardPayoutChartData}
            levelProgressData={dashboardLevelProgressData}
            mandatoryProgressData={dashboardMandatoryProgressData}
            bonusContributionData={dashboardBonusContributionData}
            penaltyContributionData={dashboardPenaltyContributionData}
            penaltyEnabled={state.parentSettings.penaltyEnabled}
            settlementHistoryData={dashboardSettlementHistoryData}
            historyFilter={activeProfile.historyFilter}
            onHistoryFilterChange={updateHistoryFilterForActiveChild}
          />
        </Suspense>
      ) : (
        <section className="card child-focus">
          <h2>Din progresjon denne perioden</h2>
          <p className="mini">Se hvor mye du har gjort, og hvor nær du er neste nivå.</p>

          <button
            type="button"
            className="primary child-next-action"
            onClick={() => setActiveTab('tasks')}
          >
            Se oppgavene mine
          </button>

          <div className={`level-celebration ${hasCelebration ? 'is-active' : ''}`}>
            <span className="spark spark-a" />
            <span className="spark spark-b" />
            <span className="spark spark-c" />
            <strong>{hasCelebration ? `Hurra! Du nådde ${reachedLevelNow?.name}` : 'Fortsett, du er på god vei!'}</strong>
          </div>

          <div className="star-track" aria-label="Stjerner for fremdrift">
            {[0, 1, 2, 3, 4].map((index) => (
              <span key={index} className={`star ${index < earnedStars ? 'earned' : ''}`}>
                ★
              </span>
            ))}
          </div>

          <div className="badge-row">
            {childBadges.map((badge) => (
              <span
                key={badge.label}
                className={`badge badge-${badge.kind} ${badge.unlocked ? 'badge-on' : ''}`}
              >
                {badge.unlocked ? '🏅' : '○'} {badge.label}
              </span>
            ))}
          </div>

          <div className="ring-grid">
            <article className="ring-card">
              <div
                className="progress-ring"
                style={{
                  background: `conic-gradient(#0f766e ${mandatoryCompletionPct}%, #dce5ed ${mandatoryCompletionPct}% 100%)`,
                }}
              >
                <span>{mandatoryCompletionPct}%</span>
              </div>
              <strong>Obligatoriske oppgaver</strong>
              <p className="mini">
                {mandatoryDoneTotal}/{mandatoryRequiredTotal} ferdig
              </p>
            </article>

            <article className="ring-card">
              <div
                className="progress-ring"
                style={{
                  background: `conic-gradient(#e67e22 ${nextLevelProgressPct}%, #dce5ed ${nextLevelProgressPct}% 100%)`,
                }}
              >
                <span>{nextLevelProgressPct}%</span>
              </div>
              <strong>Nivåfremdrift</strong>
              <p className="mini">
                {!hasConfiguredLevels
                  ? 'Ingen nivåer satt opp ennå.'
                  : nextLevel
                    ? 'Fyll ringen for å nå neste nivå.'
                    : 'Du har nådd alle nivåene!'}
              </p>
            </article>

            <article className="ring-card">
              <div
                className="progress-ring"
                style={{
                  background: `conic-gradient(#264653 ${payoutProgressPct}%, #dce5ed ${payoutProgressPct}% 100%)`,
                }}
              >
                <span>{payoutProgressPct}%</span>
              </div>
              <strong>Utbetalingspotensial</strong>
              <p className="mini">
                {projectedTotalAllowance} av {maxPossiblePayout || projectedTotalAllowance} kr mulig
              </p>
            </article>
          </div>
        </section>
      ))}

      {activeTab === 'settings' && (canManage || isParentLockedToPasswordReset) && <section className="card settings-card">
        <h2>Barn og innstillinger</h2>
        {isParentLockedToPasswordReset && (
          <section className="settings-module module-security">
            <h3>
              <span className="module-glyph" aria-hidden="true">L</span>
              Bytt passord før du fortsetter
            </h3>
            <p className="mini module-subtitle">
              Denne foreldrekontoen bruker midlertidig passord. Sett et nytt passord for å låse opp resten av appen.
            </p>
            <form className="inline-form" onSubmit={completeFirstParentPasswordChange}>
              <input
                type={showFirstLoginNewPassword ? 'text' : 'password'}
                placeholder="Nytt passord"
                value={firstLoginNewPassword}
                onChange={(event) => setFirstLoginNewPassword(event.target.value)}
              />
              <button type="button" onClick={() => setShowFirstLoginNewPassword((value) => !value)}>
                {showFirstLoginNewPassword ? 'Skjul' : 'Vis'}
              </button>
              <button type="submit">Lagre nytt passord</button>
            </form>
            <p className="mini">
              Passordstyrke: <strong>{firstLoginPasswordStrength}</strong>. Krav: minst 8 tegn, minst ett tall og minst ett spesialtegn.
            </p>
          </section>
        )}

        {canManage && (
          <div className="parent-tools">
            <section className="settings-module module-children">
              <h3>
                <span className="module-glyph" aria-hidden="true">N</span>
                Barn og innlogging
              </h3>
              <p className="mini module-subtitle">Hvert barn får sin egen profil og innloggingskode.</p>

              {hasProfiles ? (
                <div className="children-code-grid">
                  {state.profiles.map((profile) => {
                    const canShowPlain = Boolean(profile.childPinPlain)
                    const isCodeVisible = Boolean(visibleChildCodeById[profile.id]) && canShowPlain

                    return (
                      <article key={profile.id} className="child-code-card">
                        <div className="child-code-head">
                          <strong>{profile.childName}</strong>
                        </div>

                        <input
                          value={profile.childName}
                          disabled={!canManage}
                          onFocus={(event) => event.currentTarget.select()}
                          onClick={(event) => event.currentTarget.select()}
                          onChange={(event) =>
                            updateProfileById(profile.id, (item) => ({
                              ...item,
                              childName: event.target.value,
                            }))
                          }
                        />

                        {cloud ? (
                          <>
                            {cloudCodes[profile.id] && (
                              <input readOnly value={cloudCodes[profile.id]} aria-label={`Ny barnekode for ${profile.childName}`} />
                            )}
                            <p className="mini">
                              Koden vises bare når den opprettes. Noter den og del den med barnet.
                              Ved ny kode slutter den gamle å virke.
                            </p>
                            <div className="child-code-actions">
                              <button type="button" onClick={() => replaceChildPinForProfile(profile.id)}>Generer kode</button>
                              <button type="button" className="danger" onClick={() => removeChildPinForProfile(profile.id)}>Fjern kode</button>
                              <button type="button" className="danger" onClick={() => removeChildProfile(profile.id)}>Slett barn</button>
                            </div>
                          </>
                        ) : CHILD_AUTH_ENDPOINT ? (
                          <p className="mini">
                            Barnekoder styres av backend når backend-autentisering er aktiv.
                          </p>
                        ) : (
                          <>
                            <input
                              type={isCodeVisible ? 'text' : 'password'}
                              autoCapitalize="off"
                              autoCorrect="off"
                              spellCheck={false}
                              readOnly
                              value={profile.childPinHash && profile.childPinSalt ? profile.childPinPlain ?? '********' : ''}
                              placeholder={profile.childPinHash && profile.childPinSalt ? 'Kode finnes' : 'Ingen kode enda'}
                            />
                            <div className="child-code-actions">
                              <button
                                type="button"
                                disabled={!canShowPlain}
                                onClick={() =>
                                  setVisibleChildCodeById((previous) => ({
                                    ...previous,
                                    [profile.id]: !previous[profile.id],
                                  }))
                                }
                              >
                                {isCodeVisible ? 'Skjul kode' : 'Vis kode'}
                              </button>
                              {!canShowPlain && profile.childPinHash && profile.childPinSalt && (
                                <button type="button" onClick={() => replaceChildPinForProfile(profile.id)}>
                                  Lag ny synlig kode
                                </button>
                              )}
                              {profile.childPinHash && profile.childPinSalt ? (
                                <button type="button" className="danger" onClick={() => removeChildPinForProfile(profile.id)}>
                                  Fjern kode
                                </button>
                              ) : (
                                <button type="button" onClick={() => generateCodeForProfile(profile.id)}>
                                  Generer kode
                                </button>
                              )}
                              <button type="button" className="danger" onClick={() => removeChildProfile(profile.id)}>Slett barn</button>
                            </div>
                          </>
                        )}

                        {!cloud && !CHILD_AUTH_ENDPOINT && profile.childPinHash && profile.childPinSalt && !profile.childPinPlain && (
                          <p className="mini">
                            Denne koden ble lagret før synlig-kode-funksjonen. Fjern kode og generer ny hvis du vil se den.
                          </p>
                        )}

                        {!cloud && CHILD_AUTH_ENDPOINT && (
                          <div className="row-actions">
                            <button type="button" className="danger" onClick={() => removeChildProfile(profile.id)}>
                              Slett barn
                            </button>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              ) : (
                <p className="mini">Legg til et barn først for å sette navn og kode.</p>
              )}
              <form className="inline-form" onSubmit={addChildProfile}>
                <input
                  placeholder="Legg til nytt barn"
                  value={newChildName}
                  onChange={(event) => setNewChildName(event.target.value)}
                />
                <button type="submit">Legg til nytt barn</button>
              </form>
            </section>

            <section className="settings-module module-children module-child-settings">
              <h3>
                <span className="module-glyph" aria-hidden="true">I</span>
                Barnets innstillinger
              </h3>
              <p className="mini module-subtitle">
                Lønn per periode = fast lønn + lønn for fullførte obligatoriske oppgaver + bonus.
                Sett et beløp til 0 for å deaktivere den delen.
              </p>
              <div className="settings-grid">
                {!hasProfiles && (
                  <div className="period-chip">Ingen barn er opprettet ennå. Legg til et barn i modulen over.</div>
                )}
                <label>
                  Rediger innstillinger for
                  <select
                    value={hasProfiles ? activeProfile.id : ''}
                    disabled={!hasProfiles}
                    onChange={(event) =>
                      persist({
                        ...state,
                        activeChildId: event.target.value,
                      })
                    }
                  >
                    {state.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.childName}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Fast lønn per {activeProfile.periodType === 'week' ? 'uke' : 'måned'}
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={activeProfile.fixedAllowance ?? 0}
                    disabled={!hasProfiles}
                    onChange={(event) =>
                      updateActiveProfile(profile => ({
                        ...profile,
                        fixedAllowance: roundMoney(Math.max(0, safeNumber(event.target.value))),
                      }))
                    }
                  />
                  <span className="mini">Utbetales også uten registrerte oppgaver.</span>
                </label>

                <label>
                  Lønn for obligatoriske oppgaver per {activeProfile.periodType === 'week' ? 'uke' : 'måned'}
                  {editingBaseAllowance && baseAllowanceEditingChildId === activeProfile.id ? (
                    <div className="allowance-editor">
                      <input
                        type="number"
                        min={0}
                        value={baseAllowanceDraft}
                        disabled={!hasProfiles}
                        onChange={(event) =>
                          setBaseAllowanceDraft(Math.max(0, Math.floor(safeNumber(event.target.value, 0))))
                        }
                      />
                      <div className="row-actions">
                        <button
                          type="button"
                          onClick={() => {
                            if (!hasProfiles) {
                              return
                            }
                            updateActiveProfile((profile) => ({
                              ...profile,
                              baseAllowance: baseAllowanceDraft,
                            }))
                            setEditingBaseAllowance(false)
                          }}
                        >
                          Lagre ukelønn
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setBaseAllowanceDraft(activeProfile.baseAllowance)
                            setEditingBaseAllowance(false)
                          }}
                        >
                          Avbryt
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="allowance-display">
                      <strong>{hasProfiles ? activeProfile.baseAllowance : 0} kr</strong>
                      <button
                        type="button"
                        onClick={() => {
                          if (!hasProfiles) {
                            return
                          }
                          setBaseAllowanceDraft(activeProfile.baseAllowance)
                          setBaseAllowanceEditingChildId(activeProfile.id)
                          setEditingBaseAllowance(true)
                        }}
                      >
                        Rediger
                      </button>
                    </div>
                  )}
                  <span className="mini">Utbetales når alle krav er oppfylt. Krever minst én obligatorisk oppgave.</span>
                </label>

                <label>
                  Periode
                  <p className="mini">Velg om barnet får ukelønn eller månedslønn.</p>
                  <select
                    value={hasProfiles ? activeProfile.periodType : 'week'}
                    disabled={!hasProfiles}
                    onChange={(event) => {
                      if (currentPeriodEntries.length > 0) {
                        window.alert('Vent til perioden med registrerte oppgaver er avsluttet før du bytter mellom uke og måned.')
                        return
                      }
                      updateActiveProfile((profile) => ({
                        ...profile,
                        periodType: event.target.value as PeriodType,
                        allowanceStartAt: new Date().toISOString(),
                      }))
                    }}
                  >
                    <option value="week">Uke</option>
                    <option value="month">Måned</option>
                  </select>
                </label>

                <div className="period-chip">
                  Aktiv periode: <strong>{currentPeriodLabel}</strong>
                </div>
              </div>
              <p className="mini">
                Perioder avsluttes automatisk etter periodeskiftet, også uten registreringer.
                Nye lønnsbeløp gjelder den åpne perioden; avsluttet historikk endres ikke.
              </p>
            </section>

            <section className="settings-module module-security">
              <h3>
                <span className="module-glyph" aria-hidden="true">A</span>
                Foreldre
              </h3>
              <p className="mini module-subtitle">Lag brukernavn og passord for nye foreldre.</p>

              {cloud ? (
                <p className="mini">
                  Foreldrekontoer administreres i Supabase. Testeren bruker «Glemt passord» på innloggingssiden.
                  Nye testfamilier opprettes med oppsettsskriptet, ikke med lokale kontoer.
                </p>
              ) : isParentAdminSession ? (
                <>
                  <form className="inline-form" onSubmit={createParentAccessAccount}>
                    <input
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Nytt foreldrebrukernavn"
                      value={newParentAccountUsername}
                      onChange={(event) => setNewParentAccountUsername(event.target.value)}
                    />
                    <input
                      type={showNewParentAccountPassword ? 'text' : 'password'}
                      placeholder="Passord for ny forelder"
                      value={newParentAccountPassword}
                      onChange={(event) => setNewParentAccountPassword(event.target.value)}
                    />
                    <button type="button" onClick={() => setShowNewParentAccountPassword((value) => !value)}>
                      {showNewParentAccountPassword ? 'Skjul' : 'Vis'}
                    </button>
                    <button type="submit">Opprett foreldrekonto</button>
                  </form>
                  <label className="mini remember-check">
                    <input
                      type="checkbox"
                      checked={newParentAccountMustChangePassword}
                      onChange={(event) => setNewParentAccountMustChangePassword(event.target.checked)}
                    />
                    Krev passordbytte ved første innlogging
                  </label>
                  <p className="mini">
                    Du velger brukernavn og passord for ny forelder. Passordstyrke: <strong>{adminTempPasswordStrength}</strong>.
                    Krav: minst 8 tegn, minst ett tall og minst ett spesialtegn.
                  </p>
                </>
              ) : (
                <p className="mini">
                  Du er logget inn som foreldrekonto. Kun admin kan opprette nye foreldrekontoer.
                </p>
              )}

              <p className="mini">
                Foreldrekontoer: <strong>{state.parentSettings.parentAccounts.length}</strong>
              </p>
              {state.parentSettings.parentAccounts.length > 0 && (
                <ul className="mini">
                  {state.parentSettings.parentAccounts.map((account) => (
                    <li key={account.id}>
                      {account.username} {account.mustChangePassword ? '(må bytte passord)' : '(aktiv)'}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="settings-module module-security">
              <h3>
                <span className="module-glyph" aria-hidden="true">S</span>
                Sikkerhet
              </h3>
              <p className="mini module-subtitle">Tips for trygg og sikker bruk av appen.</p>

              {hasProfiles && isDefaultChildName(activeProfile.childName) && (
                <p className="mini">
                  Tips: Endre "{DEFAULT_CHILD_NAME}" til faktisk barnenavn i modulen "Barnets profil og kode".
                </p>
              )}
              <p className="mini">Navn og barnekode administreres nå i modulen "Barnets profil og kode".</p>
            </section>

            <section className="settings-module module-rules">
              <h3>
                <span className="module-glyph" aria-hidden="true">R</span>
                Regler
              </h3>
              <p className="mini module-subtitle">Velg hvilke regler som gjelder for poeng og bonus.</p>
              <label className="mini remember-check">
                <input
                  type="checkbox"
                  checked={state.parentSettings.penaltyEnabled}
                  onChange={(event) =>
                    persist({
                      ...state,
                      parentSettings: {
                        ...state.parentSettings,
                        penaltyEnabled: event.target.checked,
                      },
                    })
                  }
                />
                Aktiver poengtrekk
              </label>
              <label className="mini remember-check">
                <input
                  type="checkbox"
                  checked={state.parentSettings.bonusRequiresMandatory}
                  onChange={(event) =>
                    persist({
                      ...state,
                      parentSettings: {
                        ...state.parentSettings,
                        bonusRequiresMandatory: event.target.checked,
                      },
                    })
                  }
                />
                Krev obligatoriske oppgaver før bonus
              </label>
              <p className="mini">
                Når dette er av, kan opparbeidede bonuspoeng fortsatt gi bonus selv om obligatoriske oppgaver mangler.
              </p>
              <h4>Regler for poengtrekk</h4>
              <label>
                Rediger regler for
                <select
                  value={hasProfiles ? activeProfile.id : ''}
                  disabled={!hasProfiles}
                  onChange={(event) => persist({ ...state, activeChildId: event.target.value })}
                >
                  {state.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.childName}</option>
                  ))}
                </select>
              </label>
              <ul className="task-list">
                {activeProfile.penaltyTasks.map((task) => (
                  <li key={task.id}>
                    <label>
                      Regel
                      <input value={task.name} onChange={(event) => updatePenaltyTask(task.id, { name: event.target.value })} />
                    </label>
                    <label>
                      Poeng per trekk
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={task.points}
                        onChange={(event) => updatePenaltyTask(task.id, {
                          points: Math.max(1, Math.floor(safeNumber(event.target.value, task.points))),
                        })}
                      />
                    </label>
                    <button type="button" className="danger" onClick={() => removePenaltyTask(task.id)}>Slett regel</button>
                  </li>
                ))}
                {activeProfile.penaltyTasks.length === 0 && <li>Ingen regler for poengtrekk ennå.</li>}
              </ul>
              <form className="inline-form" onSubmit={addPenaltyTask}>
                <input
                  aria-label="Ny regel for poengtrekk"
                  placeholder="Hva gir poengtrekk?"
                  required
                  disabled={!hasProfiles}
                  value={newPenaltyName}
                  onChange={(event) => setNewPenaltyName(event.target.value)}
                />
                <input
                  aria-label="Antall trekkpoeng"
                  type="number"
                  min={1}
                  step={1}
                  disabled={!hasProfiles}
                  value={newPenaltyPoints}
                  onChange={(event) => setNewPenaltyPoints(Math.max(1, Math.floor(safeNumber(event.target.value, 1))))}
                />
                <button type="submit" disabled={!hasProfiles}>Legg til regel</button>
              </form>
            </section>

            <section className="settings-module module-help">
              <h3>
                <span className="module-glyph" aria-hidden="true">?</span>
                Hvordan appen fungerer
              </h3>
              <p className="mini module-subtitle">Kort guide til hvordan du bruker appen.</p>
              <ol className="mini">
                <li>Legg til barn og velg barnet du vil redigere lønn og periode for.</li>
                <li>Opprett oppgaver som barn kan gjøre for poeng eller penger. Bruk avkrysningene for å velge hvilke barn oppgaven gjelder for.</li>
                <li>Barn registrerer utførte oppgaver fra sin egen innlogging. Foreldre følger registreringene under Registreringer.</li>
                <li>Forhåndsvis barnesiden viser ekte data, men lar deg ikke registrere oppgaver som forelder.</li>
                <li>Lag regler for poengtrekk under Regler. Barnet ser dem under Hva kan gi poengtrekk? Ingen poeng trekkes når en regel opprettes; først når forelderen trykker Utfør trekk.</li>
                <li>Oppgaver oppdaterer lønnsprognosen. Lønn føres i banken når perioden avsluttes.</li>
                <li>Bruk regler for obligatoriske oppgaver, bonusnivåer, renter og trekk for å tilpasse appen.</li>
                <li>Se oversikt, banken og historikk for å følge utviklingen over tid.</li>
              </ol>
            </section>

            <section className="settings-module module-levels">
              <h3>
                <span className="module-glyph" aria-hidden="true">N</span>
                Bonusnivåer
              </h3>
              <p className="mini module-subtitle">Legg til nivåer som gir ekstra lønn når barnet får nok poeng.</p>
              <ul className="task-list">
                {sortedLevels.map((level) => (
                  <li key={level.id}>
                    <div className="level-row">
                      {canManageTaskSetup ? (
                        <input
                          value={level.name}
                          onChange={(event) => updateLevel(level.id, { name: event.target.value })}
                        />
                      ) : (
                        <strong>{level.name}</strong>
                      )}
                      <div className="mini level-inline-grid">
                        <label>
                          <span>Min. poeng</span>
                          <input
                            type="number"
                            min={1}
                            disabled={!canManageTaskSetup}
                            value={level.minPoints}
                            onChange={(event) =>
                              updateLevel(level.id, {
                                minPoints: Math.max(1, Math.floor(safeNumber(event.target.value, level.minPoints))),
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Ekstra kr</span>
                          <input
                            type="number"
                            min={0}
                            disabled={!canManageTaskSetup}
                            value={level.extraAmount}
                            onChange={(event) =>
                              updateLevel(level.id, {
                                extraAmount: Math.max(0, Math.floor(safeNumber(event.target.value, level.extraAmount))),
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                    {canManageTaskSetup && (
                      <button type="button" className="danger" onClick={() => removeLevel(level.id)}>
                        Slett
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {canManageTaskSetup && (
                <form className="inline-form level-form" onSubmit={addRewardLevel}>
                  <label className="mini level-name-field">
                    Nivånavn
                    <input
                      required
                      placeholder="For eksempel Bronse"
                      value={newLevelName}
                      onChange={(event) => setNewLevelName(event.target.value)}
                    />
                  </label>
                  <label className="mini">
                    Min. poeng
                    <input
                      type="number"
                      min={1}
                      value={newLevelPoints}
                      onChange={(event) => setNewLevelPoints(Math.max(1, safeNumber(event.target.value, 1)))}
                    />
                  </label>
                  <label className="mini">
                    Ekstra kr
                    <input
                      type="number"
                      min={0}
                      value={newLevelAmount}
                      onChange={(event) => setNewLevelAmount(Math.max(0, safeNumber(event.target.value, 0)))}
                    />
                  </label>
                  <button type="submit">Legg til nivå</button>
                </form>
              )}
            </section>

            <section className="settings-module module-interest">
              <h3>
                <span className="module-glyph" aria-hidden="true">%</span>
                Renter
              </h3>
              <p className="mini module-subtitle">Velg hvordan renter skal regnes på ubetalt opptjening.</p>
              <div className="task-targets">
                <div className="settings-grid">
                  <label>
                    Rente (%)
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={state.parentSettings.interestRatePct}
                      onChange={(event) =>
                        persist({
                          ...state,
                          parentSettings: {
                            ...state.parentSettings,
                            interestRatePct: Math.max(0, safeNumber(event.target.value, 0)),
                          },
                        })
                      }
                    />
                  </label>

                  <label>
                    Hvor ofte
                    <select
                      value={state.parentSettings.interestPeriod}
                      onChange={(event) =>
                        persist({
                          ...state,
                          parentSettings: {
                            ...state.parentSettings,
                            interestPeriod: event.target.value as InterestPeriod,
                          },
                        })
                      }
                    >
                      <option value="week">Per uke</option>
                      <option value="month">Per måned</option>
                      <option value="year">Per år</option>
                    </select>
                  </label>
                </div>
                <p className="mini">Perioder som er avsluttet får ikke renter.</p>
              </div>
            </section>

            <section className="settings-module module-backup">
              <h3>
                <span className="module-glyph" aria-hidden="true">D</span>
                Sikkerhetskopi og eksport
              </h3>
              <p className="mini module-subtitle">Ta backup, hent historikk og importer data når du trenger det.</p>
              <div className="task-targets">
                <div className="target-quick-actions">
                  <button type="button" onClick={exportBackupJson}>
                    Eksporter kopi (JSON)
                  </button>
                  <button type="button" onClick={exportSettlementsCsv}>
                    Eksporter utbetalinger (CSV)
                  </button>
                  <button type="button" onClick={() => importInputRef.current?.click()}>
                    Importer kopi
                  </button>
                </div>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json"
                  onChange={importBackupFile}
                  hidden
                />
              </div>
            </section>
          </div>
        )}
      </section>}

      {activeTab === 'overview' && <section className="card summary-card">
        <h2>Status nå - {!isChildMode
          ? (dashboardIsAll ? 'Alle barn' : dashboardSelected?.profile.childName ?? activeProfile.childName)
          : activeProfile.childName}</h2>
        <div className="summary-panel-list">
          <article className="summary-panel-item">
            <p>Opparbeidet ukelønn nå</p>
            <strong>{!isChildMode ? dashboardProjectedTotalAllowance : projectedTotalAllowance} kr</strong>
          </article>
          <article className="summary-panel-item">
            <p>Obligatoriske oppgaver</p>
            <strong>{!isChildMode
              ? (dashboardMandatoryMet ? 'Krav oppfylt' : 'Krav ikke oppfylt')
              : (mandatoryMet ? 'Krav oppfylt' : 'Krav ikke oppfylt')}</strong>
          </article>
          <article className="summary-panel-item">
            <p>Opptjente poeng</p>
            <strong>{!isChildMode ? dashboardBonusPoints : bonusPointsThisPeriod} poeng</strong>
          </article>
          {state.parentSettings.penaltyEnabled && (
            <article className="summary-panel-item">
              <p>Poengtrekk</p>
              <strong>-{!isChildMode ? dashboardPenaltyPoints : penaltyPointsThisPeriod} poeng</strong>
            </article>
          )}
          <article className="summary-panel-item">
            <p>Netto poeng denne perioden</p>
            <strong>{!isChildMode ? dashboardNetPoints : netPointsThisPeriod} poeng</strong>
          </article>
          {!isChildMode && (
            <article className="summary-panel-item compact-panel-item">
              <p>Rentekonto saldo</p>
              <div className="summary-panel-meta">
                <strong>{dashboardUnpaidSummary.totalWithInterest} kr</strong>
                <span>{dashboardUnpaidSummary.interest} kr i gjenværende opptjente renter</span>
              </div>
            </article>
          )}
          {!isChildMode && (
            <article className="summary-panel-item compact-panel-item">
              <p>Totalt opptjent ukelønn</p>
              <div className="summary-panel-meta">
                <strong>{dashboardTotalEarnedAllowance} kr</strong>
                <span>Fra avsluttede perioder</span>
              </div>
            </article>
          )}
          {!isChildMode && (
            <article className="summary-panel-item compact-panel-item">
              <p>Totalt tatt ut</p>
              <div className="summary-panel-meta">
                <strong>{dashboardTotalWithdrawnAllowance} kr</strong>
                <span>Registrerte uttak fra banken</span>
              </div>
            </article>
          )}
        </div>
        <p className="summary-line">
          Nivå nå: <strong>{!isChildMode
            ? (dashboardIsAll ? 'Flere nivåer' : dashboardSelected?.reachedLevelName ?? 'Ingen nivå ennå')
            : (reachedLevelNow?.name ?? 'Ingen nivå ennå')}</strong>. Poeng som blir
          med videre: <strong>{!isChildMode ? dashboardProjectedCarryOut : projectedCarryOut}</strong>. Overført inn i perioden:{' '}
          <strong>{!isChildMode ? dashboardSelection.reduce((sum, item) => sum + item.profile.carryPoints, 0) : activeProfile.carryPoints}</strong>.
        </p>
        {!isChildMode && <p className="summary-line summary-secondary">Trend: <strong>{payoutTrendLabel}</strong>.</p>}
        {!isChildMode && <p className="summary-line summary-secondary">
          Mest verdifulle ekstraoppgave: <strong>{topBonusTask ? `${topBonusTask.name} (${topBonusTask.points} poeng)` : 'Ingen registrert enda'}</strong>.
        </p>}
        {isChildMode && (
          <p className="summary-line summary-secondary">Se Banken for sparepenger, renter og totalsaldo.</p>
        )}
        {canManage && !isChildMode && (
          <div className="row-actions">
            <p className="mini">Perioder avsluttes automatisk ved periodeskifte.</p>
            <p className="mini">Utbetalt denne måneden: {paidThisMonthTotal} kr</p>
          </div>
        )}
      </section>}

      {activeTab === 'account' && canManage && !isChildMode && <section className="card rent-account-card">
        <h2>Banken</h2>
        <div className="task-targets">
          <label className="bank-child-selector">
            <span className="mini">Vis bank for</span>
            <select
              value={effectiveBankChildId}
              onChange={(event) => setBankChildId(event.target.value)}
            >
              <option value="all">Alle barn</option>
              {state.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {formatChildNameForDisplay(profile.childName)}
                </option>
              ))}
            </select>
          </label>
          <p className="mini">
            {effectiveBankChildId === 'all'
              ? 'Samlet status for alle barn. Opptjente renter er ekte saldo og kan tas ut.'
              : `Status for ${formatChildNameForDisplay(bankSelectedProfile?.childName ?? '')}. Opptjente renter er ekte saldo og kan tas ut.`}
          </p>
          <div className="bank-balance-hero">
            <span>Banksaldo med renter</span>
            <strong>{bankSummary.balance.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr</strong>
            <span className="bank-balance-caption">Tilgjengelig i banken</span>
          </div>
          <dl className="bank-stat-grid">
            <div>
              <dt>Opptjent lønn</dt>
              <dd>{bankSummary.earned.toLocaleString('nb-NO')} kr</dd>
              <span>Fra avsluttede perioder</span>
            </div>
            <div>
              <dt>Manuelle innskudd</dt>
              <dd>{bankSummary.deposits.toLocaleString('nb-NO')} kr</dd>
              <span>Totalt satt inn</span>
            </div>
            <div>
              <dt>Totalt tatt ut</dt>
              <dd>{bankSummary.withdrawn === 0 ? '0' : `−${bankSummary.withdrawn.toLocaleString('nb-NO')}`} kr</dd>
              <span>Registrerte uttak</span>
            </div>
            <div className="bank-stat-interest">
              <dt>Opptjente renter</dt>
              <dd>+{bankSummary.interest.toLocaleString('nb-NO')} kr</dd>
              <span>Renter som står i banken</span>
            </div>
          </dl>
          <p className="bank-rate-note">
            <strong>Aktiv rentesats:</strong> {state.parentSettings.interestRatePct}% per{' '}
            {state.parentSettings.interestPeriod === 'week'
              ? 'uke'
              : state.parentSettings.interestPeriod === 'month' ? 'måned' : 'år'}
          </p>
        </div>
      </section>}

      {activeTab === 'account' && canManage && !isChildMode && <section className="card">
        <h2>Banken</h2>
        <div className="task-targets bank-panel">
          <label className="bank-child-selector">
            <span className="mini">Gjelder for</span>
            <select
              value={effectiveBankChildId}
              onChange={(event) => setBankChildId(event.target.value)}
            >
              <option value="all">Alle barn</option>
              {state.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {formatChildNameForDisplay(profile.childName)}
                </option>
              ))}
            </select>
          </label>
          {bankSelectedProfile ? (
            <>
              <div className="bank-summary-pills">
                <div>
                  <span className="mini">Saldo</span>
                  <strong>{bankSelectedBalance} kr</strong>
                </div>
                <div>
                  <span className="mini">Poeng</span>
                  <strong>{bankSelectedProfile.carryPoints}</strong>
                </div>
              </div>
              <p className="mini">Sett inn penger eller trekk fra {formatChildNameForDisplay(bankSelectedProfile.childName)} sin bank.</p>
              <div className="bank-mode-toggle" aria-label="Velg hva som skal trekkes">
                <button
                  type="button"
                  className={bankWithdrawalMode === 'money' ? 'is-active' : ''}
                  onClick={() => setBankWithdrawalMode('money')}
                >
                  Penger
                </button>
                <button
                  type="button"
                  className={bankWithdrawalMode === 'points' ? 'is-active' : ''}
                  onClick={() => setBankWithdrawalMode('points')}
                >
                  Poeng
                </button>
              </div>
              <form className="inline-form" onSubmit={registerDepositToBank}>
                <input
                  type="number"
                  min={0}
                  step={bankWithdrawalMode === 'points' ? 1 : 0.01}
                  placeholder={bankWithdrawalMode === 'points' ? 'Sett inn poeng' : 'Sett inn (kr)'}
                  value={depositAmountInput}
                  onChange={(event) => setDepositAmountInput(event.target.value)}
                />
                <button type="submit">{bankWithdrawalMode === 'points' ? 'Sett inn poeng' : 'Sett inn'}</button>
              </form>
              <form className="inline-form" onSubmit={registerWithdrawalFromBank}>
                <input
                  type="number"
                  min={0}
                  step={bankWithdrawalMode === 'points' ? 1 : 0.01}
                  placeholder={bankWithdrawalMode === 'points' ? 'Trekk poeng' : 'Ta ut (kr)'}
                  value={withdrawalAmountInput}
                  onChange={(event) => setWithdrawalAmountInput(event.target.value)}
                />
                <button type="submit">{bankWithdrawalMode === 'points' ? 'Trekk poeng' : 'Ta ut'}</button>
              </form>
            </>
          ) : (
            <p className="mini">Velg ett barn for å registrere innskudd eller uttak.</p>
          )}
        </div>
      </section>}

      {activeTab === 'account' && isChildMode && <section className="card child-savings-card">
        <h2>Sparegrisen din</h2>
        <p className="mini">Pengene her kan vokse med renter når de blir stående.</p>
        <p className="bank-rate-note">
          Aktiv rentesats: {state.parentSettings.interestRatePct}% per{' '}
          {state.parentSettings.interestPeriod === 'week'
            ? 'uke'
            : state.parentSettings.interestPeriod === 'month'
              ? 'måned'
              : 'år'}.
        </p>
        <div className="bank-balance-hero">
          <span>Total saldo med renter</span>
          <strong>{unpaidSettlementsTotalWithInterest.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr</strong>
          <span className="bank-balance-caption">Sparepenger og renter</span>
        </div>
        <dl className="bank-stat-grid">
          <div>
            <dt>Totalt tjent</dt>
            <dd>{totalEarnedAllowance.toLocaleString('nb-NO')} kr</dd>
            <span>Fra avsluttede perioder</span>
          </div>
          <div>
            <dt>Totalt tatt ut</dt>
            <dd>{totalWithdrawnAllowance === 0 ? '0' : `−${totalWithdrawnAllowance.toLocaleString('nb-NO')}`} kr</dd>
            <span>Uttatte penger gir ikke nye renter</span>
          </div>
          <div>
            <dt>Sparepenger</dt>
            <dd>{childSavingsBeforeInterest.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr</dd>
            <span>Etter registrerte uttak</span>
          </div>
          <div className="bank-stat-interest">
            <dt>Opptjente renter</dt>
            <dd>+{unpaidSettlementsInterest.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr</dd>
            <span>Renter som står i banken</span>
          </div>
        </dl>
      </section>}

      {activeTab === 'account' && (
        <section className="card">
          <h2>Transaksjonshistorikk</h2>
          <p className="mini">
            Lønn, innskudd, uttak, opptjente renter og manuelle poengjusteringer.
            Renter legges til saldoen etter hele renteperioder fra hvert innskudd.
          </p>
          <ul className="history-list">
            {(isChildMode ? [activeProfile] : bankProfiles).flatMap(profile =>
              (profile.transactions ?? []).map(transaction => ({ ...transaction, childName: profile.childName })))
              .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
              .map(transaction => (
                <li key={transaction.id}>
                  <div>
                    <strong>{transaction.description}</strong>
                    <p className="mini">{transaction.childName} · {new Date(transaction.timestamp).toLocaleString('nb-NO')}</p>
                  </div>
                  <strong>
                    {transaction.type === 'points'
                      ? `${(transaction.pointsDelta ?? 0) > 0 ? '+' : ''}${transaction.pointsDelta ?? 0} poeng`
                      : `${transaction.amount > 0 ? '+' : ''}${transaction.amount.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`}
                  </strong>
                </li>
              ))}
            {(isChildMode ? [activeProfile] : bankProfiles).every(profile => (profile.transactions ?? []).length === 0) && (
              <li>Ingen transaksjoner ennå.</li>
            )}
          </ul>
          {canManage && <button type="button" onClick={exportTransactionsCsv}>Eksporter transaksjoner (CSV)</button>}
        </section>
      )}

      {activeTab === 'tasks' && <section className="grid-two">
        {canManage && !isChildMode && mustRenameDefaultChildBeforeTaskSetup && (
          <div className="card chart-span-2">
            <p className="mini">
              Før du lager oppgaver må du endre barnenavnet fra <strong>{DEFAULT_CHILD_NAME}</strong> i
              Innstillinger.
            </p>
          </div>
        )}
        <div className="card">
          <h2>Obligatoriske oppgaver</h2>
          {canManageTaskSetup && (
            <div className="task-targets compact-targets">
              <p className="mini">Oppgaven gjelder for:</p>
              {state.profiles.length > 1 && <label className="target-pill">
                <input
                  type="checkbox"
                  checked={taskTargetChildIds.length === state.profiles.length}
                  onChange={(event) =>
                    event.target.checked ? selectAllTargetChildren() : clearTargetChildren()
                  }
                />
                Alle barn
              </label>}
              <div className="task-target-list">
                {state.profiles.map((profile) => (
                  <label key={profile.id} className="target-pill">
                    <input
                      type="checkbox"
                      checked={taskTargetChildIds.includes(profile.id)}
                      onChange={(event) =>
                        updateSelectedChildrenForTasks(profile.id, event.target.checked)
                      }
                    />
                    {profile.childName}
                  </label>
                ))}
              </div>
            </div>
          )}

          {canManageTaskSetup && (
            <form className="inline-form bonus-form" onSubmit={addMandatoryTask}>
              <input
                placeholder="Ny obligatorisk oppgave"
                value={newMandatoryName}
                onChange={(event) => setNewMandatoryName(event.target.value)}
              />
              <div className="mandatory-add-actions">
              <label className="mandatory-count-field">
                Antall ganger
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={newMandatoryCount}
                  onChange={(event) => setNewMandatoryCount(event.target.value)}
                />
              </label>
              <button type="submit">Legg til</button>
              </div>
            </form>
          )}
          <ul className="task-list">
            {activeProfile.mandatoryTasks.map((task) => {
              const completedCount = mandatoryCountMap[task.id] ?? 0
              const taskStatus = completedCount >= task.requiredCount ? 'done' : completedCount > 0 ? 'partial' : 'new'
              return (
                <li key={task.id} className={`bonus-compact-task task-status-${taskStatus}`}>
                  <div className="bonus-compact-content">
                    <div className="mandatory-compact-top">
                      <strong className="bonus-task-name">{task.name}</strong>
                      <span className="mandatory-task-progress">
                        <span
                          className="mandatory-task-stars"
                          role="img"
                          aria-label={`${completedCount} av ${task.requiredCount} ganger utført`}
                        >
                          {Array.from({ length: task.requiredCount }, (_, index) => (
                            <span key={index} className={`star ${index < completedCount ? 'earned' : ''}`} aria-hidden="true">
                              {index < completedCount ? '★' : '☆'}
                            </span>
                          ))}
                        </span>
                        <span className="mini">
                          {taskStatus === 'done' ? 'Ferdig' : taskStatus === 'partial' ? 'Påbegynt' : 'Ikke startet'}
                        </span>
                      </span>
                    </div>
                    <div className="bonus-compact-bottom">
                      <p className="mini task-applies-to">
                        {getChildrenForTask('mandatory', task.name, task.requiredCount).join(', ') || 'Ingen'}
                      </p>
                      {canRegisterTasks && (
                        <button
                          type="button"
                          className="register-plus"
                          onClick={() => addEntry('mandatory', task.id)}
                          disabled={taskStatus === 'done'}
                          aria-label={`Registrer ${task.name} som utført`}
                        >
                          + Registrer utført
                        </button>
                      )}
                      {canManageTaskSetup && (
                        <button type="button" className="danger" onClick={() => removeMandatoryTask(task.id)}>
                          Slett
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="card">
          <h2>Ekstraoppgaver og poeng</h2>

          {canManageTaskSetup && (
            <>
              <div className="task-targets compact-targets">
                <p className="mini">Oppgaven gjelder for:</p>
                {state.profiles.length > 1 && <label className="target-pill">
                  <input
                    type="checkbox"
                    checked={taskTargetChildIds.length === state.profiles.length}
                    onChange={(event) =>
                      event.target.checked ? selectAllTargetChildren() : clearTargetChildren()
                    }
                  />
                  Alle barn
                </label>}
                <div className="task-target-list">
                  {state.profiles.map((profile) => (
                    <label key={profile.id} className="target-pill">
                      <input
                        type="checkbox"
                        checked={taskTargetChildIds.includes(profile.id)}
                        onChange={(event) =>
                          updateSelectedChildrenForTasks(profile.id, event.target.checked)
                        }
                      />
                      {profile.childName}
                    </label>
                  ))}
                </div>
              </div>
              <form className="inline-form bonus-form" onSubmit={addBonusTask}>
                <input
                  placeholder="Ny ekstraoppgave"
                  value={newBonusName}
                  onChange={(event) => setNewBonusName(event.target.value)}
                />
                <label className="mini bonus-points-field">
                  Poeng
                  <input
                    type="number"
                    min={1}
                    value={newBonusPoints}
                    onChange={(event) =>
                      setNewBonusPoints(Math.max(1, safeNumber(event.target.value, 1)))
                    }
                  />
                </label>
                <div className="bonus-add-actions">
                  <label className="mini up-for-grabs-toggle">
                    <input
                      type="checkbox"
                      checked={newBonusUpForGrabs}
                      onChange={(event) => setNewBonusUpForGrabs(event.target.checked)}
                    />
                    Up for grabs
                  </label>
                  <label className="mini up-for-grabs-toggle">
                    <input
                      type="checkbox"
                      checked={newBonusRepeatEachPeriod}
                      onChange={(event) => setNewBonusRepeatEachPeriod(event.target.checked)}
                    />
                    Gjenta hver lønnsperiode
                  </label>
                  <button type="submit">Legg til</button>
                </div>
              </form>
            </>
          )}

          <ul className="task-list">
            {canManageTaskSetup
              ? sortedBonusTasks.map((task) => {
                  const taskKey = getBonusTaskKey(task.name, task.points)
                  const taskAvailableThisPeriod = isBonusTaskAvailableInPeriod(
                    task, currentPeriodKey,
                  )
                  const alreadyTaken = task.upForGrabs
                    ? (sharedBonusCountByTaskKey.get(taskKey) ?? 0) > 0
                    : (bonusCountMap[task.id] ?? 0) > 0
                  const takenByChild = task.upForGrabs
                    ? bonusTakenByChildByTaskKey.get(taskKey)
                    : activeProfile.childName
                  return (
                  <li key={task.id} className={`bonus-compact-task task-status-${alreadyTaken ? 'done' : 'new'}`}>
                    <div className="bonus-compact-content">
                      <div className="bonus-compact-top">
                        <strong className="bonus-task-name">{task.name}</strong>
                        <span className="bonus-compact-points">{task.points} poeng</span>
                        {task.upForGrabs && <span className="mini bonus-task-shared">Up for grabs</span>}
                        {task.repeatEachPeriod === false && (
                          <span className="mini bonus-task-shared">
                            {taskAvailableThisPeriod ? 'Engangsoppgave' : 'Engangsoppgave · utløpt'}
                          </span>
                        )}
                      </div>
                      <div className="bonus-compact-bottom">
                        <p className="mini task-applies-to" title={alreadyTaken
                          ? task.upForGrabs ? `Tatt av ${takenByChild ?? 'noen'}` : 'Gjort denne perioden'
                          : 'Ikke tatt ennå'}>
                          <span className="bonus-task-label">Opprettet ekstraoppgave</span>
                          {' · '}
                          {getChildrenForTask('bonus', task.name, task.points).join(', ') || 'Ingen'}
                          {alreadyTaken && ' · Utført'}
                        </p>
                        <button
                          type="button"
                          className="danger"
                          disabled={!canManageTaskSetup}
                          onClick={() => removeBonusTask(task.id)}
                        >
                          Slett
                        </button>
                      </div>
                    </div>
                  </li>
                  )
                })
              : sharedBonusTasks.map((task) => {
                  const alreadyTaken = task.upForGrabs
                    ? (sharedBonusCountByTaskKey.get(task.key) ?? 0) > 0
                    : (bonusCountMap[activeProfileBonusTaskByKey.get(task.key)?.id ?? ''] ?? 0) > 0
                  const takenByChild = task.upForGrabs
                    ? bonusTakenByChildByTaskKey.get(task.key)
                    : activeProfile.childName
                  const activeChildTask = activeProfileBonusTaskByKey.get(task.key)
                  const canRegisterThisTask =
                    canRegisterTasks && Boolean(activeChildTask) && !alreadyTaken
                  return (
                    <li key={task.key} className={`task-status-${alreadyTaken ? 'done' : 'new'}`}>
                      <div>
                        <strong>{task.name}</strong>
                        <div className="bonus-meta-line">
                          <span className="mini">Poeng</span>
                          <strong>{task.points}</strong>
                          <span className="mini bonus-registered">
                            {alreadyTaken
                              ? task.upForGrabs
                                ? `Tatt av ${takenByChild ?? 'noen'}`
                                : 'Gjort denne perioden'
                              : 'Ikke tatt ennå'}
                          </span>
                          {canRegisterThisTask && activeChildTask && (
                            <button type="button" onClick={() => addEntry('bonus', activeChildTask.id)}>
                              Registrer utført
                            </button>
                          )}
                        </div>
                        <p className="mini task-applies-to">
                          {task.upForGrabs ? 'Up for grabs. ' : ''}Gjelder for: {task.childNames.join(', ')}
                        </p>
                      </div>
                    </li>
                  )
                })}
          </ul>
        </div>
          {state.parentSettings.penaltyEnabled && (
            <section className="card penalty-section chart-span-2">
              <h2>Poengtrekk</h2>
              <h3>Hva kan gi poengtrekk?</h3>
              <ul className="task-list">
                {activeProfile.penaltyTasks.map((task) => {
                    const applicableProfiles = state.profiles.filter((profile) =>
                      profile.penaltyTasks.some((profileTask) => profileTask.id === task.id),
                    )
                    const selectedChildId = penaltyTargetChildIdByTask[task.id] ?? applicableProfiles[0]?.id ?? ''
                    return (
                  <li key={task.id}>
                    <div className="penalty-task-content">
                      <div className="penalty-task-line">
                        <strong>{task.name}</strong>
                        <span className="mini">Kan gi {task.points} poeng i trekk</span>
                        {canManage && !isChildMode && (
                        <label className="mini penalty-target-select">
                          <span>Gjelder for</span>
                          <select
                            value={selectedChildId}
                            onChange={(event) => setPenaltyTargetChildIdByTask((previous) => ({
                              ...previous,
                              [task.id]: event.target.value,
                            }))}
                          >
                            {applicableProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>{profile.childName}</option>
                            ))}
                          </select>
                        </label>
                        )}
                        {canManage && !isChildMode && (
                          <button type="button" onClick={() => registerPenalty(task.id, selectedChildId)} disabled={!selectedChildId}>
                            Utfør trekk
                          </button>
                        )}
                      </div>
                    </div>
                    {canManage && !isChildMode && (
                      <div className="registered-dates">
                        {currentPeriodEntries
                          .filter((entry) => entry.taskType === 'penalty' && entry.taskId === task.id)
                          .map((entry) => (
                            <div key={entry.id} className="registered-date">
                              <span>
                                Trekk registrert {new Date(entry.timestamp).toLocaleDateString('nb-NO', {
                                  weekday: 'short',
                                  day: '2-digit',
                                  month: '2-digit',
                                })}
                              </span>
                              <button
                                type="button"
                                className="remove-date"
                                onClick={() => removeEntry(entry.id)}
                              >
                                Angre
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </li>
                    )
                })}
              </ul>

              {activeProfile.penaltyTasks.length === 0 && <p className="mini">Ingen regler for poengtrekk ennå.</p>}
            </section>
          )}
      </section>}

      {((activeTab === 'tasks' && isChildMode) || (activeTab === 'logs' && !isChildMode)) && (
      <section className="card">
        <details key={isChildMode ? 'child-registrations' : 'parent-registrations'} open={isChildMode ? undefined : true}>
          <summary className="registrations-summary">
            {isChildMode ? 'Mine registreringer' : `Registreringer (${currentPeriodLabel})`}
          </summary>
          <ul className="log-list">
            {currentPeriodEntries.length === 0 && <li>Ingen registreringer ennå i denne perioden.</li>}
            {currentPeriodEntries.map((entry) => renderRegistrationEntry(entry, true))}
          </ul>
        </details>
        {isChildMode && previousRegistrationPeriods.map(({ periodKey, entries }) => (
          <details key={periodKey} className="previous-registration-period">
            <summary className="registrations-summary">
              {getPeriodSummaryLabel(periodKey, activeProfile.periodType)} · {entries.length}{' '}
              {entries.length === 1 ? 'registrering' : 'registreringer'}
            </summary>
            <ul className="log-list">
              {entries.map((entry) => renderRegistrationEntry(entry, false))}
            </ul>
          </details>
        ))}
      </section>
      )}

      {activeTab === 'history' && isParentMode && !isChildMode && (
        <Suspense fallback={<section className="card">Laster historikk...</section>}>
          <ParentDashboard
            view="history"
            mandatoryCompletionPct={dashboardMandatoryCompletionPct}
            mandatoryDoneTotal={dashboardMandatoryDoneTotal}
            mandatoryRequiredTotal={dashboardMandatoryRequiredTotal}
            pointsAvailableNow={dashboardPointsAvailable}
            netPointsThisPeriod={dashboardNetPoints}
            reachedLevelName={dashboardIsAll ? 'Flere nivåer' : (dashboardSelected?.reachedLevelName ?? 'Ingen nivå')}
            projectedExtra={dashboardProjectedExtra}
            projectedTotalAllowance={dashboardProjectedTotalAllowance}
            dashboardChildId={effectiveDashboardChildId}
            profiles={state.profiles.map((profile) => ({ id: profile.id, childName: formatChildNameForDisplay(profile.childName) }))}
            onDashboardChildChange={setDashboardChildId}
            payoutChartData={dashboardPayoutChartData}
            levelProgressData={dashboardLevelProgressData}
            mandatoryProgressData={dashboardMandatoryProgressData}
            bonusContributionData={dashboardBonusContributionData}
            penaltyContributionData={dashboardPenaltyContributionData}
            penaltyEnabled={state.parentSettings.penaltyEnabled}
            settlementHistoryData={dashboardSettlementHistoryData}
            historyFilter={activeProfile.historyFilter}
            onHistoryFilterChange={updateHistoryFilterForActiveChild}
          />
        </Suspense>
      )}

      {activeTab === 'history' && <section className="card">
        <h2>Historikk for avsluttede perioder</h2>
        <label className="history-payment-filter">
          Utbetalingsstatus
          <select
            value={historyPaymentFilter}
            onChange={(event) => setHistoryPaymentFilter(event.target.value as PaymentStatusFilter)}
          >
            <option value="all">Alle</option>
            <option value="unpaid">Kun ikke utbetalt</option>
            <option value="paid">Kun utbetalt</option>
          </select>
        </label>
        <ul className="history-list">
          {visibleSettlements.length === 0 && <li>Ingen perioder matcher valgt filter.</li>}
          {visibleSettlements.map((settlement) => {
            const settlementInterest = settlementInterestById.get(settlement.id)
            const periodTotalWithInterest = settlementInterest?.totalWithInterest ?? settlement.totalPaid
            const periodInterest = settlementInterest?.interest ?? 0
            const periodWithdrawn = settlement.withdrawnAmount ?? 0
            const periodRemaining = Math.max(0, settlement.totalPaid - periodWithdrawn)

            return (
              <li key={settlement.id}>
                <div>
                  <strong>{settlement.periodLabel}</strong>
                  <p className="mini">
                    Fast lønn: {settlement.fixedPaid ?? 0} kr. Obligatorisk lønn: {settlement.basePaid} kr.
                    Bonus: {settlement.extraPaid} kr.
                  </p>
                  <p className="mini">
                    Nivå: {settlement.reachedLevelName}, poeng brukt {settlement.pointsSpent},
                    overført videre {settlement.carryOut}
                  </p>
                  <p className="mini">
                    Hovedbeløp: {settlement.totalPaid} kr. Tatt ut: {periodWithdrawn} kr. Gjenstår:{' '}
                    {periodRemaining} kr. Renter nå: {periodInterest} kr. Totalt nå: {periodTotalWithInterest}{' '}
                    kr.
                  </p>
                  <p className="mini">
                    {periodRemaining === 0
                      ? settlement.paidAt
                        ? `Fullt uttak registrert: ${new Date(settlement.paidAt).toLocaleDateString('nb-NO')}`
                        : 'Fullt uttak registrert.'
                      : 'Delvis eller ingen uttak registrert enda.'}
                  </p>
                </div>
                <div className="row-actions">
                  <strong>{periodTotalWithInterest} kr</strong>
                </div>
              </li>
            )
          })}
        </ul>
        </section>}

        {canManage && activeTab === 'settings' && (
        <section className="card reset-card">
          <h2>Vedlikehold</h2>
          <p className="mini">
            Alle data lagres kun lokalt i nettleseren (localStorage).
          </p>
          <div className="reset-actions">
            <button className="danger" type="button" onClick={resetAllData}>
              Nullstill aktivt barn
            </button>
            {isParentAdminSession && (
              <button className="danger" type="button" onClick={resetEntireAppData}>
                Nullstill all appdata
              </button>
            )}
          </div>
        </section>
      )}
      </>
      )}
      </fieldset>
    </main>
  )
}

export default App
