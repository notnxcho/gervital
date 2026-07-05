import {
  PERIODICITY_OPTIONS,
  periodicityLabel,
  isActive,
  hitsMonth,
  fixedCashForMonth,
  fixedMonthlyForMonth,
  nextPayment
} from './fixedExpenseCalc'

// Semestral $60000 starting Jan 2026 (month 0), no end.
const semestral = { amount: 60000, periodMonths: 6, startYear: 2026, startMonth: 0, endYear: null, endMonth: null }
// Monthly $1000 from Mar 2026 (month 2) to May 2026 (month 4).
const monthlyBounded = { amount: 1000, periodMonths: 1, startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 4 }

describe('PERIODICITY_OPTIONS / periodicityLabel', () => {
  test('has the six options', () => {
    expect(PERIODICITY_OPTIONS.map(o => o.months)).toEqual([1, 2, 3, 4, 6, 12])
  })
  test('label lookup', () => {
    expect(periodicityLabel(6)).toBe('Semestral')
    expect(periodicityLabel(1)).toBe('Mensual')
  })
})

describe('isActive', () => {
  test('false before start', () => {
    expect(isActive(semestral, 2025, 11)).toBe(false)
  })
  test('true at/after start with no end', () => {
    expect(isActive(semestral, 2026, 0)).toBe(true)
    expect(isActive(semestral, 2030, 5)).toBe(true)
  })
  test('respects end', () => {
    expect(isActive(monthlyBounded, 2026, 4)).toBe(true)
    expect(isActive(monthlyBounded, 2026, 5)).toBe(false)
  })
})

describe('hitsMonth', () => {
  test('semestral hits Jan and Jul 2026, not Feb', () => {
    expect(hitsMonth(semestral, 2026, 0)).toBe(true)
    expect(hitsMonth(semestral, 2026, 6)).toBe(true)
    expect(hitsMonth(semestral, 2026, 1)).toBe(false)
  })
  test('does not hit before start even on phase', () => {
    expect(hitsMonth(semestral, 2025, 6)).toBe(false)
  })
})

describe('fixedCashForMonth', () => {
  test('full amount only on payment month', () => {
    expect(fixedCashForMonth([semestral], 2026, 0)).toBe(60000)
    expect(fixedCashForMonth([semestral], 2026, 1)).toBe(0)
  })
  test('sums multiple templates', () => {
    expect(fixedCashForMonth([semestral, monthlyBounded], 2026, 2)).toBe(1000)
  })
})

describe('fixedMonthlyForMonth', () => {
  test('monthlyizes active templates', () => {
    expect(fixedMonthlyForMonth([semestral], 2026, 1)).toBe(10000)
    expect(fixedMonthlyForMonth([semestral], 2025, 11)).toBe(0)
  })
  test('sums active templates, ignores inactive', () => {
    expect(fixedMonthlyForMonth([semestral, monthlyBounded], 2026, 3)).toBe(11000)
    expect(fixedMonthlyForMonth([semestral, monthlyBounded], 2026, 5)).toBe(10000)
  })
})

describe('nextPayment', () => {
  test('returns the next occurrence on/after the given month', () => {
    expect(nextPayment(semestral, 2026, 1)).toEqual({ year: 2026, month: 6 })
    expect(nextPayment(semestral, 2026, 6)).toEqual({ year: 2026, month: 6 })
  })
  test('null when past end', () => {
    expect(nextPayment(monthlyBounded, 2026, 5)).toBeNull()
  })
})
