import type { BankTransaction, ChildProfile, ParentSettings } from '../types'
import type { InterestPeriod } from './coreLogic'

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function anniversary(anchor: Date, count: number, period: InterestPeriod): Date {
  const date = new Date(anchor)
  if (period === 'week') {
    date.setDate(date.getDate() + count * 7)
  } else {
    const month = anchor.getMonth() + (period === 'month' ? count : count * 12)
    date.setDate(1)
    date.setMonth(month)
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(anchor.getDate(), lastDay))
  }
  return date
}

export function initializeBank(profile: ChildProfile): ChildProfile {
  if (profile.transactions) return profile
  const transactions: BankTransaction[] = []
  for (const settlement of [...profile.settlements].reverse()) {
    const withdrawn = settlement.withdrawnAmount ?? (settlement.paidAt ? settlement.totalPaid : 0)
    const amount = roundMoney(Math.max(0, settlement.totalPaid - withdrawn))
    if (amount > 0) {
      transactions.push({
        id: `opening-${settlement.id}`,
        type: 'opening',
        amount,
        timestamp: settlement.createdAt,
        description: `Overført restsaldo: ${settlement.periodLabel}`,
        settlementId: settlement.id,
      })
    }
  }
  if (profile.bankDeposits > 0) {
    transactions.push({
      id: crypto.randomUUID(),
      type: 'opening',
      amount: roundMoney(profile.bankDeposits),
      timestamp: new Date().toISOString(),
      description: 'Overført saldo fra tidligere manuelle innskudd',
    })
  }
  return { ...profile, transactions, interestCheckpoints: {} }
}

function availableCredit(transaction: BankTransaction, transactions: BankTransaction[]): number {
  const spent = transactions.reduce((sum, item) =>
    sum + (item.allocations ?? []).reduce((allocated, allocation) =>
      allocated + (allocation.transactionId === transaction.id ? allocation.amount : 0), 0), 0)
  return roundMoney(Math.max(0, transaction.amount - spent))
}

export function bankSummary(profile: ChildProfile) {
  const initialized = initializeBank(profile)
  const transactions = initialized.transactions ?? []
  const balance = roundMoney(transactions.reduce((sum, item) => sum + item.amount, 0))
  const interest = roundMoney(transactions.filter(item => item.type === 'interest')
    .reduce((sum, item) => sum + availableCredit(item, transactions), 0))
  return {
    balance,
    principal: roundMoney(balance - interest),
    interest,
    earnedInterest: roundMoney(transactions.filter(item => item.type === 'interest').reduce((sum, item) => sum + item.amount, 0)),
    deposits: roundMoney(transactions.filter(item => item.type === 'deposit' || (item.type === 'opening' && !item.settlementId))
      .reduce((sum, item) => sum + item.amount, 0)),
    withdrawn: roundMoney(-transactions.filter(item => item.type === 'withdrawal').reduce((sum, item) => sum + item.amount, 0) +
      initialized.settlements.reduce((sum, settlement) => {
        const ledgerWithdrawn = transactions.reduce((total, item) =>
          total + (item.allocations ?? []).filter(allocation =>
            transactions.find(credit => credit.id === allocation.transactionId)?.settlementId === settlement.id &&
            transactions.find(credit => credit.id === allocation.transactionId)?.type !== 'interest')
            .reduce((allocated, allocation) => allocated + allocation.amount, 0), 0)
        return sum + Math.max(0, settlement.withdrawnAmount - ledgerWithdrawn)
      }, 0)),
  }
}

export function settlementBankSummary(profile: ChildProfile, settlementId: string) {
  const transactions = profile.transactions ?? []
  const credits = transactions.filter(item => item.settlementId === settlementId && item.amount > 0)
  const principal = roundMoney(credits.filter(item => item.type !== 'interest')
    .reduce((sum, item) => sum + availableCredit(item, transactions), 0))
  const interest = roundMoney(credits.filter(item => item.type === 'interest')
    .reduce((sum, item) => sum + availableCredit(item, transactions), 0))
  return { principal, interest, totalWithInterest: roundMoney(principal + interest) }
}

