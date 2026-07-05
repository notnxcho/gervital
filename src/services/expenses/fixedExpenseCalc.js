// Pure math for fixed-expense templates. Mirrors salaryCalc's style.
// A template: { amount, periodMonths, startYear, startMonth, endYear, endMonth }.

export const PERIODICITY_OPTIONS = [
  { months: 1, label: 'Mensual' },
  { months: 2, label: 'Bimestral' },
  { months: 3, label: 'Trimestral' },
  { months: 4, label: 'Cuatrimestral' },
  { months: 6, label: 'Semestral' },
  { months: 12, label: 'Anual' }
]

export function periodicityLabel(months) {
  const opt = PERIODICITY_OPTIONS.find(o => o.months === months)
  return opt ? opt.label : `Cada ${months} meses`
}

// Absolute month index (year*12 + month).
const idx = (year, month) => year * 12 + month

export function isActive(tpl, year, month) {
  const t = idx(year, month)
  if (t < idx(tpl.startYear, tpl.startMonth)) return false
  if (tpl.endYear != null && tpl.endMonth != null && t > idx(tpl.endYear, tpl.endMonth)) return false
  return true
}

export function hitsMonth(tpl, year, month) {
  if (!isActive(tpl, year, month)) return false
  const diff = idx(year, month) - idx(tpl.startYear, tpl.startMonth)
  return diff % tpl.periodMonths === 0
}

export function fixedCashForMonth(tpls, year, month) {
  return (tpls || []).reduce(
    (sum, t) => sum + (hitsMonth(t, year, month) ? Number(t.amount) : 0),
    0
  )
}

export function fixedMonthlyForMonth(tpls, year, month) {
  return (tpls || []).reduce(
    (sum, t) => sum + (isActive(t, year, month) ? Number(t.amount) / t.periodMonths : 0),
    0
  )
}

// Next occurrence on/after (year, month); null if past end.
export function nextPayment(tpl, year, month) {
  const start = idx(tpl.startYear, tpl.startMonth)
  let t = Math.max(idx(year, month), start)
  const rem = (t - start) % tpl.periodMonths
  const occ = rem === 0 ? t : t + (tpl.periodMonths - rem)
  if (tpl.endYear != null && tpl.endMonth != null && occ > idx(tpl.endYear, tpl.endMonth)) return null
  return { year: Math.floor(occ / 12), month: occ % 12 }
}
