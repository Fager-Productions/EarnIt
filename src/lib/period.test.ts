import { describe, expect, it } from 'vitest'
import { getIsoWeekKey, getMonthKey, getPeriodKey } from './period'

describe('period keys', () => {
  it('starts a new weekly period on Monday', () => {
    expect(getPeriodKey(new Date('2026-09-13T12:00:00'), 'week')).toBe('2026-W36')
    expect(getPeriodKey(new Date('2026-09-14T00:00:00'), 'week')).toBe('2026-W37')
  })

  it('keeps bonus carry periods separate from the new month', () => {
    expect(getMonthKey(new Date('2026-09-30T23:59:59'))).toBe('2026-09')
    expect(getMonthKey(new Date('2026-10-01T00:00:00'))).toBe('2026-10')
  })

  it('uses the ISO year for dates around New Year', () => {
    expect(getIsoWeekKey(new Date('2026-01-01T12:00:00'))).toBe('2026-W01')
    expect(getIsoWeekKey(new Date('2027-01-01T12:00:00'))).toBe('2026-W53')
  })
})