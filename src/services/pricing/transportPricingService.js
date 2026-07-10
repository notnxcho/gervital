import { supabase } from '../supabase/client'

/**
 * Get all transport pricing rows (todas las versiones por mes de vigencia).
 * @returns {Promise<Array<{frequency, distanceRange, priceNet, priceGross, effectiveYear, effectiveMonth}>>}
 */
export async function getTransportPricing() {
  const { data, error } = await supabase
    .from('transport_pricing')
    .select('frequency, distance_range, price_net, price_gross, effective_year, effective_month')
    .order('frequency', { ascending: true })
    .order('distance_range', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(p => ({
    frequency: p.frequency,
    distanceRange: p.distance_range,
    priceNet: Number(p.price_net),
    priceGross: Number(p.price_gross),
    effectiveYear: p.effective_year,
    effectiveMonth: p.effective_month
  }))
}

/**
 * Lookup transport price for a target month (version vigente). year/month opcionales.
 * @returns {{priceNet: number, priceGross: number}}
 */
export function getTransportPriceSync(pricingData, frequency, distanceRange, year, month) {
  const now = new Date()
  const targetYm = (year ?? now.getFullYear()) * 12 + (month ?? now.getMonth())
  const match = pricingData
    .filter(p => p.frequency === frequency && p.distanceRange === distanceRange)
    .filter(p => (p.effectiveYear * 12 + p.effectiveMonth) <= targetYm)
    .sort((a, b) => (b.effectiveYear * 12 + b.effectiveMonth) - (a.effectiveYear * 12 + a.effectiveMonth))[0]
  if (!match) return { priceNet: 0, priceGross: 0 }
  return { priceNet: match.priceNet, priceGross: match.priceGross }
}
