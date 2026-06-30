// Pure helpers for plan-discount month-range selection/validation.
// A month is identified by its ordinal: year * 12 + month (month is 0-indexed).
// Removal of a discount goes straight through the RPC (percent 0); this validator
// only covers applying a real discount, so percent must be between 1 and 100.

export function ordinalOf(year, month) {
  return year * 12 + month
}

// Invoice is eligible for a discount only while it is neither paid nor invoiced.
export function isEligible(invoice) {
  return invoice?.paymentStatus === 'pending' && invoice?.invoiceStatus === 'pending'
}

export function eligibleMonths(invoices) {
  return (invoices || [])
    .filter(isEligible)
    .slice()
    .sort((a, b) => ordinalOf(a.year, a.month) - ordinalOf(b.year, b.month))
}

// Validate a discount application range. Returns { valid, months } or { valid: false, error }.
export function validateDiscountRange(invoices, { startYear, startMonth, endYear, endMonth, percent }) {
  const pct = Number(percent)
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return { valid: false, error: 'El porcentaje debe estar entre 1 y 100' }
  }

  const startOrd = ordinalOf(startYear, startMonth)
  const endOrd = ordinalOf(endYear, endMonth)
  if (endOrd < startOrd) {
    return { valid: false, error: 'El mes de fin debe ser posterior o igual al de inicio' }
  }
  if (endOrd === startOrd) {
    return { valid: false, error: 'Seleccioná un rango de al menos 2 meses' }
  }

  const byOrdinal = new Map((invoices || []).map(inv => [ordinalOf(inv.year, inv.month), inv]))
  const months = []
  for (let ord = startOrd; ord <= endOrd; ord++) {
    const inv = byOrdinal.get(ord)
    if (!inv || !isEligible(inv)) {
      return { valid: false, error: 'El rango debe ser consecutivo y todos los meses deben estar sin cobrar ni facturar' }
    }
    months.push(inv)
  }

  return { valid: true, months }
}
