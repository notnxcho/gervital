import { currentSalary, costoAnualMensualizado } from '../salaries/salaryCalc'
import { fixedCashForMonth, fixedMonthlyForMonth } from '../expenses/fixedExpenseCalc'

// Last calendar day of a 0-indexed month as 'YYYY-MM-DD' (UTC-safe).
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
}

// Monthlyized salary cost for (year, month): sum over employees hired by then.
// Historical approximation — does not model terminations (see spec §7).
export function salaryCostForMonth(employees, year, month) {
  if (!employees || employees.length === 0) return 0
  const asOf = lastDayOfMonth(year, month)
  let total = 0
  for (const emp of employees) {
    const hiredBy = (emp.adjustments || []).filter(a => a.effectiveDate <= asOf)
    const sal = currentSalary(hiredBy)
    if (!sal) continue // not yet hired this month
    total += costoAnualMensualizado(
      { nominal: sal.nominal, liquido: sal.liquido, extraCosts: emp.extraCosts },
      asOf
    )
  }
  return total
}

// Raw RPC rows + employees + fixed-expense templates → UI-ready month objects.
export function mergeFinanceSeries(rpcRows, employees, fixedExpenses = []) {
  return (rpcRows || []).map(r => ({
    year: r.year,
    month: r.month,
    attendanceNet: Number(r.att_net) || 0,
    attendanceGross: Number(r.att_gross) || 0,
    transportNet: Number(r.trans_net) || 0,
    transportGross: Number(r.trans_gross) || 0,
    paidAttendanceNet: Number(r.paid_att_net) || 0,
    paidAttendanceGross: Number(r.paid_att_gross) || 0,
    paidTransportNet: Number(r.paid_trans_net) || 0,
    paidTransportGross: Number(r.paid_trans_gross) || 0,
    variableExpenses: Number(r.expenses_total) || 0,
    fixedCash: fixedCashForMonth(fixedExpenses, r.year, r.month),
    fixedMonthly: fixedMonthlyForMonth(fixedExpenses, r.year, r.month),
    salaries: salaryCostForMonth(employees, r.year, r.month)
  }))
}

// Income for a month row given basis ('previsto'|'cobrado') and IVA toggle.
export function selectIncome(row, { basis = 'previsto', withIva = false } = {}) {
  if (basis === 'cobrado') {
    return withIva
      ? row.paidAttendanceGross + row.paidTransportGross
      : row.paidAttendanceNet + row.paidTransportNet
  }
  return withIva
    ? row.attendanceGross + row.transportGross
    : row.attendanceNet + row.transportNet
}

// Variable + fixed (basis-dependent), WITHOUT salaries.
export function selectExpensesOnly(row, { fixedBasis = 'cash' } = {}) {
  const fixed = fixedBasis === 'monthly' ? (row.fixedMonthly || 0) : (row.fixedCash || 0)
  return (row.variableExpenses || 0) + fixed
}

// Total monthly expenses = variable + fixed (basis) + monthlyized salaries.
export function selectExpensesTotal(row, opts = {}) {
  return selectExpensesOnly(row, opts) + (row.salaries || 0)
}

export function selectMargin(row, opts) {
  return selectIncome(row, opts) - selectExpensesTotal(row, opts)
}

// Costo por cliente + punto de equilibrio (modelo de margen de contribución).
// - Fijos = sueldos mensualizados + gastos fijos mensualizados (no escalan con clientes)
// - Variables = gastos variables (escalan con clientes)
// - Ingreso = neto previsto (asistencia + transporte), consistente con el modelo contable
// breakevenClients = fijos / (ARPU − costo variable por cliente); null si la contribución
// por cliente no es positiva (no hay punto de equilibrio alcanzable con esa estructura).
export function breakevenAnalysis(row, activeClients) {
  const n = activeClients || 0
  const fixedCosts = (row?.fixedMonthly || 0) + (row?.salaries || 0)
  const variableCosts = row?.variableExpenses || 0
  const revenueNet = (row?.attendanceNet || 0) + (row?.transportNet || 0)
  const totalCosts = fixedCosts + variableCosts

  const costPerClient = n > 0 ? totalCosts / n : 0
  const revenuePerClient = n > 0 ? revenueNet / n : 0
  const variablePerClient = n > 0 ? variableCosts / n : 0
  const contributionPerClient = revenuePerClient - variablePerClient
  const marginPerClient = revenuePerClient - costPerClient
  const breakevenClients = contributionPerClient > 0 ? fixedCosts / contributionPerClient : null
  const breakevenRevenue = breakevenClients == null ? null : breakevenClients * revenuePerClient

  return {
    activeClients: n,
    fixedCosts,
    variableCosts,
    totalCosts,
    revenueNet,
    costPerClient,
    revenuePerClient,
    variablePerClient,
    contributionPerClient,
    marginPerClient,
    breakevenClients,
    breakevenRevenue
  }
}

// KPIs for the selected (year, month) + deltas vs the previous month in the series.
export function deriveKpis(series, year, month, opts = {}) {
  const idx = (series || []).findIndex(r => r.year === year && r.month === month)
  if (idx < 0) return null
  const cur = series[idx]
  const prev = idx > 0 ? series[idx - 1] : null

  const ingresoPrevisto = selectIncome(cur, { ...opts, basis: 'previsto' })
  const cobrado = selectIncome(cur, { ...opts, basis: 'cobrado' })
  const gastos = selectExpensesTotal(cur, { ...opts, fixedBasis: 'monthly' })
  const margen = ingresoPrevisto - gastos
  const tasaCobro = ingresoPrevisto > 0 ? (cobrado / ingresoPrevisto) * 100 : 0

  const prevPrevisto = prev ? selectIncome(prev, { ...opts, basis: 'previsto' }) : null
  const prevGastos = prev ? selectExpensesTotal(prev, { ...opts, fixedBasis: 'monthly' }) : null

  return {
    ingresoPrevisto,
    cobrado,
    gastos,
    margen,
    tasaCobro,
    deltas: {
      ingresoPrevisto: prevPrevisto == null ? null : ingresoPrevisto - prevPrevisto,
      gastos: prevGastos == null ? null : gastos - prevGastos
    }
  }
}
