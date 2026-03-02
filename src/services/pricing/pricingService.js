import { supabase } from '../supabase/client'

/**
 * Get all plan pricing
 * @returns {Promise<Array>}
 */
export async function getPlanPricing() {
  const { data, error } = await supabase
    .from('plan_pricing')
    .select('frequency, schedule, price')
    .order('frequency', { ascending: true })
    .order('schedule', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data.map(p => ({
    frequency: p.frequency,
    schedule: p.schedule,
    price: Number(p.price)
  }))
}

/**
 * Calculate plan price with transport option
 * @param {number} frequency - Times per week (1-4)
 * @param {string} schedule - 'morning', 'afternoon', or 'full_day'
 * @param {boolean} hasTransport - Whether transport is included
 * @returns {Promise<number>}
 */
export async function calculatePlanPrice(frequency, schedule, hasTransport = false) {
  const { data, error } = await supabase
    .rpc('get_plan_price', {
      p_frequency: frequency,
      p_schedule: schedule,
      p_has_transport: hasTransport
    })

  if (error) {
    throw new Error(error.message)
  }

  return Number(data) || 0
}

/**
 * Synchronous price calculation using cached pricing data
 * Use this when you already have pricing data loaded
 * @param {Array} pricingData - Array from getPlanPricing()
 * @param {number} frequency
 * @param {string} schedule
 * @param {boolean} hasTransport
 * @returns {number}
 */
export function calculatePlanPriceSync(pricingData, frequency, schedule, hasTransport = false) {
  const plan = pricingData.find(
    p => p.frequency === frequency && p.schedule === schedule
  )

  if (!plan) {
    return 0
  }

  return plan.price
}

/**
 * Calculate prorated billing amount
 * @param {number} chargeableDays - Number of days to charge
 * @param {number} fullMonthDays - Total expected days in full month
 * @param {number} monthlyPrice - Full monthly price
 * @returns {number} Prorated amount
 */
export function calculateProration(chargeableDays, fullMonthDays, monthlyPrice) {
  if (fullMonthDays <= 0) return 0
  const proration = chargeableDays / fullMonthDays
  return Math.round(monthlyPrice * proration)
}

/**
 * Calculate billing breakdown for a month
 * @param {object} params
 * @param {number} params.plannedDays - Days client will attend (excluding vacations)
 * @param {number} params.fullMonthDays - Total expected days if full month
 * @param {number} params.recoveryCreditsAvailable - Available recovery credits
 * @param {number} params.monthlyPrice - Full monthly price
 * @returns {object} Billing breakdown
 */
export function calculateBillingBreakdown({
  plannedDays,
  fullMonthDays,
  recoveryCreditsAvailable,
  monthlyPrice
}) {
  // Apply recovery credits (can't use more credits than planned days)
  const creditsToApply = Math.min(recoveryCreditsAvailable, plannedDays)
  const chargeableDays = plannedDays - creditsToApply

  // Calculate prorated amount
  const chargeableAmount = calculateProration(chargeableDays, fullMonthDays, monthlyPrice)

  return {
    plannedDays,
    fullMonthDays,
    creditsToApply,
    chargeableDays,
    monthlyPrice,
    chargeableAmount
  }
}
