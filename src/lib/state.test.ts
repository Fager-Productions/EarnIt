import { describe, expect, it } from 'vitest'
import { createDefaultProfile, initialState, normalizeLoadedState, parseBackupState } from './state'
import { bankSummary } from './bank'
import { settlePastPeriods } from './settlement'
import type { Settlement } from '../types'

describe('state migration and backup', () => {
  it('defaults claimant visibility on and preserves an explicit opt-out', () => {
    const settings = { ...initialState.parentSettings, showSharedTaskClaimant: undefined }
    expect(normalizeLoadedState({ ...initialState, parentSettings: settings })
      .parentSettings.showSharedTaskClaimant).toBe(true)
    expect(normalizeLoadedState({
      ...initialState, parentSettings: { ...settings, showSharedTaskClaimant: false },
    }).parentSettings.showSharedTaskClaimant).toBe(false)
  })

  it('defaults both task modes to enabled for existing profiles', () => {
    const profile = { ...createDefaultProfile(), mandatoryTasksEnabled: undefined, bonusLevelsEnabled: undefined }
    const normalized = normalizeLoadedState({
      ...initialState, profiles: [profile], activeChildId: profile.id,
    })
    expect(normalized.profiles[0]).toMatchObject({
      mandatoryTasksEnabled: true,
      bonusLevelsEnabled: true,
    })
  })

  it('preserves saved data and cumulative bonus settlements through reloads and mode changes', () => {
    const settlement: Settlement = {
      id: 'saved', periodKey: '2026-W02', periodLabel: 'Uke 02', periodType: 'week',
      mandatoryMet: true, basePaid: 100, extraPaid: 35, totalPaid: 135,
      pointsEarned: 10, pointsAvailable: 17, pointsSpent: 10, carryOut: 7,
      reachedLevelName: 'Sølv', createdAt: '2026-01-12T00:00:00Z',
      withdrawnAmount: 35, paidAt: null,
    }
    const profile = {
      ...createDefaultProfile('Testbarn'),
      allowanceStartAt: '2026-01-05T10:00:00Z',
      mandatoryTasksEnabled: undefined,
      bonusLevelsEnabled: undefined,
      mandatoryTasks: [{ id: 'm1', name: 'Rydde rom', requiredCount: 2 }],
      bonusTasks: [{ id: 'b1', name: 'Vaske bil', points: 5, upForGrabs: false, repeatEachPeriod: true }],
      rewardLevels: [
        { id: 'l1', name: 'Bronse', minPoints: 5, extraAmount: 10 },
        { id: 'l2', name: 'Sølv', minPoints: 10, extraAmount: 25 },
      ],
      entries: [{
        id: 'entry', taskType: 'bonus' as const, taskId: 'b1',
        timestamp: '2026-01-05T10:00:00Z', periodType: 'week' as const, points: 5,
      }],
      settlements: [settlement],
      carryPoints: 7,
      transactions: [
        { id: 'salary-saved', type: 'salary' as const, amount: 135, timestamp: settlement.createdAt, settlementId: settlement.id },
        { id: 'withdrawal', type: 'withdrawal' as const, amount: -35, timestamp: '2026-01-13T10:00:00Z' },
      ],
    }
    const saved = JSON.stringify({ ...initialState, profiles: [profile], activeChildId: profile.id })
    const loaded = normalizeLoadedState(JSON.parse(saved))
    const reloaded = normalizeLoadedState(JSON.parse(JSON.stringify(loaded))).profiles[0]
    expect(reloaded).toEqual({ ...profile, mandatoryTasksEnabled: true, bonusLevelsEnabled: true })
    expect(bankSummary(reloaded).balance).toBe(100)

    const settled = settlePastPeriods(
      { ...reloaded, mandatoryTasksEnabled: false, bonusLevelsEnabled: false },
      'month', false, true, new Date('2026-01-19T12:00:00Z'), false, false,
    )
    expect(settled.settlements.find(item => item.id === settlement.id)).toEqual(settlement)
    expect(settled.entries).toEqual(profile.entries)
    expect(settled.transactions).toEqual(profile.transactions)
    expect(settled.carryPoints).toBe(7)
    expect(bankSummary(settled).balance).toBe(100)
  })

  it('never restores an already paid legacy settlement as available money', () => {
    const profile = createDefaultProfile()
    const settlement: Settlement = {
      id: 'old', periodKey: '2026-W01', periodLabel: 'Uke 01', periodType: 'week',
      mandatoryMet: true, basePaid: 100, extraPaid: 0, totalPaid: 100,
      pointsEarned: 0, pointsAvailable: 0, pointsSpent: 0, carryOut: 0,
      reachedLevelName: 'Ingen nivå', createdAt: '2026-01-05T00:00:00Z',
      withdrawnAmount: 100, paidAt: '2026-01-06T00:00:00Z',
    }
    const legacy = { ...profile, transactions: undefined, settlements: [{ ...settlement, withdrawnAmount: undefined }] }
    const migrated = normalizeLoadedState({ ...initialState, profiles: [legacy], activeChildId: legacy.id })
    expect(migrated.profiles[0].settlements[0].withdrawnAmount).toBe(100)
    expect(bankSummary(migrated.profiles[0])).toMatchObject({ balance: 0, withdrawn: 100 })
  })

  it('migrates old manual deposits exactly once across reloads', () => {
    const profile = { ...createDefaultProfile(), transactions: undefined, bankDeposits: 123 }
    const once = normalizeLoadedState({ ...initialState, profiles: [profile] })
    const twice = normalizeLoadedState(JSON.parse(JSON.stringify(once)))
    expect(bankSummary(twice.profiles[0]).balance).toBe(123)
    expect(twice.profiles[0].transactions).toHaveLength(1)
  })

  it('keeps legacy bonus tasks recurring when loading older profiles', () => {
    const profile = {
      ...createDefaultProfile(),
      bonusTasks: [{ id: 'legacy', name: 'Eldre bonus', points: 2, upForGrabs: false }],
    }
    const normalized = normalizeLoadedState({
      ...initialState, profiles: [profile], activeChildId: profile.id,
    })
    expect(normalized.profiles[0].bonusTasks[0].repeatEachPeriod).toBe(true)
  })

  it('accepts a real backup and rejects unrelated JSON or malformed financial values', () => {
    expect(parseBackupState(initialState).profiles).toHaveLength(1)
    expect(() => parseBackupState({ hello: 'world' })).toThrow()
    const profile = createDefaultProfile()
    expect(() => parseBackupState({ ...initialState, profiles: [{ ...profile, transactions: [{ id: 'bad', amount: '100' }] }] })).toThrow()
    expect(() => parseBackupState({ ...initialState, profiles: [{ ...profile, transactions: [{
      id: 'bad', type: 'deposit', timestamp: new Date().toISOString(),
    }] }] })).toThrow()
  })
})
