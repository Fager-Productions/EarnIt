import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { calculateUnpaidTotalWithInterest, type InterestPeriod } from './lib/coreLogic'
import './App.css'
import type {
  AppState,
  AppTab,
  BonusTask,
  ChildProfile,
  DeferredInstallPromptEvent,
  HistoryFilter,
  MandatoryTask,
  PaymentStatusFilter,
  PenaltyTask,
  PeriodType,
  RewardLevel,
  Settlement,
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
  getInitialInterestAnchor,
  getMonthKey,
  getPeriodKey,
  getPeriodLabel,
  getPeriodStartDate,
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
  normalizeLoadedState,
  safeNumber,
} from './lib/state'
import { computePeriodOutcome } from './lib/settlement'

const ParentDashboard = lazy(() => import('./ParentDashboard'))

function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [role, setRole] = useState<UserRole>('child')
  const [parentPreviewChildView, setParentPreviewChildView] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isParentUnlocked, setIsParentUnlocked] = useState(false)
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

  const [newChildName, setNewChildName] = useState('')
  const [newParentAccountUsername, setNewParentAccountUsername] = useState('')
  const [newParentAccountPassword, setNewParentAccountPassword] = useState('')
  const [showNewParentAccountPassword, setShowNewParentAccountPassword] = useState(false)
  const [newParentAccountMustChangePassword, setNewParentAccountMustChangePassword] = useState(true)
  const [visibleChildCodeById, setVisibleChildCodeById] = useState<Record<string, boolean>>({})
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState<PaymentStatusFilter>('all')

  const [newMandatoryName, setNewMandatoryName] = useState('')
  const [newMandatoryCount, setNewMandatoryCount] = useState(1)
  const [newBonusName, setNewBonusName] = useState('')
  const [newBonusPoints, setNewBonusPoints] = useState(1)
  const [newBonusUpForGrabs, setNewBonusUpForGrabs] = useState(false)
  const [newPenaltyName, setNewPenaltyName] = useState('')
  const [newPenaltyPoints, setNewPenaltyPoints] = useState(1)
  const [newLevelName, setNewLevelName] = useState('')
  const [newLevelPoints, setNewLevelPoints] = useState(5)
  const [newLevelAmount, setNewLevelAmount] = useState(10)
  const [withdrawalAmountInput, setWithdrawalAmountInput] = useState('')
  const [parentTestRegistrationEnabled, setParentTestRegistrationEnabled] = useState(false)
  const [taskTargetChildIds, setTaskTargetChildIds] = useState<string[]>([])
  const [levelUpToast, setLevelUpToast] = useState<string | null>(null)
  const [installPromptEvent, setInstallPromptEvent] = useState<DeferredInstallPromptEvent | null>(null)
  const [isInstalledApp, setIsInstalledApp] = useState(false)
  const [isIosInstallable, setIsIosInstallable] = useState(false)
  const previousLevelByChildRef = useRef<Record<string, string | null>>({})
  const toastTimerRef = useRef<number | null>(null)
  const parentIdleTimerRef = useRef<number | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const activeProfile =
    state.profiles.find((profile) => profile.id === state.activeChildId) ?? state.profiles[0] ?? EMPTY_CHILD_PROFILE
  const hasProfiles = state.profiles.length > 0

  const allChildrenProgress = useMemo(
    () =>
      state.profiles.map((profile) => {
        const periodKey = getPeriodKey(new Date(), profile.periodType)
        const periodEntries = profile.entries.filter((entry) =>
          isEntryInCurrentPeriod(entry, profile.periodType, periodKey),
        )
        const mandatoryRequired = profile.mandatoryTasks.reduce((sum, task) => sum + task.requiredCount, 0)
        const mandatoryDone = profile.mandatoryTasks.reduce((sum, task) => {
          const count = periodEntries.filter(
            (entry) => entry.taskType === 'mandatory' && entry.taskId === task.id,
          ).length
          return sum + Math.min(task.requiredCount, count)
        }, 0)
        const outcome = computePeriodOutcome({
          entries: profile.entries,
          periodType: profile.periodType,
          periodKey,
          mandatoryTasks: profile.mandatoryTasks,
          bonusTasks: profile.bonusTasks,
          penaltyTasks: profile.penaltyTasks,
          rewardLevels: profile.rewardLevels,
          baseAllowance: profile.baseAllowance,
          carryIn: profile.carryPoints,
          penaltyEnabled: state.parentSettings.penaltyEnabled,
        })
        return {
          profile,
          mandatoryDone,
          mandatoryRequired,
          completionPct:
            mandatoryRequired > 0 ? Math.round((mandatoryDone / mandatoryRequired) * 100) : 0,
          outcome,
        }
      }),
    [state.profiles, state.parentSettings.penaltyEnabled],
  )

  const currentPeriodKey = getPeriodKey(new Date(), activeProfile.periodType)
  const currentPeriodLabel = getPeriodLabel(currentPeriodKey, activeProfile.periodType)
  const currentPeriodRangeLabel = useMemo(
    () => formatDateRangeLabel(new Date(), activeProfile.periodType),
    [activeProfile.periodType],
  )

  const currentPeriodEntries = useMemo(
    () =>
      activeProfile.entries.filter((entry) =>
        isEntryInCurrentPeriod(entry, activeProfile.periodType, currentPeriodKey),
      ),
    [activeProfile.entries, activeProfile.periodType, currentPeriodKey],
  )

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
          return sum + (task?.points ?? 0)
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
          return sum + (task?.points ?? 0)
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

  const penaltyCountMap = useMemo(() => {
    if (!state.parentSettings.penaltyEnabled) {
      return {}
    }
    const map: Record<string, number> = {}
    currentPeriodEntries
      .filter((entry) => entry.taskType === 'penalty')
      .forEach((entry) => {
        map[entry.taskId] = (map[entry.taskId] ?? 0) + 1
      })
    return map
  }, [currentPeriodEntries, state.parentSettings.penaltyEnabled])

  const pointsAvailableNow = Math.max(0, activeProfile.carryPoints + netPointsThisPeriod)

  const sortedLevels = useMemo(
    () => [...activeProfile.rewardLevels].sort((a, b) => a.minPoints - b.minPoints),
    [activeProfile.rewardLevels],
  )

  const reachedLevelNow =
    sortedLevels.filter((level) => level.minPoints <= pointsAvailableNow).at(-1) ?? null

  const bonusCanApplyNow = mandatoryMet
  const projectedExtra = bonusCanApplyNow ? (reachedLevelNow?.extraAmount ?? 0) : 0
  const projectedPointsSpent = bonusCanApplyNow ? (reachedLevelNow?.minPoints ?? 0) : 0
  const projectedCarryOut = bonusCanApplyNow
    ? Math.max(0, pointsAvailableNow - projectedPointsSpent)
    : pointsAvailableNow
  const projectedTotalAllowance = mandatoryMet ? activeProfile.baseAllowance + projectedExtra : 0

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
  const payoutChartData = [
    { name: 'Grunnlønn', amount: mandatoryMet ? activeProfile.baseAllowance : 0 },
    { name: 'Bonus', amount: projectedExtra },
    { name: 'Total', amount: projectedTotalAllowance },
  ]

  const levelProgressData = [
    {
      name: 'Poeng',
      na: pointsAvailableNow,
      mal: nextLevel ? nextLevel.minPoints : pointsAvailableNow,
    },
  ]

  const mandatoryProgressData = activeProfile.mandatoryTasks.map((task) => ({
    name: task.name,
    gjort: Math.min(task.requiredCount, mandatoryCountMap[task.id] ?? 0),
    krav: task.requiredCount,
  }))

  const bonusContributionData = activeProfile.bonusTasks.map((task) => ({
    name: task.name,
    poeng: (bonusCountMap[task.id] ?? 0) * task.points,
  }))
  const sortedBonusTasks = useMemo(
    () =>
      [...activeProfile.bonusTasks].sort((a, b) =>
        a.name.localeCompare(b.name, 'nb-NO', { sensitivity: 'base' }),
      ),
    [activeProfile.bonusTasks],
  )
  const activeProfileBonusTaskByKey = useMemo(() => {
    const map = new Map<string, BonusTask>()
    activeProfile.bonusTasks.forEach((task) => {
      map.set(getBonusTaskKey(task.name, task.points), task)
    })
    return map
  }, [activeProfile.bonusTasks])

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
      profile.bonusTasks.forEach((task) => {
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
  }, [state.profiles])

  const sharedBonusEntriesThisPeriod = useMemo(() => {
    const now = new Date()
    const entries = state.profiles.flatMap((profile) => {
      const profileCurrentPeriodKey = getPeriodKey(now, profile.periodType)
      return profile.entries
        .filter((entry) => entry.taskType === 'bonus')
        .filter((entry) => getPeriodKey(new Date(entry.timestamp), profile.periodType) === profileCurrentPeriodKey)
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

    return entries.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
  }, [state.profiles])

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

  const penaltyContributionData = activeProfile.penaltyTasks.map((task) => ({
    name: task.name,
    trekk: (penaltyCountMap[task.id] ?? 0) * task.points,
  }))

  const settlementHistoryData = activeProfile.settlements
    .slice(0, 6)
    .reverse()
    .map((settlement) => ({
      periode: settlement.periodLabel,
      utbetaling: settlement.totalPaid,
      poeng: settlement.pointsEarned,
      periodType: settlement.periodType,
    }))

  const unpaidSummary = useMemo(
    () =>
      calculateUnpaidTotalWithInterest(
        activeProfile.settlements,
        state.parentSettings.interestRatePct,
        state.parentSettings.interestPeriod,
      ),
    [
      activeProfile.settlements,
      state.parentSettings.interestPeriod,
      state.parentSettings.interestRatePct,
    ],
  )
  const unpaidSettlementsTotal = unpaidSummary.principal
  const unpaidSettlementsTotalWithInterest = unpaidSummary.totalWithInterest
  const unpaidSettlementsInterest = unpaidSummary.interest

  const paidThisMonthTotal = useMemo(() => {
    const currentMonthKey = getMonthKey(new Date())
    return activeProfile.settlements
      .filter((settlement) => settlement.paidAt)
      .filter((settlement) => getMonthKey(new Date(settlement.paidAt as string)) === currentMonthKey)
      .reduce((sum, settlement) => sum + settlement.totalPaid, 0)
  }, [activeProfile.settlements])

  const totalEarnedAllowance = useMemo(
    () => activeProfile.settlements.reduce((sum, settlement) => sum + settlement.totalPaid, 0),
    [activeProfile.settlements],
  )

  const totalWithdrawnAllowance = useMemo(
    () => activeProfile.settlements.reduce((sum, settlement) => sum + (settlement.withdrawnAmount ?? 0), 0),
    [activeProfile.settlements],
  )
  const totalWithdrawnDisplay = totalWithdrawnAllowance === 0 ? '0 kr' : `-${totalWithdrawnAllowance} kr`

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
    const now = new Date()
    return new Map(
      activeProfile.settlements.map((settlement) => {
        const outstanding = Math.max(0, settlement.totalPaid - (settlement.withdrawnAmount ?? 0))
        if (outstanding === 0) {
          return [
            settlement.id,
            {
              principal: 0,
              interest: 0,
              totalWithInterest: 0,
            },
          ]
        }

        const summary = calculateUnpaidTotalWithInterest(
          [settlement],
          state.parentSettings.interestRatePct,
          state.parentSettings.interestPeriod,
          now,
        )

        return [settlement.id, summary]
      }),
    )
  }, [
    activeProfile.settlements,
    state.parentSettings.interestPeriod,
    state.parentSettings.interestRatePct,
  ])

  const hasConfiguredLevels = sortedLevels.length > 0
  const nextLevelProgressPct = !hasConfiguredLevels
    ? 0
    : nextLevel
      ? Math.min(100, Math.round((pointsAvailableNow / nextLevel.minPoints) * 100))
      : 100
  const maxExtraAmount = sortedLevels.at(-1)?.extraAmount ?? 0
  const maxPossiblePayout = (mandatoryMet ? activeProfile.baseAllowance : 0) + maxExtraAmount
  const payoutProgressPct =
    maxPossiblePayout > 0 ? Math.round((projectedTotalAllowance / maxPossiblePayout) * 100) : 0

  const earnedStars = Math.min(5, Math.max(0, Math.floor(nextLevelProgressPct / 20)))
  const mandatoryTaskCompletedCount = activeProfile.mandatoryTasks.filter(
    (task) => (mandatoryCountMap[task.id] ?? 0) >= task.requiredCount,
  ).length
  const childBadges = [
    {
      label: 'Oppgavehelt',
      unlocked: mandatoryTaskCompletedCount === activeProfile.mandatoryTasks.length,
      kind: 'mandatory',
    },
    {
      label: 'Bonusjeger',
      unlocked: bonusPointsThisPeriod > 0,
      kind: 'bonus',
    },
    ...(state.parentSettings.penaltyEnabled
      ? [
          {
            label: 'Trekkfri uke',
            unlocked: penaltyPointsThisPeriod === 0,
            kind: 'penalty',
          },
        ]
      : []),
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
  const canRegisterTasksInCurrentView =
    canRegisterTasks || (canManage && (parentTestRegistrationEnabled || parentPreviewChildView))
  const canManageTaskSetup = canManage && !isChildMode && !mustRenameDefaultChildBeforeTaskSetup

  useEffect(() => {
    if (!isLoggedIn) {
      return
    }

    const settledKeys = new Set(
      activeProfile.settlements
        .filter((settlement) => settlement.periodType === activeProfile.periodType)
        .map((settlement) => settlement.periodKey),
    )

    const pendingPastPeriodKeys = Array.from(
      new Set(
        activeProfile.entries
          .map((entry) => getPeriodKey(new Date(entry.timestamp), activeProfile.periodType))
          .filter((periodKey) => periodKey !== currentPeriodKey && !settledKeys.has(periodKey)),
      ),
    ).sort(
      (a, b) =>
        getPeriodStartDate(a, activeProfile.periodType).getTime() -
        getPeriodStartDate(b, activeProfile.periodType).getTime(),
    )

    if (pendingPastPeriodKeys.length === 0) {
      return
    }

    let carryIn = activeProfile.settlements[0]?.carryOut ?? activeProfile.carryPoints

    const autoSettlements: Settlement[] = pendingPastPeriodKeys.map((periodKey) => {
      const outcome = computePeriodOutcome({
        entries: activeProfile.entries,
        periodType: activeProfile.periodType,
        periodKey,
        mandatoryTasks: activeProfile.mandatoryTasks,
        bonusTasks: activeProfile.bonusTasks,
        penaltyTasks: activeProfile.penaltyTasks,
        rewardLevels: activeProfile.rewardLevels,
        baseAllowance: activeProfile.baseAllowance,
        carryIn,
        penaltyEnabled: state.parentSettings.penaltyEnabled,
      })

      const settlement: Settlement = {
        id: crypto.randomUUID(),
        periodKey,
        periodLabel: getPeriodLabel(periodKey, activeProfile.periodType),
        periodType: activeProfile.periodType,
        mandatoryMet: outcome.mandatoryMet,
        basePaid: outcome.basePaid,
        extraPaid: outcome.extraPaid,
        totalPaid: outcome.totalPaid,
        pointsEarned: outcome.netPoints,
        pointsAvailable: outcome.pointsAvailable,
        pointsSpent: outcome.pointsSpent,
        carryOut: outcome.carryOut,
        reachedLevelName: outcome.reachedLevelName,
        createdAt: getInitialInterestAnchor(state.parentSettings.interestPeriod),
        withdrawnAmount: 0,
        paidAt: null,
      }

      carryIn = outcome.carryOut
      return settlement
    })

    if (autoSettlements.length > 0) {
      updateActiveProfile((profile) => ({
        ...profile,
        carryPoints: carryIn,
        settlements: [...autoSettlements.reverse(), ...profile.settlements],
      }))
    }
  }, [
    activeProfile.baseAllowance,
    activeProfile.bonusTasks,
    activeProfile.carryPoints,
    activeProfile.entries,
    activeProfile.id,
    activeProfile.mandatoryTasks,
    activeProfile.penaltyTasks,
    activeProfile.periodType,
    activeProfile.rewardLevels,
    activeProfile.settlements,
    currentPeriodKey,
    isLoggedIn,
    state.parentSettings.interestPeriod,
    state.parentSettings.penaltyEnabled,
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
    const mediaQuery = window.matchMedia('(display-mode: standalone)')
    // Reads browser install state on mount; no way to compute this during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsInstalledApp(mediaQuery.matches)
    const userAgent = window.navigator.userAgent
    const isIosDevice = /iPhone|iPad|iPod/.test(userAgent)
    const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS/.test(userAgent)
    setIsIosInstallable(isIosDevice && isSafari && !mediaQuery.matches)

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as DeferredInstallPromptEvent)
    }

    const onInstalled = () => {
      setIsInstalledApp(true)
      setInstallPromptEvent(null)
    }

    const onDisplayModeChange = () => {
      setIsInstalledApp(mediaQuery.matches)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    mediaQuery.addEventListener('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      mediaQuery.removeEventListener('change', onDisplayModeChange)
    }
  }, [])

  useEffect(() => {
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
  }, [])

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
    if (!isParentMode) {
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
  }, [isParentMode])

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

  function persist(next: AppState) {
    setState(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function updateActiveProfile(updater: (profile: ChildProfile) => ChildProfile) {
    const nextProfiles = state.profiles.map((profile) =>
      profile.id === activeProfile.id ? updater(profile) : profile,
    )
    persist({ ...state, profiles: nextProfiles })
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

  function selectOnlyActiveChild() {
    setTaskTargetChildIds([activeProfile.id])
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
      setParentTestRegistrationEnabled(false)
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
        setParentTestRegistrationEnabled(false)
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
    setParentTestRegistrationEnabled(false)
    setIsParentUnlocked(false)
    setIsLoggedIn(true)
    setActiveTab('overview')
    setPasswordInput('')
    setShowPasswordInput(false)
    setChildPinInput('')
    setShowChildPinInput(false)
  }

  function logoutApp() {
    setIsLoggedIn(false)
    setRole('child')
    setParentPreviewChildView(false)
    setParentTestRegistrationEnabled(false)
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

  async function installApp() {
    if (isIosInstallable && !installPromptEvent) {
      window.alert('For iPhone/iPad: trykk Del-knappen i Safari og velg "Legg til på Hjem-skjerm".')
      return
    }

    if (!installPromptEvent) {
      window.alert('Installasjon er ikke tilgjengelig ennå. Prøv igjen om noen sekunder.')
      return
    }

    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice
    if (choice.outcome === 'accepted') {
      setInstallPromptEvent(null)
    }
  }

  const showFrontInstallButton = !isInstalledApp

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
      setParentTestRegistrationEnabled(false)
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
        setParentTestRegistrationEnabled(false)
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

  function removeChildProfile(profileId: string) {
    if (state.profiles.length <= 1) {
      window.alert('Du må ha minst ett barn i appen.')
      return
    }
    const profile = state.profiles.find((item) => item.id === profileId)
    if (!profile) {
      return
    }
    if (!window.confirm(`Slette profil for ${profile.childName}?`)) {
      return
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

  function removeChildPinForProfile(profileId: string) {
    if (!canManage) {
      return
    }
    if (!window.confirm('Fjerne barnekoden? Barn kan da logge inn uten kode.')) {
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

  async function importBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const next = normalizeLoadedState(parsed)
      persist(next)
      window.alert('Backup importert.')
    } catch {
      window.alert('Kunne ikke importere filen. Sjekk at den er gyldig JSON-backup.')
    } finally {
      event.target.value = ''
    }
  }

  function addEntry(taskType: 'mandatory' | 'bonus' | 'penalty', taskId: string) {
    if (!canRegisterTasksInCurrentView) {
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
        },
      ],
    }))
  }

  function removeEntry(entryId: string) {
    if (!canManage && !canRegisterTasksInCurrentView) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      entries: profile.entries.filter((entry) => entry.id !== entryId),
    }))
  }

  function addMandatoryTask(event: FormEvent) {
    event.preventDefault()
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
          requiredCount: Math.max(1, Math.floor(newMandatoryCount)),
        },
      ],
    }))
    if (!success) {
      return
    }
    setNewMandatoryName('')
    setNewMandatoryCount(1)
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
        },
      ],
    }))
    if (!success) {
      return
    }
    setNewBonusName('')
    setNewBonusPoints(1)
    setNewBonusUpForGrabs(false)
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
    const success = updateTargetProfiles((profile) => ({
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
    if (!success) {
      return
    }
    setNewPenaltyName('')
    setNewPenaltyPoints(1)
  }

  function addRewardLevel(event: FormEvent) {
    event.preventDefault()
    if (mustRenameDefaultChildBeforeTaskSetup) {
      window.alert(`Endre barnenavnet fra "${DEFAULT_CHILD_NAME}" før du lager oppgaver.`)
      return
    }
    if (!canManage || !newLevelName.trim()) {
      return
    }
    updateActiveProfile((profile) => ({
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
    setNewLevelName('')
    setNewLevelPoints(5)
    setNewLevelAmount(10)
  }

  function registerPeriodForTesting() {
    if (!canManage) {
      return
    }

    if (
      !window.confirm(
        `Registrere ${currentPeriodLabel}? Perioden lagres med utbetaling (${projectedTotalAllowance} kr), og ny test-periode starter med ren tavle.`,
      )
    ) {
      return
    }

    const settlement: Settlement = {
      id: crypto.randomUUID(),
      periodKey: currentPeriodKey,
      periodLabel: currentPeriodLabel,
      periodType: activeProfile.periodType,
      mandatoryMet,
      basePaid: mandatoryMet ? activeProfile.baseAllowance : 0,
      extraPaid: projectedExtra,
      totalPaid: projectedTotalAllowance,
      pointsEarned: netPointsThisPeriod,
      pointsAvailable: pointsAvailableNow,
      pointsSpent: projectedPointsSpent,
      carryOut: projectedCarryOut,
      reachedLevelName: reachedLevelNow?.name ?? 'Ingen nivå',
      createdAt: getInitialInterestAnchor(state.parentSettings.interestPeriod),
      withdrawnAmount: 0,
      paidAt: null,
    }

    updateActiveProfile((profile) => ({
      ...profile,
      carryPoints: projectedCarryOut,
      entries: profile.entries.filter(
        (entry) =>
          getPeriodKey(new Date(entry.timestamp), profile.periodType) !== currentPeriodKey,
      ),
      settlements: [
        settlement,
        ...profile.settlements.filter(
          (item) => !(item.periodKey === currentPeriodKey && item.periodType === profile.periodType),
        ),
      ],
    }))
  }

  function updateMandatoryTask(taskId: string, updates: Partial<MandatoryTask>) {
    if (!canManage) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      mandatoryTasks: profile.mandatoryTasks.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task,
      ),
    }))
  }

  function updateBonusTask(taskId: string, updates: Partial<BonusTask>) {
    if (!canManage) {
      return
    }
    updateActiveProfile((profile) => ({
      ...profile,
      bonusTasks: profile.bonusTasks.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task,
      ),
    }))
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
    setParentTestRegistrationEnabled(false)
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

  function registerWithdrawalFromRentAccount(event: FormEvent) {
    event.preventDefault()
    if (!canManage) {
      return
    }

    const requestedAmount = Math.floor(Math.max(0, safeNumber(withdrawalAmountInput, 0)))
    if (requestedAmount <= 0) {
      window.alert('Skriv inn et uttak større enn 0 kr.')
      return
    }

    if (requestedAmount > unpaidSettlementsTotal) {
      window.alert(`Maks uttak akkurat nå er ${unpaidSettlementsTotal} kr.`)
      return
    }

    updateActiveProfile((profile) => {
      let remaining = requestedAmount
      const updatedSettlements = [...profile.settlements]

      for (let i = updatedSettlements.length - 1; i >= 0 && remaining > 0; i -= 1) {
        const settlement = updatedSettlements[i]
        const alreadyWithdrawn = Math.max(0, settlement.withdrawnAmount ?? 0)
        const available = Math.max(0, settlement.totalPaid - alreadyWithdrawn)
        if (available === 0) {
          continue
        }

        const take = Math.min(available, remaining)
        const nextWithdrawn = alreadyWithdrawn + take
        const fullyWithdrawn = nextWithdrawn >= settlement.totalPaid

        updatedSettlements[i] = {
          ...settlement,
          withdrawnAmount: nextWithdrawn,
          paidAt: fullyWithdrawn ? settlement.paidAt ?? new Date().toISOString() : null,
        }

        remaining -= take
      }

      return {
        ...profile,
        settlements: updatedSettlements,
      }
    })

    setWithdrawalAmountInput('')
  }

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">ØrnIt</p>
          <div className="hero-title-row">
            <h1>
              <span className="hero-brand">ØrnIt</span>
              <span className="hero-slogan">Bygg vaner. Tjen smart.</span>
            </h1>
            <div className="hero-title-icons" aria-hidden="true">
              <img src="/money-bills.svg" alt="" />
              <img src="/credit-card.svg" alt="" />
            </div>
          </div>
        </div>
        <div className="hero-side">
          {showFrontInstallButton && (
            <button type="button" className="install-mini" onClick={installApp}>
              Last ned app
            </button>
          )}
          {isLoggedIn && (
            <div className="hero-meta">
              <p>
                Aktiv periode: <strong>{currentPeriodRangeLabel}</strong>
              </p>
              <div className="hero-profile-row">
                <p>
                  Aktiv profil: <strong>{hasProfiles ? activeProfile.childName : 'Ingen barn opprettet'}</strong>
                </p>
                <button type="button" className="logout-mini" onClick={logoutApp}>
                  Logg ut
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

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
        {isChildMode && (
          <button
            type="button"
            className={activeTab === 'account' ? 'primary' : ''}
            onClick={() => setActiveTab('account')}
          >
            Konto
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

      {canManage && activeTab !== 'tasks' && hasProfiles && (
        <section className="card parent-child-switch">
          <label>
            Vis barn
            <select
              value={activeProfile.id}
              onChange={(event) =>
                persist({
                  ...state,
                  activeChildId: event.target.value,
                })
              }
            >
              {state.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {formatChildNameForDisplay(profile.childName)}
                </option>
              ))}
            </select>
          </label>
          <p className="mini">
            Du ser nå progresjon og historikk for: <strong>{formatChildNameForDisplay(activeProfile.childName)}</strong>
          </p>
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
                setParentTestRegistrationEnabled(true)
                setActiveTab('overview')
              }}
            >
              Barnetest-visning
            </button>
          </div>
          <p className="mini">
            Barnetest viser barnesiden med live-data, mens du fortsatt er innlogget som forelder.
          </p>
        </section>
      )}

      {canManage && !isChildMode && activeTab === 'overview' && allChildrenProgress.length > 1 && (
        <section className="card all-children-overview">
          <h2>Progresjon for alle barn</h2>
          <p className="mini">Full oversikt med diagrammer vises for barnet du har valgt under "Vis barn".</p>
          <div className="all-children-grid">
            {allChildrenProgress.map(({ profile, mandatoryDone, mandatoryRequired, completionPct, outcome }) => (
              <button
                key={profile.id}
                type="button"
                className={`all-children-card ${profile.id === activeProfile.id ? 'is-active' : ''}`}
                onClick={() => persist({ ...state, activeChildId: profile.id })}
              >
                <strong>{formatChildNameForDisplay(profile.childName)}</strong>
                <span>
                  Obligatorisk: {mandatoryDone}/{mandatoryRequired} ({completionPct}%)
                </span>
                <span>
                  {outcome.pointsAvailable} poeng · {outcome.reachedLevelName}
                </span>
                <span>{outcome.totalPaid} kr denne perioden</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'overview' && (!isChildMode ? (
        <Suspense fallback={<section className="card">Laster foreldre-dashboard...</section>}>
          <ParentDashboard
            view="overview"
            mandatoryCompletionPct={mandatoryCompletionPct}
            mandatoryDoneTotal={mandatoryDoneTotal}
            mandatoryRequiredTotal={mandatoryRequiredTotal}
            pointsAvailableNow={pointsAvailableNow}
            netPointsThisPeriod={netPointsThisPeriod}
            reachedLevelName={reachedLevelNow?.name ?? 'Ingen nivå'}
            projectedExtra={projectedExtra}
            projectedTotalAllowance={projectedTotalAllowance}
            payoutChartData={payoutChartData}
            levelProgressData={levelProgressData}
            mandatoryProgressData={mandatoryProgressData}
            bonusContributionData={bonusContributionData}
            penaltyContributionData={penaltyContributionData}
            penaltyEnabled={state.parentSettings.penaltyEnabled}
            settlementHistoryData={settlementHistoryData}
            historyFilter={activeProfile.historyFilter}
            onHistoryFilterChange={updateHistoryFilterForActiveChild}
          />
        </Suspense>
      ) : (
        <section className="card child-focus">
          <h2>Din progresjon denne perioden</h2>
          <p className="mini">Se hvor mye du har gjort, og hvor nær du er neste nivå.</p>

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

        {canManage && <div className="settings-grid">
          {!hasProfiles && (
            <div className="period-chip">Ingen barn er opprettet ennå. Legg til barn under modulen "Barn i appen".</div>
          )}
          <label>
            Aktivt barn
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
            Grunnukelønn (kr)
            <input
              type="number"
              min={0}
              disabled={!canManage || !hasProfiles}
              value={hasProfiles ? activeProfile.baseAllowance : 0}
              onChange={(event) =>
                updateActiveProfile((profile) => ({
                  ...profile,
                  baseAllowance: Math.max(0, Math.floor(safeNumber(event.target.value))),
                }))
              }
            />
          </label>

          <label>
            Periode
            <p className="mini">Velg om barnet skal ha ukelønn eller månedslønn.</p>
            <select
              value={hasProfiles ? activeProfile.periodType : 'week'}
              disabled={!canManage || !hasProfiles}
              onChange={(event) =>
                updateActiveProfile((profile) => ({
                  ...profile,
                  periodType: event.target.value as PeriodType,
                }))
              }
            >
              <option value="week">Uke</option>
              <option value="month">Måned</option>
            </select>
          </label>

          <div className="period-chip">
            Aktiv periode: <strong>{currentPeriodLabel}</strong>
          </div>

          {canManage && (
            <div className="inline-form">
              <button type="button" onClick={registerPeriodForTesting}>
                Registrer periode
              </button>
              <p className="mini">
                For testing: lagrer opptjent i perioden og starter en ny periode uten registreringer.
              </p>
            </div>
          )}
        </div>}

        {canManage && (
          <div className="parent-tools">
            <section className="settings-module module-children">
              <h3>
                <span className="module-glyph" aria-hidden="true">N</span>
                Registrerte barn og koder
              </h3>
              <p className="mini module-subtitle">Hvert barn har egen profil med navn og innloggingskode.</p>

              {hasProfiles ? (
                <div className="children-code-grid">
                  {state.profiles.map((profile) => {
                    const isActive = profile.id === activeProfile.id
                    const canShowPlain = Boolean(profile.childPinPlain)
                    const isCodeVisible = Boolean(visibleChildCodeById[profile.id]) && canShowPlain

                    return (
                      <article key={profile.id} className="child-code-card">
                        <div className="child-code-head">
                          <strong>{profile.childName}</strong>
                          {isActive && <span className="mini">Aktivt barn</span>}
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

                        {CHILD_AUTH_ENDPOINT ? (
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
                            <div className="row-actions">
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
                            </div>
                          </>
                        )}

                        {!CHILD_AUTH_ENDPOINT && profile.childPinHash && profile.childPinSalt && !profile.childPinPlain && (
                          <p className="mini">
                            Denne koden ble lagret før synlig-kode-funksjonen. Fjern kode og generer ny hvis du vil se den.
                          </p>
                        )}

                        <div className="row-actions">
                          {!isActive && (
                            <button
                              type="button"
                              onClick={() =>
                                persist({
                                  ...state,
                                  activeChildId: profile.id,
                                })
                              }
                            >
                              Sett som aktiv
                            </button>
                          )}
                          <button type="button" className="danger" onClick={() => removeChildProfile(profile.id)}>
                            Slett barn
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <p className="mini">Legg til et barn først for å sette navn og kode.</p>
              )}
            </section>

            <section className="settings-module module-security">
              <h3>
                <span className="module-glyph" aria-hidden="true">A</span>
                Adminpanel: Foreldrekontoer
              </h3>
              <p className="mini module-subtitle">Lag brukernavn og passord for nye foreldre som skal teste appen.</p>

              {isParentAdminSession ? (
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

            <section className="settings-module module-children">
              <h3>
                <span className="module-glyph" aria-hidden="true">B</span>
                Legg til barn
              </h3>
              <p className="mini module-subtitle">Skriv navn og opprett barnet. Kode håndteres i boksen over.</p>

              <form className="inline-form" onSubmit={addChildProfile}>
                <input
                  placeholder="Legg til nytt barn"
                  value={newChildName}
                  onChange={(event) => setNewChildName(event.target.value)}
                />
                <button type="submit">Legg til nytt barn</button>
              </form>
              <p className="mini">
                Etter opprettelse dukker barnet opp i boksen "Registrerte barn og koder".
              </p>
            </section>

            <section className="settings-module module-security">
              <h3>
                <span className="module-glyph" aria-hidden="true">S</span>
                Sikkerhet
              </h3>
              <p className="mini module-subtitle">Barnesikkerhet og tips for riktig oppsett.</p>

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
              <p className="mini module-subtitle">Velg hvilke ekstraregler som gjelder for poeng og trekk.</p>
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
                Aktiver poengtrekk (ekstra innstilling)
              </label>
            </section>

            <section className="settings-module module-interest">
              <h3>
                <span className="module-glyph" aria-hidden="true">%</span>
                Renter og konto
              </h3>
              <p className="mini module-subtitle">Styr rentenivå og følg saldoen mellom innskudd og uttak.</p>
              <div className="task-targets">
                <p className="mini">Renter på ikke utbetalt saldo</p>
                <form className="inline-form" onSubmit={registerWithdrawalFromRentAccount}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="Uttak fra rentekonto (kr)"
                    value={withdrawalAmountInput}
                    onChange={(event) => setWithdrawalAmountInput(event.target.value)}
                  />
                  <button type="submit">Registrer uttak</button>
                  <button
                    type="button"
                    onClick={() => setWithdrawalAmountInput(String(unpaidSettlementsTotal))}
                  >
                    Bruk maks
                  </button>
                </form>
                <div className="settings-grid">
                  <label>
                    Rentesats (%)
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
                    Forrenting
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
                <p className="mini">
                  Rentekonto hovedsaldo: <strong>{unpaidSettlementsTotal} kr</strong>. Med renter:{' '}
                  <strong>{unpaidSettlementsTotalWithInterest} kr</strong> ({unpaidSettlementsInterest}{' '}
                  kr renter). Uttatte perioder får ikke renter.
                </p>
                <p className="mini">
                  Totalt opptjent ukelønn: <strong>{totalEarnedAllowance} kr</strong>. Totalt tatt ut:{' '}
                  <strong>{totalWithdrawnAllowance} kr</strong>.
                </p>
              </div>
            </section>

            <section className="settings-module module-targets">
              <h3>
                <span className="module-glyph" aria-hidden="true">M</span>
                Målrett oppgaver
              </h3>
              <p className="mini module-subtitle">Velg hvilke barn nye oppgaver skal legges til for.</p>
              <div className="task-targets">
                <p className="mini">Nye oppgaver blir lagt til for avkryssede barn:</p>
                <div className="target-quick-actions">
                  <button type="button" onClick={selectAllTargetChildren}>
                    Velg alle
                  </button>
                  <button type="button" onClick={clearTargetChildren}>
                    Fjern alle
                  </button>
                  <button type="button" onClick={selectOnlyActiveChild}>
                    Kun aktivt barn
                  </button>
                </div>
                {taskTargetChildIds.length === 0 && (
                  <p className="mini">Ingen valgt. Velg minst ett barn for å legge til oppgaver.</p>
                )}
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
            </section>

            <section className="settings-module module-backup">
              <h3>
                <span className="module-glyph" aria-hidden="true">D</span>
                Backup og eksport
              </h3>
              <p className="mini module-subtitle">Ta backup, hent ut historikk og importer data ved behov.</p>
              <div className="task-targets">
                <div className="target-quick-actions">
                  <button type="button" onClick={exportBackupJson}>
                    Eksporter backup (JSON)
                  </button>
                  <button type="button" onClick={exportSettlementsCsv}>
                    Eksporter utbetalinger (CSV)
                  </button>
                  <button type="button" onClick={() => importInputRef.current?.click()}>
                    Importer backup
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
        <h2>Status nå - {activeProfile.childName}</h2>
        <div className="kpi-grid">
          <article>
            <p>Opparbeidet ukelønn nå</p>
            <strong>{projectedTotalAllowance} kr</strong>
          </article>
          <article>
            <p>Obligatoriske oppgaver</p>
            <strong>{mandatoryMet ? 'Krav oppfylt' : 'Krav ikke oppfylt'}</strong>
          </article>
          <article>
            <p>Opptjente poeng</p>
            <strong>{bonusPointsThisPeriod} poeng</strong>
          </article>
          {state.parentSettings.penaltyEnabled && (
            <article>
              <p>Poengtrekk</p>
              <strong>-{penaltyPointsThisPeriod} poeng</strong>
            </article>
          )}
          <article>
            <p>Netto poeng denne perioden</p>
            <strong>{netPointsThisPeriod} poeng</strong>
          </article>
          {!isChildMode && (
            <article>
              <p>Rentekonto saldo</p>
              <strong>{unpaidSettlementsTotalWithInterest} kr</strong>
              <span>{unpaidSettlementsInterest} kr renter (kun uten uttak)</span>
            </article>
          )}
          {!isChildMode && (
            <article>
              <p>Totalt opptjent ukelønn</p>
              <strong>{totalEarnedAllowance} kr</strong>
              <span>Fra avsluttede perioder</span>
            </article>
          )}
          {!isChildMode && (
            <article>
              <p>Totalt tatt ut</p>
              <strong>{totalWithdrawnAllowance} kr</strong>
              <span>Markert som utbetalt</span>
            </article>
          )}
        </div>
        <p className="summary-line">
          Nivå nå: <strong>{reachedLevelNow?.name ?? 'Ingen nivå ennå'}</strong>. Poeng som blir
          med videre: <strong>{projectedCarryOut}</strong>. Overført inn i perioden:{' '}
          <strong>{activeProfile.carryPoints}</strong>.
        </p>
        {!isChildMode && <p className="summary-line summary-secondary">Trend: <strong>{payoutTrendLabel}</strong>.</p>}
        {!isChildMode && <p className="summary-line summary-secondary">
          Mest verdifulle ekstraoppgave: <strong>{topBonusTask ? `${topBonusTask.name} (${topBonusTask.points} poeng)` : 'Ingen registrert enda'}</strong>.
        </p>}
        {isChildMode && (
          <p className="summary-line summary-secondary">Se Konto-fanen for sparepenger, renter og totalsaldo.</p>
        )}
        {canManage && !isChildMode && (
          <div className="row-actions">
            <p className="mini">Perioder avsluttes automatisk ved periodeskifte.</p>
            <p className="mini">Utbetalt denne måneden: {paidThisMonthTotal} kr</p>
          </div>
        )}
      </section>}

      {activeTab === 'overview' && canManage && !isChildMode && <section className="card rent-account-card">
        <h2>Rentekonto</h2>
        <p className="mini">
          Renter beregnes kun for perioder som ikke er markert som utbetalt.
        </p>
        <div className="rent-account-table-wrap">
          <table className="rent-account-table">
            <tbody>
              <tr>
                <th scope="row">Totalt opptjent ukelønn (innskudd)</th>
                <td>{totalEarnedAllowance} kr</td>
              </tr>
              <tr>
                <th scope="row">Aktiv rentesats</th>
                <td>
                  {state.parentSettings.interestRatePct}% per{' '}
                  {state.parentSettings.interestPeriod === 'week'
                    ? 'uke'
                    : state.parentSettings.interestPeriod === 'month'
                      ? 'måned'
                      : 'år'}
                </td>
              </tr>
              <tr>
                <th scope="row">Totalt tatt ut (uttak)</th>
                <td>{totalWithdrawnDisplay}</td>
              </tr>
              <tr>
                <th scope="row">
                  Opptjente renter ({state.parentSettings.interestRatePct}% per{' '}
                  {state.parentSettings.interestPeriod === 'week'
                    ? 'uke'
                    : state.parentSettings.interestPeriod === 'month'
                      ? 'måned'
                      : 'år'})
                </th>
                <td>+{unpaidSettlementsInterest} kr</td>
              </tr>
              <tr className="rent-account-total-row">
                <th scope="row">Rentekonto saldo med renter</th>
                <td>{unpaidSettlementsTotalWithInterest} kr</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>}

      {activeTab === 'account' && isChildMode && <section className="card child-savings-card">
        <h2>Sparegrisen din</h2>
        <p className="mini">Pengene her kan vokse med renter når de blir stående.</p>
        <p className="mini">
          Aktiv rentesats: {state.parentSettings.interestRatePct}% per{' '}
          {state.parentSettings.interestPeriod === 'week'
            ? 'uke'
            : state.parentSettings.interestPeriod === 'month'
              ? 'måned'
              : 'år'}.
        </p>
        <div className="kpi-grid child-savings-kpis">
          <article>
            <p>Sparepenger nå</p>
            <strong>{unpaidSettlementsTotalWithInterest} kr</strong>
          </article>
          <article>
            <p>Ekstra fra renter</p>
            <strong>{unpaidSettlementsInterest} kr</strong>
          </article>
        </div>
        <p className="summary-line summary-secondary">
          Når penger tas ut, stopper renter på den delen.
        </p>
      </section>}

      {activeTab === 'account' && isChildMode && <section className="card">
        <h2>Kontooversikt</h2>
        <p className="mini">Her ser du hva som er tjent opp totalt og hva som eventuelt er tatt ut.</p>
        <div className="kpi-grid child-savings-kpis">
          <article>
            <p>Totalt opptjent</p>
            <strong>{totalEarnedAllowance} kr</strong>
          </article>
          <article>
            <p>Totalt tatt ut</p>
            <strong>{totalWithdrawnAllowance} kr</strong>
          </article>
          <article>
            <p>Hovedsaldo</p>
            <strong>{unpaidSettlementsTotal} kr</strong>
          </article>
        </div>
      </section>}

      {activeTab === 'tasks' && <section className="grid-two">
        {isChildMode && !canRegisterTasks && (
          <div className="card chart-span-2">
            <p className="mini">
              Du er i barnetest-visning som forelder. For å registrere utførte oppgaver må du logge
              inn som barnet.
            </p>
            <label className="mini remember-check">
              <input
                type="checkbox"
                checked={parentTestRegistrationEnabled}
                onChange={(event) => setParentTestRegistrationEnabled(event.target.checked)}
              />
              Aktiver testregistrering i denne visningen
            </label>
            {parentTestRegistrationEnabled && (
              <p className="mini">
                Testregistrering er aktiv. Klikk på + Registrer utført for å simulere barnet.
              </p>
            )}
          </div>
        )}
        {canManageTaskSetup && (
          <div className="card chart-span-2">
            <p className="mini">
              Barn registrerer utførte oppgaver. Du som forelder kan følge alt under fanen
              Registreringer.
            </p>
            <p className="mini">
              Oppgavefanen gjelder alle registrerte barn: bruk avkrysningene ved registrering av
              nye oppgaver for å velge hvem oppgaven gjelder for.
            </p>
            <label className="mini remember-check">
              <input
                type="checkbox"
                checked={parentTestRegistrationEnabled}
                onChange={(event) => setParentTestRegistrationEnabled(event.target.checked)}
              />
              Aktiver testregistrering i foreldremodus
            </label>
            {parentTestRegistrationEnabled && (
              <p className="mini">Testregistrering er aktiv: du kan simulere barnets registreringer her.</p>
            )}
          </div>
        )}
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
          <ul className="task-list">
            {activeProfile.mandatoryTasks.map((task) => (
              <li key={task.id}>
                <div>
                  {canManageTaskSetup ? (
                    <input
                      value={task.name}
                      disabled={!canManageTaskSetup}
                      onChange={(event) => updateMandatoryTask(task.id, { name: event.target.value })}
                    />
                  ) : (
                    <strong>{task.name}</strong>
                  )}
                  <div className="mandatory-meta-line">
                    <span className="mini">Må gjøres</span>
                    {canManageTaskSetup ? (
                      <input
                        className="required-count-inline"
                        type="number"
                        min={1}
                        disabled={!canManageTaskSetup}
                        value={task.requiredCount}
                        onChange={(event) =>
                          updateMandatoryTask(task.id, {
                            requiredCount: Math.max(
                              1,
                              Math.floor(safeNumber(event.target.value, task.requiredCount)),
                            ),
                          })
                        }
                      />
                    ) : (
                      <strong>{task.requiredCount}</strong>
                    )}
                    <span className="mini">ganger</span>
                    <span className="mini mandatory-registered">
                      Registrert: {mandatoryCountMap[task.id] ?? 0} / {task.requiredCount}
                    </span>
                  </div>
                  {(canManage || canRegisterTasksInCurrentView) && (
                    <ul className="registered-dates">
                      {currentPeriodEntries
                        .filter((entry) => entry.taskType === 'mandatory' && entry.taskId === task.id)
                        .map((entry) => (
                          <li key={entry.id}>
                            <span>
                              {new Date(entry.timestamp).toLocaleDateString('nb-NO', {
                                weekday: 'short',
                                day: '2-digit',
                                month: '2-digit',
                              })}
                            </span>
                            <button
                              type="button"
                              className="remove-date"
                              onClick={() => removeEntry(entry.id)}
                              aria-label={`Fjern registrering av ${task.name}`}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                  {canManageTaskSetup && (
                    <p className="mini task-applies-to">
                      Gjelder for: {getChildrenForTask('mandatory', task.name, task.requiredCount).join(', ') || 'Ingen'}
                    </p>
                  )}
                </div>
                <div className="row-actions">
                  {(isChildMode || (canManage && parentTestRegistrationEnabled)) && (
                    <button
                      type="button"
                      className="register-plus"
                      onClick={() => addEntry('mandatory', task.id)}
                      disabled={!canRegisterTasksInCurrentView}
                      aria-label={`Registrer ${task.name} som utført`}
                    >
                      + Registrer utført
                    </button>
                  )}
                  {canManageTaskSetup && (
                    <button
                      type="button"
                      className="danger"
                      disabled={!canManageTaskSetup}
                      onClick={() => removeMandatoryTask(task.id)}
                    >
                      Slett
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {canManageTaskSetup && (
            <div className="task-targets compact-targets">
              <p className="mini">Oppgaven gjelder for:</p>
              <label className="target-pill">
                <input
                  type="checkbox"
                  checked={taskTargetChildIds.length === state.profiles.length}
                  onChange={(event) =>
                    event.target.checked ? selectAllTargetChildren() : clearTargetChildren()
                  }
                />
                Alle barn
              </label>
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
            <form className="inline-form" onSubmit={addMandatoryTask}>
              <input
                placeholder="Ny obligatorisk oppgave"
                value={newMandatoryName}
                onChange={(event) => setNewMandatoryName(event.target.value)}
              />
              <input
                type="number"
                min={1}
                value={newMandatoryCount}
                onChange={(event) =>
                  setNewMandatoryCount(Math.max(1, safeNumber(event.target.value, 1)))
                }
              />
              <button type="submit">Legg til</button>
            </form>
          )}
        </div>

        <div className="card">
          <h2>Ekstraoppgaver og poeng</h2>
          {!canRegisterTasksInCurrentView && <p className="mini">Kun barn kan registrere utførte oppgaver.</p>}

          <ul className="task-list">
            {canManageTaskSetup
              ? sortedBonusTasks.map((task) => {
                  const taskKey = getBonusTaskKey(task.name, task.points)
                  const alreadyTaken = task.upForGrabs
                    ? (sharedBonusCountByTaskKey.get(taskKey) ?? 0) > 0
                    : (bonusCountMap[task.id] ?? 0) > 0
                  const takenByChild = task.upForGrabs
                    ? bonusTakenByChildByTaskKey.get(taskKey)
                    : activeProfile.childName
                  return (
                  <li key={task.id}>
                    <div>
                      <input
                        value={task.name}
                        disabled={!canManageTaskSetup}
                        onChange={(event) => updateBonusTask(task.id, { name: event.target.value })}
                      />
                      <div className="bonus-meta-line">
                        <span className="mini">Poeng</span>
                        <input
                          className="required-count-inline"
                          type="number"
                          min={1}
                          disabled={!canManageTaskSetup}
                          value={task.points}
                          onChange={(event) =>
                            updateBonusTask(task.id, {
                              points: Math.max(1, Math.floor(safeNumber(event.target.value, task.points))),
                            })
                          }
                        />
                        <label className="mini up-for-grabs-toggle">
                          <input
                            type="checkbox"
                            disabled={!canManageTaskSetup}
                            checked={task.upForGrabs}
                            onChange={(event) => updateBonusTask(task.id, { upForGrabs: event.target.checked })}
                          />
                          Up for grabs
                        </label>
                        <span className="mini bonus-registered">
                          {alreadyTaken
                            ? task.upForGrabs
                              ? `Tatt av ${takenByChild ?? 'noen'}`
                              : 'Gjort denne perioden'
                            : 'Ikke tatt ennå'}
                        </span>
                        {canRegisterTasksInCurrentView && (
                          <button
                            type="button"
                            onClick={() => addEntry('bonus', task.id)}
                            disabled={alreadyTaken}
                          >
                            {alreadyTaken ? 'Tatt' : 'Registrer utført'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="danger"
                          disabled={!canManageTaskSetup}
                          onClick={() => removeBonusTask(task.id)}
                        >
                          Slett
                        </button>
                      </div>
                      <p className="mini task-applies-to">
                        Gjelder for: {getChildrenForTask('bonus', task.name, task.points).join(', ') || 'Ingen'}
                      </p>
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
                    canRegisterTasksInCurrentView && Boolean(activeChildTask) && !alreadyTaken
                  return (
                    <li key={task.key}>
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
          <div className="task-targets compact-targets bonus-log">
            <p className="mini">Registrerte ekstraoppgaver i perioden (alle barn, nyeste nederst):</p>
            <ul className="log-list">
              {sharedBonusEntriesThisPeriod.length === 0 && <li>Ingen registreringer ennå.</li>}
              {sharedBonusEntriesThisPeriod.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.taskName}</strong>
                  <p className="mini">{entry.childName} tok oppgaven og fikk {entry.points} poeng.</p>
                  <p className="mini">{new Date(entry.timestamp).toLocaleTimeString('nb-NO')}</p>
                </li>
              ))}
            </ul>
          </div>

          {canManageTaskSetup && (
            <div className="task-targets compact-targets">
              <p className="mini">Oppgaven gjelder for:</p>
              <label className="target-pill">
                <input
                  type="checkbox"
                  checked={taskTargetChildIds.length === state.profiles.length}
                  onChange={(event) =>
                    event.target.checked ? selectAllTargetChildren() : clearTargetChildren()
                  }
                />
                Alle barn
              </label>
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
            <form className="inline-form bonus-form" onSubmit={addBonusTask}>
              <input
                placeholder="Ny ekstraoppgave"
                value={newBonusName}
                onChange={(event) => setNewBonusName(event.target.value)}
              />
              <label className="mini">
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
              <label className="mini up-for-grabs-toggle">
                <input
                  type="checkbox"
                  checked={newBonusUpForGrabs}
                  onChange={(event) => setNewBonusUpForGrabs(event.target.checked)}
                />
                Up for grabs
              </label>
              <button type="submit">Legg til</button>
            </form>
          )}

          {state.parentSettings.penaltyEnabled && (
            <>
              <h2>Trekk-oppgaver</h2>
              <ul className="task-list">
                {activeProfile.penaltyTasks.map((task) => (
                  <li key={task.id}>
                    <div>
                      {canManageTaskSetup ? (
                        <input
                          value={task.name}
                          disabled={!canManageTaskSetup}
                          onChange={(event) => updatePenaltyTask(task.id, { name: event.target.value })}
                        />
                      ) : (
                        <strong>{task.name}</strong>
                      )}
                      <label className="mini">
                        Trekkpoeng
                        <input
                          type="number"
                          min={1}
                          disabled={!canManageTaskSetup}
                          value={task.points}
                          onChange={(event) =>
                            updatePenaltyTask(task.id, {
                              points: Math.max(1, Math.floor(safeNumber(event.target.value, task.points))),
                            })
                          }
                        />
                      </label>
                      {canManageTaskSetup && (
                        <p className="mini task-applies-to">
                          Gjelder for: {getChildrenForTask('penalty', task.name, task.points).join(', ') || 'Ingen'}
                        </p>
                      )}
                    </div>
                    <div className="row-actions">
                      {canRegisterTasksInCurrentView && (
                        <button type="button" onClick={() => addEntry('penalty', task.id)}>
                          Registrer trekk
                        </button>
                      )}
                      {canManageTaskSetup && (
                        <button
                          type="button"
                          className="danger"
                          disabled={!canManageTaskSetup}
                          onClick={() => removePenaltyTask(task.id)}
                        >
                          Slett
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {canManageTaskSetup && (
                <div className="task-targets compact-targets">
                  <p className="mini">Oppgaven gjelder for:</p>
                  <label className="target-pill">
                    <input
                      type="checkbox"
                      checked={taskTargetChildIds.length === state.profiles.length}
                      onChange={(event) =>
                        event.target.checked ? selectAllTargetChildren() : clearTargetChildren()
                      }
                    />
                    Alle barn
                  </label>
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
                <form className="inline-form" onSubmit={addPenaltyTask}>
                  <input
                    placeholder="Ny trekk-oppgave"
                    value={newPenaltyName}
                    onChange={(event) => setNewPenaltyName(event.target.value)}
                  />
                  <input
                    type="number"
                    min={1}
                    value={newPenaltyPoints}
                    onChange={(event) =>
                      setNewPenaltyPoints(Math.max(1, safeNumber(event.target.value, 1)))
                    }
                  />
                  <button type="submit">Legg til trekk</button>
                </form>
              )}
            </>
          )}
        </div>
      </section>}

      {(activeTab === 'tasks' || activeTab === 'logs') && (
      <section className={`grid-two ${activeTab === 'logs' ? 'single-col' : ''}`}>
        {activeTab === 'tasks' && canManageTaskSetup && <div className="card">
          <h2>Nivåer for ekstra lønn</h2>
          <ul className="task-list">
            {sortedLevels.map((level) => (
              <li key={level.id}>
                <div>
                  {canManageTaskSetup ? (
                    <input
                      value={level.name}
                      disabled={!canManageTaskSetup}
                      onChange={(event) => updateLevel(level.id, { name: event.target.value })}
                    />
                  ) : (
                    <strong>{level.name}</strong>
                  )}
                  <label className="mini">
                    Min. poeng
                    <input
                      type="number"
                      min={1}
                      disabled={!canManageTaskSetup}
                      value={level.minPoints}
                      onChange={(event) =>
                        updateLevel(level.id, {
                          minPoints: Math.max(
                            1,
                            Math.floor(safeNumber(event.target.value, level.minPoints)),
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="mini">
                    Ekstra kr
                    <input
                      type="number"
                      min={0}
                      disabled={!canManageTaskSetup}
                      value={level.extraAmount}
                      onChange={(event) =>
                        updateLevel(level.id, {
                          extraAmount: Math.max(
                            0,
                            Math.floor(safeNumber(event.target.value, level.extraAmount)),
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                {canManageTaskSetup && (
                  <button
                    type="button"
                    className="danger"
                    disabled={!canManageTaskSetup}
                    onClick={() => removeLevel(level.id)}
                  >
                    Slett
                  </button>
                )}
              </li>
            ))}
          </ul>

          {canManageTaskSetup && (
            <form className="inline-form level-form" onSubmit={addRewardLevel}>
              <input
                placeholder="Nivånavn"
                value={newLevelName}
                onChange={(event) => setNewLevelName(event.target.value)}
              />
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
        </div>}

        {activeTab === 'logs' && <div className="card">
          <h2>Registreringer ({currentPeriodLabel})</h2>
          <ul className="log-list">
            {currentPeriodEntries.length === 0 && <li>Ingen registreringer ennå i denne perioden.</li>}
            {currentPeriodEntries.map((entry) => {
              const taskName =
                entry.taskType === 'mandatory'
                  ? activeProfile.mandatoryTasks.find((task) => task.id === entry.taskId)?.name
                  : entry.taskType === 'bonus'
                    ? activeProfile.bonusTasks.find((task) => task.id === entry.taskId)?.name
                    : activeProfile.penaltyTasks.find((task) => task.id === entry.taskId)?.name

              return (
                <li key={entry.id}>
                  <div>
                    <strong>{taskName ?? 'Ukjent oppgave'}</strong>
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
                  {canManage && (
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
            })}
          </ul>
        </div>}
      </section>
      )}

      {activeTab === 'history' && isParentMode && !isChildMode && (
        <Suspense fallback={<section className="card">Laster historikk...</section>}>
          <ParentDashboard
            view="history"
            mandatoryCompletionPct={mandatoryCompletionPct}
            mandatoryDoneTotal={mandatoryDoneTotal}
            mandatoryRequiredTotal={mandatoryRequiredTotal}
            pointsAvailableNow={pointsAvailableNow}
            netPointsThisPeriod={netPointsThisPeriod}
            reachedLevelName={reachedLevelNow?.name ?? 'Ingen nivå'}
            projectedExtra={projectedExtra}
            projectedTotalAllowance={projectedTotalAllowance}
            payoutChartData={payoutChartData}
            levelProgressData={levelProgressData}
            mandatoryProgressData={mandatoryProgressData}
            bonusContributionData={bonusContributionData}
            penaltyContributionData={penaltyContributionData}
            penaltyEnabled={state.parentSettings.penaltyEnabled}
            settlementHistoryData={settlementHistoryData}
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
                    {settlement.mandatoryMet
                      ? `${activeProfile.childName} fikk grunnlønn`
                      : `${activeProfile.childName} manglet obligatoriske oppgaver`}
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
    </main>
  )
}

export default App
