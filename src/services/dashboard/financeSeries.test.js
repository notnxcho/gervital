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

// append to src/services/dashboard/financeSeries.test.js
import {
  mergeFinanceSeries,
  selectIncome,
  selectExpensesTotal,
  selectMargin,
  deriveKpis
} from './financeSeries'

const rpcRow = (over = {}) => ({
  year: 2026, month: 5,
  att_net: 1000, att_gross: 1220,
  trans_net: 200, trans_gross: 244,
  paid_att_net: 500, paid_att_gross: 610,
  paid_trans_net: 100, paid_trans_gross: 122,
  expenses_total: 300,
  ...over
})

// Semestral $6000 starting Jan 2026 (month 0) → $1000/mo monthlyized.
const semestral = { amount: 6000, periodMonths: 6, startYear: 2026, startMonth: 0, endYear: null, endMonth: null }

describe('mergeFinanceSeries', () => {
  test('coerces numbers and adds salaries per month', () => {
    const out = mergeFinanceSeries([rpcRow()], []) // no employees → salaries 0
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      year: 2026, month: 5,
      attendanceNet: 1000, attendanceGross: 1220,
      transportNet: 200, transportGross: 244,
      paidAttendanceNet: 500, paidTransportNet: 100,
      variableExpenses: 300, salaries: 0
    })
  })
  test('maps fixed expenses to cash/monthly per month', () => {
    // month 5 (Jun) is not a semestral hit → cash 0, monthly 1000
    const jun = mergeFinanceSeries([rpcRow()], [], [semestral])[0]
    expect(jun.fixedCash).toBe(0)
    expect(jun.fixedMonthly).toBe(1000)
    // month 0 (Jan) is a payment month → cash 6000, monthly 1000
    const jan = mergeFinanceSeries([rpcRow({ month: 0 })], [], [semestral])[0]
    expect(jan.fixedCash).toBe(6000)
    expect(jan.fixedMonthly).toBe(1000)
  })
})

describe('selectors', () => {
  const row = mergeFinanceSeries([rpcRow({ month: 0 })], [], [semestral])[0] // fixedCash 6000, fixedMonthly 1000
  test('previsto net = attendance+transport net', () => {
    expect(selectIncome(row, { basis: 'previsto', withIva: false })).toBe(1200)
  })
  test('previsto gross = attendance+transport gross', () => {
    expect(selectIncome(row, { basis: 'previsto', withIva: true })).toBe(1464)
  })
  test('cobrado net = paid attendance+transport net', () => {
    expect(selectIncome(row, { basis: 'cobrado', withIva: false })).toBe(600)
  })
  test('cash basis (default) = variable + fixedCash + salaries', () => {
    expect(selectExpensesTotal({ ...row, salaries: 50 })).toBe(300 + 6000 + 50)
  })
  test('monthly basis = variable + fixedMonthly + salaries', () => {
    expect(selectExpensesTotal({ ...row, salaries: 50 }, { fixedBasis: 'monthly' })).toBe(300 + 1000 + 50)
  })
  test('margin uses the same fixed basis', () => {
    expect(selectMargin({ ...row, salaries: 50 }, { basis: 'previsto', withIva: false, fixedBasis: 'monthly' }))
      .toBe(1200 - (300 + 1000 + 50))
  })
})

describe('deriveKpis', () => {
  const series = [
    mergeFinanceSeries([rpcRow({ month: 4, att_net: 800, trans_net: 100, paid_att_net: 800, paid_trans_net: 100, expenses_total: 200 })], [])[0],
    mergeFinanceSeries([rpcRow({ month: 5 })], [])[0]
  ]
  test('returns null when selected month not present', () => {
    expect(deriveKpis(series, 2026, 11, {})).toBeNull()
  })
  test('computes KPIs and delta vs previous month', () => {
    const k = deriveKpis(series, 2026, 5, { withIva: false })
    expect(k.ingresoPrevisto).toBe(1200)   // 1000+200
    expect(k.cobrado).toBe(600)            // 500+100
    expect(k.gastos).toBe(300)             // expenses 300 + salaries 0
    expect(k.margen).toBe(900)             // 1200 - 300
    expect(k.tasaCobro).toBeCloseTo(50, 5) // 600/1200
    expect(k.deltas.ingresoPrevisto).toBe(1200 - 900) // prev month previsto = 800+100
  })
})
