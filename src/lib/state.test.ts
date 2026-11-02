import { describe, expect, it } from 'vitest'
import { createDefaultProfile, initialState, normalizeLoadedState, parseBackupState } from './state'
import { bankSummary } from './bank'
import type { Settlement } from '../types'

describe('state migration and backup', () => {
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
