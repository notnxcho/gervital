import { salaryCostForMonth } from './financeSeries'

const emp = (over = {}) => ({
  adjustments: [{ nominal: 1200, liquido: 1000, effectiveDate: '2026-01-01' }],
  extraCosts: [],
  ...over
})

describe('salaryCostForMonth', () => {
  test('zero when no employees', () => {
    expect(salaryCostForMonth([], 2026, 5)).toBe(0)
    expect(salaryCostForMonth(undefined, 2026, 5)).toBe(0)
  })

  test('zero before the employee was hired', () => {
    // hired 2026-01, ask for 2025-12 (month 11)
    expect(salaryCostForMonth([emp()], 2025, 11)).toBe(0)
  })

  test('after hire = monthlyized cost (nominal*12 + aguinaldo + vacacional)/12', () => {
    // costoAnual = 1200*12 + 1200 + (1000/30*20) + 0 = 14400 + 1200 + 666.6667
    // /12 ≈ 1355.5556
    const v = salaryCostForMonth([emp()], 2026, 5) // junio 2026, month 5
    expect(v).toBeCloseTo((14400 + 1200 + (1000 / 30) * 20) / 12, 2)
  })

  test('extraordinary cost in trailing 12m increases the monthly cost', () => {
    const withExtra = emp({ extraCosts: [{ amount: 12000, date: '2026-03-15' }] })
    const base = salaryCostForMonth([emp()], 2026, 5)
    const bumped = salaryCostForMonth([withExtra], 2026, 5)
    expect(bumped).toBeCloseTo(base + 12000 / 12, 2)
  })

  test('uses the salary in effect at that month, not a later raise', () => {
    const raised = emp({
      adjustments: [
        { nominal: 1200, liquido: 1000, effectiveDate: '2026-01-01' },
        { nominal: 2400, liquido: 2000, effectiveDate: '2026-07-01' }
      ]
    })
    // junio 2026 (month 5) is before the July raise → uses 1200 nominal
    const v = salaryCostForMonth([raised], 2026, 5)
    expect(v).toBeCloseTo((14400 + 1200 + (1000 / 30) * 20) / 12, 2)
  })
})
