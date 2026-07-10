import { supabase } from '../supabase/client'

/**
 * Create a prepaid promo atomically (superadmin only, enforced server-side).
 * Sets discount + marks every month in the range paid with a shared paidDate.
 * @param {string} clientId
 * @param {number} startYear
 * @param {number} startMonth - 0-indexed
 * @param {number} endYear
 * @param {number} endMonth - 0-indexed
 * @param {number} percent - 1..100
 * @param {string} paidDate - YYYY-MM-DD
 * @param {string} method - optional payment method
 * @param {string} notes - optional
 */
export async function createPrepaidPromo(clientId, startYear, startMonth, endYear, endMonth, percent, paidDate, method = null, notes = null) {
  const { data, error } = await supabase.rpc('create_prepaid_promo', {
    p_client_id: clientId,
    p_start_year: startYear,
    p_start_month: startMonth,
    p_end_year: endYear,
    p_end_month: endMonth,
    p_percent: percent,
    p_paid_date: paidDate,
    p_payment_method: method,
    p_notes: notes
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al crear la promoción')
  return data
}

/**
 * All promotions, enriched with client name/avatar. Superadmin-only (RLS).
 * @returns {Promise<Array>}
 */
export async function getPromotions() {
  const [promoRes, clientsRes] = await Promise.all([
    supabase.from('promotions').select('*').order('start_year', { ascending: false }).order('start_month', { ascending: false }),
    supabase.from('clients_full').select('id, firstName, lastName')
  ])
  if (promoRes.error) throw new Error(promoRes.error.message)
  if (clientsRes.error) throw new Error(clientsRes.error.message)

  const byId = new Map((clientsRes.data || []).map(c => [c.id, c]))
  return (promoRes.data || []).map(p => {
    const c = byId.get(p.client_id) || {}
    return {
      id: p.id,
      clientId: p.client_id,
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      discountPercent: Number(p.discount_percent) || 0,
      discountAmount: Number(p.discount_amount) || 0,
      startYear: p.start_year,
      startMonth: p.start_month,
      endYear: p.end_year,
      endMonth: p.end_month,
      paidDate: p.paid_date,
      paidAmount: Number(p.paid_amount) || 0,
      paymentMethod: p.payment_method || null,
      notes: p.notes || null,
      createdAt: p.created_at
    }
  })
}
