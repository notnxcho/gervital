import {
  VACATION_DAYS,
  currentSalary,
  aguinaldoAnual,
  salarioVacacionalAnual,
  extraordinarios12m,
  costoAnual,
  costoAnualMensualizado,
  proyectarNominal
} from './salaryCalc'

describe('currentSalary', () => {
  test('returns null when no adjustments', () => {
    expect(currentSalary([])).toBeNull()
    expect(currentSalary(undefined)).toBeNull()
  })

  test('picks the adjustment with the latest effectiveDate', () => {
    const adj = [
      { nominal: 100, liquido: 80, effectiveDate: '2025-01-01' },
      { nominal: 120, liquido: 95, effectiveDate: '2026-01-01' },
      { nominal: 110, liquido: 88, effectiveDate: '2025-06-01' }
    ]
    expect(currentSalary(adj)).toEqual({ nominal: 120, liquido: 95, effectiveDate: '2026-01-01' })
  })

  test('breaks ties on effectiveDate using createdAt', () => {
    const adj = [
      { nominal: 100, liquido: 80, effectiveDate: '2026-01-01', createdAt: '2026-01-01T10:00:00Z' },
      { nominal: 130, liquido: 99, effectiveDate: '2026-01-01', createdAt: '2026-01-02T10:00:00Z' }
    ]
    expect(currentSalary(adj).nominal).toBe(130)
  })
})

describe('aguinaldoAnual', () => {
  test('equals one nominal month', () => {
    expect(aguinaldoAnual(50000)).toBe(50000)
    expect(aguinaldoAnual(0)).toBe(0)
  })
})

describe('salarioVacacionalAnual', () => {
  test('is (liquido / 30) * 20', () => {
    expect(salarioVacacionalAnual(38000)).toBeCloseTo((38000 / 30) * 20, 5)
  })
  test('uses VACATION_DAYS = 20', () => {
    expect(VACATION_DAYS).toBe(20)
  })
})

describe('extraordinarios12m', () => {
  const extras = [
    { amount: 1000, date: '2026-05-01' },
    { amount: 500, date: '2025-07-01' },
    { amount: 9999, date: '2025-05-01' }
  ]
  test('sums only costs within the last 12 months of asOf', () => {
    expect(extraordinarios12m(extras, '2026-06-11')).toBe(1500)
  })
  test('returns 0 for empty input', () => {
    expect(extraordinarios12m([], '2026-06-11')).toBe(0)
    expect(extraordinarios12m(undefined, '2026-06-11')).toBe(0)
  })
})

describe('costoAnual / costoAnualMensualizado', () => {
  const args = {
    nominal: 50000,
    liquido: 40000,
    extraCosts: [{ amount: 12000, date: '2026-05-01' }]
  }
  test('costoAnual = nominal*12 + aguinaldo + salarioVacacional + extras12m', () => {
    const expected = 50000 * 12 + 50000 + (40000 / 30) * 20 + 12000
    expect(costoAnual(args, '2026-06-11')).toBeCloseTo(expected, 5)
  })
  test('mensualizado = costoAnual / 12', () => {
    expect(costoAnualMensualizado(args, '2026-06-11')).toBeCloseTo(costoAnual(args, '2026-06-11') / 12, 5)
  })
})

describe('proyectarNominal', () => {
  test('applies the semester pct compounded over N semesters', () => {
    expect(proyectarNominal(100000, 3.5, 2)).toBeCloseTo(100000 * Math.pow(1.035, 2), 5)
  })
  test('0 semesters returns the same nominal', () => {
    expect(proyectarNominal(100000, 3.5, 0)).toBe(100000)
  })
})

describe('currentSalary tie-break determinism', () => {
  test('returns 0-equivalent stable order when createdAt missing on both', () => {
    const adj = [
      { nominal: 100, liquido: 80, effectiveDate: '2026-01-01' },
      { nominal: 200, liquido: 90, effectiveDate: '2026-01-01' }
    ]
    // both lack createdAt and share effectiveDate -> must not throw and must be deterministic
    expect(currentSalary(adj)).toEqual({ nominal: 100, liquido: 80, effectiveDate: '2026-01-01' })
  })
})

describe('costoAnual null/undefined safety', () => {
  test('returns 0 when args is null (no current salary)', () => {
    expect(costoAnual(null, '2026-06-11')).toBe(0)
    expect(costoAnualMensualizado(null, '2026-06-11')).toBe(0)
  })
  test('returns 0 when args is undefined', () => {
    expect(costoAnual(undefined, '2026-06-11')).toBe(0)
  })
  test('handles missing extraCosts key', () => {
    expect(costoAnual({ nominal: 0, liquido: 0 }, '2026-06-11')).toBe(0)
  })
})
