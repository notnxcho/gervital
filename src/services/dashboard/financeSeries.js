import { currentSalary, costoAnualMensualizado } from '../salaries/salaryCalc'

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

// Raw RPC rows + employees → UI-ready month objects (salaries computed per month).
export function mergeFinanceSeries(rpcRows, employees) {
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
    expenses: Number(r.expenses_total) || 0,
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

// Total monthly expenses = devengado expenses + monthlyized salaries.
export function selectExpensesTotal(row) {
  return (row.expenses || 0) + (row.salaries || 0)
}

export function selectMargin(row, opts) {
  return selectIncome(row, opts) - selectExpensesTotal(row)
}

// KPIs for the selected (year, month) + deltas vs the previous month in the series.
export function deriveKpis(series, year, month, opts = {}) {
  const idx = (series || []).findIndex(r => r.year === year && r.month === month)
  if (idx < 0) return null
  const cur = series[idx]
  const prev = idx > 0 ? series[idx - 1] : null

  const ingresoPrevisto = selectIncome(cur, { ...opts, basis: 'previsto' })
  const cobrado = selectIncome(cur, { ...opts, basis: 'cobrado' })
  const gastos = selectExpensesTotal(cur)
  const margen = ingresoPrevisto - gastos
  const tasaCobro = ingresoPrevisto > 0 ? (cobrado / ingresoPrevisto) * 100 : 0

  const prevPrevisto = prev ? selectIncome(prev, { ...opts, basis: 'previsto' }) : null
  const prevGastos = prev ? selectExpensesTotal(prev) : null

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
