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
