import { salaryCostForMonth, breakevenAnalysis } from './financeSeries'

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
  deriveKpis,
  transportKpis
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

describe('breakevenAnalysis', () => {
  // fijos = fixedMonthly + salaries = 200 + 800 = 1000; variables = 100; ingreso neto = 2000
  const row = { attendanceNet: 1800, transportNet: 200, variableExpenses: 100, fixedMonthly: 200, salaries: 800 }

  test('zero clients → no per-client figures, no crash', () => {
    const a = breakevenAnalysis(row, 0)
    expect(a.activeClients).toBe(0)
    expect(a.costPerClient).toBe(0)
    expect(a.revenuePerClient).toBe(0)
    expect(a.breakevenClients).toBeNull() // sin clientes la contribución por cliente es 0 → no computable
  })

  test('contribution-margin breakeven', () => {
    // 10 clientes: ARPU=200, var/cliente=10, contribución=190, fijos=1000 → breakeven=1000/190≈5.26
    const a = breakevenAnalysis(row, 10)
    expect(a.costPerClient).toBeCloseTo(110) // (1000+100)/10
    expect(a.revenuePerClient).toBeCloseTo(200)
    expect(a.marginPerClient).toBeCloseTo(90)
    expect(a.contributionPerClient).toBeCloseTo(190)
    expect(a.breakevenClients).toBeCloseTo(1000 / 190)
    expect(a.breakevenRevenue).toBeCloseTo((1000 / 190) * 200)
  })

  test('null breakeven when contribution per client is not positive', () => {
    // variables enormes → costo variable por cliente > ARPU
    const bad = { attendanceNet: 100, transportNet: 0, variableExpenses: 5000, fixedMonthly: 100, salaries: 0 }
    const a = breakevenAnalysis(bad, 10)
    expect(a.contributionPerClient).toBeLessThanOrEqual(0)
    expect(a.breakevenClients).toBeNull()
    expect(a.breakevenRevenue).toBeNull()
  })
})

describe('transportKpis', () => {
  const row = {
    attendanceNet: 800, attendanceGross: 976,
    transportNet: 200, transportGross: 244,
    paidTransportNet: 150, paidTransportGross: 183
  }
  test('net basis: share, arpu, collection rate', () => {
    const k = transportKpis(row, 4, { withIva: false })
    expect(k.revenue).toBe(200)
    expect(k.transportClients).toBe(4)
    expect(k.share).toBeCloseTo(200 / 1000 * 100) // 20%
    expect(k.arpu).toBeCloseTo(50)                 // 200/4
    expect(k.collectionRate).toBeCloseTo(75)       // 150/200
  })
  test('gross basis honors IVA toggle', () => {
    const k = transportKpis(row, 4, { withIva: true })
    expect(k.revenue).toBe(244)
    expect(k.collectionRate).toBeCloseTo(183 / 244 * 100)
  })
  test('no transport clients / no revenue → zeros, no divide-by-zero', () => {
    const k = transportKpis({ attendanceNet: 0, transportNet: 0, paidTransportNet: 0 }, 0, {})
    expect(k.share).toBe(0)
    expect(k.arpu).toBe(0)
    expect(k.collectionRate).toBe(0)
  })
})
