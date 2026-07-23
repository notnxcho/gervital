// Períodos de inactividad de un cliente: [fromDate, toDate). toDate null = abierto.
// Comparación por string 'YYYY-MM-DD' (ordena lexicográficamente = cronológicamente).

export function isInactiveOn(dateStr, periods) {
  if (!dateStr || !Array.isArray(periods)) return false
  return periods.some(p =>
    p && dateStr >= p.fromDate && (p.toDate == null || dateStr < p.toDate)
  )
}

export const dayInAnyPeriod = isInactiveOn
