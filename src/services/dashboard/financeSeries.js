import { currentSalary, costoAnualMensualizado } from '../salaries/salaryCalc'
import { fixedCashForMonth, fixedMonthlyForMonth, isActive, monthlyAmount } from '../expenses/fixedExpenseCalc'

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

// Standalone extra costs (no employee) dated in (year, month) — CASH, not amortized.
// They live in employee_extra_costs with employee_id NULL, are entered per month, and
// belong to no employee (salaryCostForMonth misses them) → folded into `salaries` here.
export function standaloneExtraForMonth(standaloneCosts, year, month) {
  if (!standaloneCosts || standaloneCosts.length === 0) return 0
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  return standaloneCosts
    .filter(c => String(c.date || '').slice(0, 7) === prefix)
    .reduce((s, c) => s + (Number(c.amount) || 0), 0)
}

// Contingency extraordinary expenses for (year, month) — rows carry year/month.
export function contingencyForMonth(rows, year, month) {
  if (!rows || rows.length === 0) return 0
  return rows
    .filter(r => r.year === year && r.month === month)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
}

// Raw RPC rows + employees + fixed templates + standalone extras + contingency rows →
// UI-ready month objects.
export function mergeFinanceSeries(rpcRows, employees, fixedExpenses = [], standaloneCosts = [], contingencyRows = []) {
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
    contingencyExpenses: contingencyForMonth(contingencyRows, r.year, r.month),
    fixedCash: fixedCashForMonth(fixedExpenses, r.year, r.month),
    fixedMonthly: fixedMonthlyForMonth(fixedExpenses, r.year, r.month),
    salaries: salaryCostForMonth(employees, r.year, r.month)
      + standaloneExtraForMonth(standaloneCosts, r.year, r.month)
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

// Variable + fixed (basis-dependent) + contingency, WITHOUT salaries.
export function selectExpensesOnly(row, { fixedBasis = 'cash' } = {}) {
  const fixed = fixedBasis === 'monthly' ? (row.fixedMonthly || 0) : (row.fixedCash || 0)
  return (row.variableExpenses || 0) + fixed + (row.contingencyExpenses || 0)
}

// Total monthly expenses = variable + fixed (basis) + monthlyized salaries.
export function selectExpensesTotal(row, opts = {}) {
  return selectExpensesOnly(row, opts) + (row.salaries || 0)
}

export function selectMargin(row, opts) {
  return selectIncome(row, opts) - selectExpensesTotal(row, opts)
}

// Indicadores financieros derivados del mes seleccionado. `kpis` = deriveKpis() (misma
// base/IVA para consistencia con lo mostrado). Devuelve null si falta el mes.
export function extendedFinanceKpis(row, kpis, { withIva = false } = {}) {
  if (!row || !kpis) return null
  const income = kpis.ingresoPrevisto // honra base previsto + toggle IVA
  const attendance = withIva ? (row.attendanceGross || 0) : (row.attendanceNet || 0)
  const netIncome = (row.attendanceNet || 0) + (row.transportNet || 0)
  const grossIncome = (row.attendanceGross || 0) + (row.transportGross || 0)
  return {
    marginPct: income > 0 ? (kpis.margen / income) * 100 : null,
    laborPct: income > 0 ? ((row.salaries || 0) / income) * 100 : null,
    pendingCollection: kpis.ingresoPrevisto - kpis.cobrado,
    attendanceRevenue: attendance,
    attendanceShare: income > 0 ? (attendance / income) * 100 : 0,
    ivaToRemit: grossIncome - netIncome,
    arr: netIncome * 12 // ingreso recurrente anualizado (sobre neto)
  }
}

// KPIs financieros de una línea de negocio ('attendance' | 'transport') para un mes.
// Asistencia y transporte son tracks de facturación separados. Honra el toggle de IVA.
// `clients` = clientes de esa línea activos en el mes (todos para asistencia, con transporte
// para transporte). Devuelve share sobre el ingreso total, ARPU y tasa de cobro de la línea.
export function lineRevenueKpis(row, line, clients, { withIva = false } = {}) {
  if (!row) return null
  const val = key => (withIva ? (row[`${key}Gross`] || 0) : (row[`${key}Net`] || 0))
  const revenue = line === 'transport' ? val('transport') : val('attendance')
  const paid = line === 'transport' ? val('paidTransport') : val('paidAttendance')
  const totalRevenue = val('attendance') + val('transport')
  const n = clients || 0
  return {
    line,
    revenue,
    paid,
    clients: n,
    share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
    arpu: n > 0 ? revenue / n : 0,
    collectionRate: revenue > 0 ? (paid / revenue) * 100 : 0
  }
}

// Gasto del mes desglosado por categoría: variables (mes) + fijos mensualizados (activos)
// + sueldos como categoría propia. Devuelve [{ label, value }] ordenado desc.
export function expensesByCategory({ variableRows = [], fixedTemplates = [], extraordinaryRows = [], salaries = 0 } = {}, year, month) {
  const totals = new Map()
  const add = (name, amount) => {
    if (!amount) return
    const key = name || 'Sin categoría'
    totals.set(key, (totals.get(key) || 0) + amount)
  }
  for (const e of variableRows) add(e.categoryName, Number(e.amount) || 0)
  for (const t of fixedTemplates) {
    if (isActive(t, year, month)) add(t.categoryName, monthlyAmount(t))
  }
  for (const x of extraordinaryRows) add(x.categoryName, Number(x.amount) || 0)
  add('Sueldos', salaries || 0)
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
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
