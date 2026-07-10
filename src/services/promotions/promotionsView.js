// Pure helpers for the promotions dashboard section + cobranza struck display.
// A month is identified by its ordinal: year * 12 + month (month is 0-indexed).

export function promoOrdinal(year, month) {
  return year * 12 + month
}

const startOrd = (p) => promoOrdinal(p.startYear, p.startMonth)
const endOrd = (p) => promoOrdinal(p.endYear, p.endMonth)

// Classify each promo relative to a reference month.
// - active:    ref within [start, end]
// - upcoming:  starts after ref, OR ends at ref or ref+1 (last month -> renewal window)
// - historical: ends before ref
export function classifyPromotions(promos, refYear, refMonth) {
  const ref = promoOrdinal(refYear, refMonth)
  const active = []
  const upcoming = []
  const historical = []
  for (const p of promos || []) {
    const s = startOrd(p)
    const e = endOrd(p)
    if (ref >= s && ref <= e) active.push(p)
    if (s > ref || e === ref || e === ref + 1) upcoming.push(p)
    if (e < ref) historical.push(p)
  }
  return { active, upcoming, historical }
}

// paidDate 'YYYY-MM-DD' -> ordinal of its month
const paidOrdinal = (paidDate) => {
  if (!paidDate) return null
  const [y, m] = String(paidDate).slice(0, 10).split('-').map(Number)
  return promoOrdinal(y, m - 1)
}

export function promoKpis(promos, refYear, refMonth) {
  const ref = promoOrdinal(refYear, refMonth)
  const { active, upcoming } = classifyPromotions(promos, refYear, refMonth)
  const prepaidCashInPeriod = (promos || [])
    .filter(p => paidOrdinal(p.paidDate) === ref)
    .reduce((s, p) => s + (Number(p.paidAmount) || 0), 0)
  // Descuento otorgado: ahorro REAL (solo asistencia) guardado en la promo al crearla.
  // No se reconstruye desde paidAmount porque ese total incluye transporte sin descuento.
  const totalDiscountGranted = active.reduce((s, p) => s + (Number(p.discountAmount) || 0), 0)
  return {
    activeCount: active.length,
    prepaidCashInPeriod,
    totalDiscountGranted: Math.round(totalDiscountGranted),
    upcomingCount: upcoming.length
  }
}

// Cobranza row display: a prepaid promo month whose cash was attributed to another month
// (cash_collected == 0 while it was actually paid) shows the notional amount struck-through.
export function promoCashRow(row) {
  const isPromo = row?.promoTotal != null
  const paid = row?.paymentStatus === 'paid'
  const cash = Number(row?.cashCollected) || 0
  const notional = Number(row?.paidAmount) || 0
  const struck = isPromo && paid && cash === 0 && notional > 0
  return { struck, notional, cash }
}
