import type { Entry, PeriodType } from '../types'
import type { InterestPeriod } from './coreLogic'

export function startOfWeek(input: Date): Date {
  const d = new Date(input)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function getIsoWeekKey(date: Date): string {
  const weekStart = startOfWeek(date)
  const yearStart = startOfWeek(new Date(weekStart.getFullYear(), 0, 4))
  const days = Math.floor((weekStart.getTime() - yearStart.getTime()) / 86400000)
  const week = Math.floor(days / 7) + 1
  return `${weekStart.getFullYear()}-W${String(week).padStart(2, '0')}`
}

export function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function getPeriodKey(date: Date, periodType: PeriodType): string {
  return periodType === 'week' ? getIsoWeekKey(date) : getMonthKey(date)
}

export function getPeriodLabel(periodKey: string, periodType: PeriodType): string {
  if (periodType === 'week') {
    return `Uke ${periodKey.split('-W')[1]} (${periodKey.split('-W')[0]})`
  }
  const [year, month] = periodKey.split('-')
  return `${month}.${year}`
}

export function getPeriodStartDate(periodKey: string, periodType: PeriodType): Date {
  if (periodType === 'month') {
    const [year, month] = periodKey.split('-').map((value) => Number(value))
    return new Date(year, month - 1, 1)
  }

  const [yearText, weekText] = periodKey.split('-W')
  const year = Number(yearText)
  const week = Number(weekText)
  const jan4 = new Date(year, 0, 4)
  const weekOneStart = startOfWeek(jan4)
  const date = new Date(weekOneStart)
  date.setDate(weekOneStart.getDate() + (week - 1) * 7)
  return date
}

export function formatDateRangeLabel(date: Date, periodType: PeriodType): string {
  const formatDate = (value: Date) =>
    value.toLocaleDateString('nb-NO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

  if (periodType === 'week') {
    const from = startOfWeek(date)
    const to = new Date(from)
    to.setDate(from.getDate() + 6)
    return `Uke (${formatDate(from)} - ${formatDate(to)})`
  }

  const from = new Date(date.getFullYear(), date.getMonth(), 1)
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return `Måned (${formatDate(from)} - ${formatDate(to)})`
}

export function getInitialInterestAnchor(interestPeriod: InterestPeriod): string {
  const anchor = new Date()
  if (interestPeriod === 'week') {
    anchor.setDate(anchor.getDate() - 7)
  } else if (interestPeriod === 'month') {
    anchor.setMonth(anchor.getMonth() - 1)
  } else {
    anchor.setFullYear(anchor.getFullYear() - 1)
  }
  return anchor.toISOString()
}

export function isEntryInCurrentPeriod(entry: Entry, periodType: PeriodType, periodKey: string): boolean {
  return getPeriodKey(new Date(entry.timestamp), periodType) === periodKey
}
