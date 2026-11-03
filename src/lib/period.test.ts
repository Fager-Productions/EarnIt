import { describe, expect, it } from 'vitest'
import {
  getIsoWeekKey,
  getMonthKey,
  getPeriodKey,
  getPeriodSummaryLabel,
  isBonusTaskAvailableInPeriod,
} from './period'

describe('period keys', () => {
  it('starts a new weekly period on Monday', () => {
    expect(getPeriodKey(new Date('2026-09-13T12:00:00'), 'week')).toBe('2026-W37')
    expect(getPeriodKey(new Date('2026-09-14T00:00:00'), 'week')).toBe('2026-W38')
  })

  it('counts weeks correctly across daylight-saving time', () => {
    expect(getIsoWeekKey(new Date('2026-10-04T12:00:00'))).toBe('2026-W40')
    expect(getIsoWeekKey(new Date('2026-10-05T00:00:00'))).toBe('2026-W41')
  })

  it('keeps bonus carry periods separate from the new month', () => {
    expect(getMonthKey(new Date('2026-09-30T23:59:59'))).toBe('2026-09')
    expect(getMonthKey(new Date('2026-10-01T00:00:00'))).toBe('2026-10')
  })

  it('uses the ISO year for dates around New Year', () => {
    expect(getIsoWeekKey(new Date('2026-01-01T12:00:00'))).toBe('2026-W01')
    expect(getIsoWeekKey(new Date('2027-01-01T12:00:00'))).toBe('2026-W53')
  })

  it('labels past weekly periods with their week number and date range', () => {
    expect(getPeriodSummaryLabel('2026-W44', 'week')).toBe('Uke 44 (2026) · 26.10.2026–01.11.2026')
  })

  it('expires one-period bonus tasks while preserving recurring and legacy tasks', () => {
    const onePeriodTask = {
      id: 'one-off', name: 'Rake løv', points: 2, upForGrabs: false,
      repeatEachPeriod: false, createdPeriodKey: '2026-W37',
    }
    expect(isBonusTaskAvailableInPeriod(onePeriodTask, '2026-W37')).toBe(true)
    expect(isBonusTaskAvailableInPeriod(onePeriodTask, '2026-W38')).toBe(false)
    expect(isBonusTaskAvailableInPeriod({ ...onePeriodTask, repeatEachPeriod: true }, '2026-W38')).toBe(true)
    expect(isBonusTaskAvailableInPeriod({ ...onePeriodTask, repeatEachPeriod: undefined }, '2026-W38')).toBe(true)
    expect(isBonusTaskAvailableInPeriod({ ...onePeriodTask, createdPeriodKey: undefined }, '2026-W38')).toBe(true)
  })
})