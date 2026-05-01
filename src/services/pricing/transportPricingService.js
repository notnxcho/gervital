import { supabase } from '../supabase/client'

/**
 * Get all transport pricing rows.
 * @returns {Promise<Array<{frequency, distanceRange, priceNet, priceGross}>>}
 */
export async function getTransportPricing() {
  const { data, error } = await supabase
    .from('transport_pricing')
    .select('frequency, distance_range, price_net, price_gross')
    .order('frequency', { ascending: true })
    .order('distance_range', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(p => ({
    frequency: p.frequency,
    distanceRange: p.distance_range,
    priceNet: Number(p.price_net),
    priceGross: Number(p.price_gross)
  }))
}

/**
 * Lookup transport price (gross + net) from cached pricing array.
 * @returns {{priceNet: number, priceGross: number}}
 */
export function getTransportPriceSync(pricingData, frequency, distanceRange) {
  const row = pricingData.find(p => p.frequency === frequency && p.distanceRange === distanceRange)
  if (!row) return { priceNet: 0, priceGross: 0 }
  return { priceNet: row.priceNet, priceGross: row.priceGross }
}
