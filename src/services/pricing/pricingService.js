import { supabase } from '../supabase/client'

/**
 * Get all plan pricing rows.
 * @returns {Promise<Array<{frequency, schedule, priceNet, priceGross}>>}
 */
export async function getPlanPricing() {
  const { data, error } = await supabase
    .from('plan_pricing')
    .select('frequency, schedule, price_net, price_gross')
    .order('frequency', { ascending: true })
    .order('schedule', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(p => ({
    frequency: p.frequency,
    schedule: p.schedule,
    priceNet: Number(p.price_net),
    priceGross: Number(p.price_gross)
  }))
}

/**
 * Lookup plan price (gross + net) from cached pricing array.
 * @returns {{priceNet: number, priceGross: number}}
 */
export function getPlanPriceSync(pricingData, frequency, schedule) {
  const plan = pricingData.find(p => p.frequency === frequency && p.schedule === schedule)
  if (!plan) return { priceNet: 0, priceGross: 0 }
  return { priceNet: plan.priceNet, priceGross: plan.priceGross }
}

/**
 * Compute prorated amount: monthly × (chargeableDays / fullMonthDays).
 * @returns {number} rounded
 */
export function calculateProration(chargeableDays, fullMonthDays, monthlyAmount) {
  if (fullMonthDays <= 0) return 0
  return Math.round(monthlyAmount * (chargeableDays / fullMonthDays))
}
