import { supabase } from '../supabase/client'

/**
 * Get all plan pricing rows (todas las versiones por mes de vigencia).
 * @returns {Promise<Array<{frequency, schedule, priceNet, priceGross, effectiveYear, effectiveMonth}>>}
 */
export async function getPlanPricing() {
  const { data, error } = await supabase
    .from('plan_pricing')
    .select('frequency, schedule, price_net, price_gross, effective_year, effective_month')
    .order('frequency', { ascending: true })
    .order('schedule', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(p => ({
    frequency: p.frequency,
    schedule: p.schedule,
    priceNet: Number(p.price_net),
    priceGross: Number(p.price_gross),
    effectiveYear: p.effective_year,
    effectiveMonth: p.effective_month
  }))
}

/**
 * Lookup plan price for a target month: version vigente = mayor (effYear,effMonth) <= (year,month).
 * year/month opcionales → default mes actual.
 * @returns {{priceNet: number, priceGross: number}}
 */
export function getPlanPriceSync(pricingData, frequency, schedule, year, month) {
  const now = new Date()
  const targetYm = (year ?? now.getFullYear()) * 12 + (month ?? now.getMonth())
  const match = pricingData
    .filter(p => p.frequency === frequency && p.schedule === schedule)
    .filter(p => (p.effectiveYear * 12 + p.effectiveMonth) <= targetYm)
    .sort((a, b) => (b.effectiveYear * 12 + b.effectiveMonth) - (a.effectiveYear * 12 + a.effectiveMonth))[0]
  if (!match) return { priceNet: 0, priceGross: 0 }
  return { priceNet: match.priceNet, priceGross: match.priceGross }
}

/**
 * Compute prorated amount: monthly × (chargeableDays / fullMonthDays).
 * @returns {number} rounded
 */
export function calculateProration(chargeableDays, fullMonthDays, monthlyAmount) {
  if (fullMonthDays <= 0) return 0
  return Math.round(monthlyAmount * (chargeableDays / fullMonthDays))
}

const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTH_NAMES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * Prorate a plan for a specific (year, month) given the plan start date.
 * Deterministic day-price model: standard days = 4 × frequency; billed = min(assigned-weekday
 * occurrences in the month that fall on/after startDate, standard days). Amounts scale by
 * billed / standard days, applied to both attendance and transport.
 * @returns {{year, month, label, billed, daysPerMonth, prorated, attendance, transport, total}|null}
 *          null when inputs are incomplete.
 */
export function calculateMonthProration({
  year,
  month,
  startDate,
  assignedDays,
  frequency,
  monthlyAttendanceGross = 0,
  monthlyTransportGross = 0
}) {
  const days = assignedDays || []
  const freq = Number(frequency)
  if (days.length === 0 || !freq) return null
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null
  if (start && isNaN(start.getTime())) return null
  const lastDay = new Date(year, month + 1, 0).getDate()
  let charged = 0
  for (let dnum = 1; dnum <= lastDay; dnum++) {
    const d = new Date(year, month, dnum)
    if (days.includes(DOW[d.getDay()]) && (!start || d >= start)) charged++
  }
  const daysPerMonth = 4 * freq
  const billed = Math.max(0, Math.min(charged, daysPerMonth))
  const factor = daysPerMonth > 0 ? billed / daysPerMonth : 0
  const attendance = Math.round(factor * monthlyAttendanceGross)
  const transport = Math.round(factor * monthlyTransportGross)
  return {
    year,
    month,
    label: `${MONTH_NAMES_ES[month]} ${year}`,
    billed,
    daysPerMonth,
    prorated: billed < daysPerMonth,
    attendance,
    transport,
    total: attendance + transport
  }
}

/**
 * Persist a new price version effective from (effectiveYear, effectiveMonth). Superadmin only.
 * @param {number} effectiveYear
 * @param {number} effectiveMonth - 0-indexed
 * @param {Array<{frequency, schedule, price_gross}>} planPrices
 * @param {Array<{frequency, distance_range, price_gross}>} transportPrices
 */
export async function setPricing(effectiveYear, effectiveMonth, planPrices, transportPrices) {
  const { data, error } = await supabase.rpc('set_pricing', {
    p_effective_year: effectiveYear,
    p_effective_month: effectiveMonth,
    p_plan_prices: planPrices,
    p_transport_prices: transportPrices
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'No se pudieron guardar los precios')
  return data
}
