import { supabase } from '../supabase/client'

/**
 * Ensure monthly_invoice rows exist from client.start_date → now+6mo
 * @param {string} clientId
 */
export async function ensureClientMonths(clientId) {
  const { error } = await supabase.rpc('ensure_client_months', { p_client_id: clientId })
  if (error) throw new Error(error.message)
}

/**
 * Get all invoices for a client
 * @param {string} clientId
 * @returns {Promise<Array>}
 */
export async function getClientInvoices(clientId) {
  const { data, error } = await supabase
    .from('invoices_view')
    .select('*')
    .eq('clientId', clientId)
    .order('year', { ascending: true })
    .order('month', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(inv => ({
    clientId: inv.clientId,
    year: inv.year,
    month: inv.month,
    plannedDays: inv.plannedDays || 0,
    chargeableDays: inv.chargeableDays || 0,
    chargeableAmount: Number(inv.chargeableAmount) || 0,
    monthlyRate: Number(inv.monthlyRate) || 0,
    isAmountOverridden: inv.isAmountOverridden || false,
    originalChargeableAmount: inv.originalChargeableAmount ? Number(inv.originalChargeableAmount) : null,
    invoiceStatus: inv.invoiceStatus,
    invoicedAt: inv.invoicedAt,
    invoiceNumber: inv.invoiceNumber,
    invoiceUrl: inv.invoiceUrl,
    paymentStatus: inv.paymentStatus,
    paidAt: inv.paidAt,
    paidDate: inv.paidDate,
    paidAmount: inv.paidAmount ? Number(inv.paidAmount) : null,
    paymentMethod: inv.paymentMethod,
    paymentNotes: inv.paymentNotes
  }))
}

/**
 * Calculate billing for a month (live calculation, not snapshot)
 * @param {string} clientId
 * @param {number} year
 * @param {number} month - 0-indexed
 * @returns {Promise<object>}
 */
export async function calculateMonthBilling(clientId, year, month) {
  const { data, error } = await supabase.rpc('calculate_month_billing', {
    p_client_id: clientId,
    p_year: year,
    p_month: month
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)

  return {
    fullMonthDays: data.fullMonthDays,
    plannedDays: data.plannedDays,
    vacationDays: data.vacationDays,
    recoveryDays: data.recoveryDays,
    chargeableDays: data.chargeableDays,
    monthlyRate: Number(data.monthlyRate),
    chargeableAmount: Number(data.chargeableAmount),
    isProrated: data.isProrated
  }
}

/**
 * Mark a month as paid (snapshots billing at time of payment)
 * @param {string} clientId
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {number} amount - amount paid (can differ from calculated)
 * @param {string} method - payment method (optional)
 * @param {string} notes - payment notes (optional)
 * @param {string} paidDate - YYYY-MM-DD date of payment (optional, defaults to today)
 */
export async function markMonthPaid(clientId, year, month, amount, method = null, notes = null, paidDate = null) {
  const { data, error } = await supabase.rpc('mark_month_paid', {
    p_client_id: clientId,
    p_year: year,
    p_month: month,
    p_amount: amount,
    p_method: method,
    p_notes: notes,
    p_paid_date: paidDate
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al marcar como pagado')
  return data
}

/**
 * Mark a month as invoiced (electronic invoice issued)
 * @param {string} clientId
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {string} invoiceNumber
 * @param {string} invoiceUrl - optional
 */
export async function markMonthInvoiced(clientId, year, month, invoiceNumber, invoiceUrl = null) {
  const { data, error } = await supabase.rpc('mark_month_invoiced', {
    p_client_id: clientId,
    p_year: year,
    p_month: month,
    p_invoice_number: invoiceNumber,
    p_invoice_url: invoiceUrl
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al marcar como facturado')
  return data
}

/**
 * Undo a payment (revert paid → pending)
 * @param {string} clientId
 * @param {number} year
 * @param {number} month - 0-indexed
 */
export async function unmarkMonthPaid(clientId, year, month) {
  const { error } = await supabase
    .from('monthly_invoices')
    .update({
      payment_status: 'pending',
      paid_at: null,
      paid_date: null,
      paid_amount: null,
      payment_method: null,
      payment_notes: null,
      is_amount_overridden: false,
      original_chargeable_amount: null,
      updated_at: new Date().toISOString()
    })
    .eq('client_id', clientId)
    .eq('year', year)
    .eq('month', month)

  if (error) throw new Error(error.message)
}
