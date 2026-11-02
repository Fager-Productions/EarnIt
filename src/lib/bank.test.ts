import { describe, expect, it } from 'vitest'
import { accrueBankInterest, bankSummary, depositToBank, resetInterestSchedule, withdrawFromBank } from './bank'
import { createDefaultProfile } from './state'

const month = { interestRatePct: 10, interestPeriod: 'month' as const }
const at = (date: string) => new Date(`${date}T12:00:00`)

describe('bank ledger', () => {
  it('credits real interest only after a complete period and makes all of it withdrawable', () => {
    const deposited = depositToBank(createDefaultProfile(), 100, at('2026-01-01'))
    expect(bankSummary(accrueBankInterest(deposited, month, at('2026-01-31'))).balance).toBe(100)
    const accrued = accrueBankInterest(deposited, month, at('2026-02-01'))
    expect(bankSummary(accrued)).toMatchObject({ balance: 110, interest: 10, principal: 100 })
    const withdrawn = withdrawFromBank(accrued, 110, at('2026-02-01'))
    expect(bankSummary(withdrawn)).toMatchObject({ balance: 0, withdrawn: 110, deposits: 100 })
    expect(withdrawn.transactions?.filter(item => item.type === 'withdrawal')).toHaveLength(1)
  })

  it('preserves earned interest when principal is withdrawn and compounds the remaining savings', () => {
    const accrued = accrueBankInterest(depositToBank(createDefaultProfile(), 100, at('2026-01-01')), month, at('2026-02-01'))
    const withdrawn = withdrawFromBank(accrued, 100, at('2026-02-01'))
    expect(bankSummary(withdrawn)).toMatchObject({ balance: 10, interest: 10, withdrawn: 100 })
    const next = accrueBankInterest(withdrawn, month, at('2026-03-01'))
    expect(bankSummary(next).balance).toBe(11)
  })

  it('does not double-credit on reopen or repeated synchronization', () => {
    const deposited = depositToBank(createDefaultProfile(), 100, at('2026-01-01'))
    const accrued = accrueBankInterest(deposited, month, at('2026-03-01'))
    expect(bankSummary(accrued).balance).toBe(121)
    expect(accrueBankInterest(accrued, month, at('2026-03-01'))).toBe(accrued)
    const reopened = JSON.parse(JSON.stringify(accrued))
    expect(bankSummary(accrueBankInterest(reopened, month, at('2026-04-01'))).balance).toBe(133.1)
  })

  it('uses each deposit date and does not award a full month to a newly deposited amount', () => {
    const first = depositToBank(createDefaultProfile(), 100, at('2026-01-01'))
    const second = depositToBank(first, 100, at('2026-01-31'))
    expect(bankSummary(accrueBankInterest(second, month, at('2026-02-01'))).balance).toBe(210)
  })

  it('clamps month ends without permanently drifting the original anniversary', () => {
    const deposited = depositToBank(createDefaultProfile(), 100, at('2026-01-31'))
    const february = accrueBankInterest(deposited, month, at('2026-02-28'))
    expect(bankSummary(february).balance).toBe(110)
    const march = accrueBankInterest(february, month, at('2026-03-28'))
    // The February interest itself has earned 1 kr, but the original deposit is not due until March 31.
    expect(bankSummary(march).balance).toBe(111)
    expect(bankSummary(accrueBankInterest(march, month, at('2026-03-31'))).balance).toBe(121)
  })

  it('keeps credited interest when a new rate starts', () => {
    const accrued = accrueBankInterest(depositToBank(createDefaultProfile(), 100, at('2026-01-01')), month, at('2026-02-01'))
    const changed = resetInterestSchedule(accrued, at('2026-02-15'))
    const next = accrueBankInterest(changed, { ...month, interestRatePct: 5 }, at('2026-03-15'))
    expect(bankSummary(next).balance).toBe(115.5)
  })

  it('rejects overdrafts and non-finite amounts', () => {
    const deposited = depositToBank(createDefaultProfile(), 5, at('2026-01-01'))
    expect(() => withdrawFromBank(deposited, 5.01)).toThrow()
    expect(() => withdrawFromBank(deposited, -1)).toThrow()
    expect(() => depositToBank(deposited, Number.NaN)).toThrow()
  })

  it('rounds to cents and accounts for withdrawals from manual deposits', () => {
    const deposited = depositToBank(createDefaultProfile(), 10.15, at('2026-01-01'))
    const withdrawn = withdrawFromBank(deposited, 5.05, at('2026-01-02'))
    expect(bankSummary(withdrawn)).toMatchObject({ balance: 5.1, withdrawn: 5.05, deposits: 10.15 })
  })
})