export function accrueBankInterest(
  profile: ChildProfile,
  settings: Pick<ParentSettings, 'interestRatePct' | 'interestPeriod'>,
  now = new Date(),
): ChildProfile {
  const initialized = initializeBank(profile)
  const transactions = [...(initialized.transactions ?? [])]
  const checkpoints = { ...initialized.interestCheckpoints }
  let changed = initialized !== profile
  for (const credit of initialized.transactions ?? []) {
    if (credit.amount <= 0) continue
    const checkpoint = checkpoints[credit.id] ?? { anchor: credit.timestamp, periods: 0 }
    const anchor = new Date(checkpoint.anchor)
    if (!Number.isFinite(anchor.getTime())) throw new Error('Ugyldig rentedato i transaksjonshistorikken.')
    let periods = checkpoint.periods
    while (anniversary(anchor, periods + 1, settings.interestPeriod) <= now) {
      periods += 1
    }
    if (periods === checkpoint.periods) continue
    const count = periods - checkpoint.periods
    const remaining = availableCredit(credit, transactions)
    const earned = roundMoney(remaining * (Math.pow(1 + settings.interestRatePct / 100, count) - 1))
    if (!Number.isFinite(earned)) throw new Error('Renteinntekten er for stor. Kontroller rentesats og datoer.')
    if (earned > 0) {
      transactions.push({
        id: crypto.randomUUID(),
        type: 'interest',
        amount: earned,
        timestamp: anniversary(anchor, periods, settings.interestPeriod).toISOString(),
        description: `Renter: ${settings.interestRatePct}% per ${settings.interestPeriod === 'week' ? 'uke' : settings.interestPeriod === 'month' ? 'måned' : 'år'} (${count} perioder)`,
        settlementId: credit.settlementId,
      })
    }
    checkpoints[credit.id] = { ...checkpoint, periods }
    changed = true
  }
  return changed ? { ...initialized, transactions, interestCheckpoints: checkpoints } : profile
}

export function resetInterestSchedule(profile: ChildProfile, now = new Date()): ChildProfile {
  return {
    ...profile,
    interestCheckpoints: Object.fromEntries((profile.transactions ?? [])
      .filter(item => item.amount > 0)
      .map(item => [item.id, { anchor: now.toISOString(), periods: 0 }])),
  }
}

export function depositToBank(profile: ChildProfile, amount: number, now = new Date()): ChildProfile {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Innskuddet må være større enn 0 kr.')
  const initialized = initializeBank(profile)
  return {
    ...initialized,
    bankDeposits: roundMoney(initialized.bankDeposits + amount),
    transactions: [...(initialized.transactions ?? []), {
      id: crypto.randomUUID(), type: 'deposit', amount: roundMoney(amount),
      timestamp: now.toISOString(), description: 'Manuelt innskudd',
    }],
  }
}

export function withdrawFromBank(profile: ChildProfile, amount: number, now = new Date()): ChildProfile {
  const initialized = initializeBank(profile)
  const transactions = initialized.transactions ?? []
  if (!Number.isFinite(amount) || amount <= 0 || roundMoney(amount) > bankSummary(initialized).balance) {
    throw new Error('Uttaket må være større enn 0 og kan ikke overstige saldoen.')
  }
  let remaining = roundMoney(amount)
  const allocations: NonNullable<BankTransaction['allocations']> = []
  const credits = transactions.filter(item => item.amount > 0)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const settlements = initialized.settlements.map(item => ({ ...item }))
  let depositWithdrawal = 0
  for (const credit of credits) {
    const take = Math.min(remaining, availableCredit(credit, transactions))
    if (take <= 0) continue
    allocations.push({ transactionId: credit.id, amount: take })
    if (credit.settlementId && credit.type !== 'interest') {
      const settlement = settlements.find(item => item.id === credit.settlementId)
      if (settlement) {
        settlement.withdrawnAmount = roundMoney(settlement.withdrawnAmount + take)
        settlement.paidAt = settlement.withdrawnAmount >= settlement.totalPaid ? now.toISOString() : null
      }
    } else if (credit.type === 'deposit' || credit.type === 'opening') {
      depositWithdrawal += take
    }
    remaining = roundMoney(remaining - take)
    if (remaining === 0) break
  }
  if (remaining !== 0) throw new Error('Saldo og transaksjonshistorikk stemmer ikke overens.')
  return {
    ...initialized,
    settlements,
    bankDeposits: roundMoney(Math.max(0, initialized.bankDeposits - depositWithdrawal)),
    transactions: [...transactions, {
      id: crypto.randomUUID(), type: 'withdrawal', amount: -roundMoney(amount),
      timestamp: now.toISOString(), description: 'Uttak', allocations,
    }],
  }
}
