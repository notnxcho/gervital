import { ordinalOf, eligibleMonths, validateDiscountRange } from './discountRange'

const inv = (year, month, opts = {}) => ({
  year, month,
  paymentStatus: opts.paid ? 'paid' : 'pending',
  invoiceStatus: opts.invoiced ? 'invoiced' : 'pending'
})

describe('ordinalOf', () => {
  test('combines year and 0-indexed month', () => {
    expect(ordinalOf(2026, 0)).toBe(2026 * 12)
    expect(ordinalOf(2026, 11)).toBe(2026 * 12 + 11)
  })
})

describe('eligibleMonths', () => {
  test('keeps only pending/pending, sorted by ordinal', () => {
    const invoices = [
      inv(2026, 5),
      inv(2026, 3, { paid: true }),
      inv(2026, 4, { invoiced: true }),
      inv(2026, 2)
    ]
    expect(eligibleMonths(invoices).map(m => m.month)).toEqual([2, 5])
  })
})

describe('validateDiscountRange', () => {
  const invoices = [inv(2026, 2), inv(2026, 3), inv(2026, 4), inv(2026, 6)]

  test('valid consecutive eligible range of 2+ months', () => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 4, percent: 20 })
    expect(r.valid).toBe(true)
    expect(r.months.map(m => m.month)).toEqual([2, 3, 4])
  })

  test('rejects single-month range', () => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 2, percent: 20 })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/2 meses/i)
  })

  test('rejects end before start', () => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 2, percent: 20 })
    expect(r.valid).toBe(false)
  })

  test('rejects range with a gap (missing month row)', () => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 6, percent: 20 })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/consecut|no disponible|elegible/i)
  })

  test('rejects range containing a paid/invoiced month', () => {
    const withPaid = [inv(2026, 2), inv(2026, 3, { paid: true }), inv(2026, 4)]
    const r = validateDiscountRange(withPaid, { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 4, percent: 20 })
    expect(r.valid).toBe(false)
  })

  test.each([0, -5, 101, NaN])('rejects invalid percent %p', pct => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 4, percent: pct })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/porcentaje/i)
  })
})
