import { supabase } from '../supabase/client'

// Invoke the biller edge function, surfacing the server error message
async function invokeBiller(body) {
  const { data, error } = await supabase.functions.invoke('biller', { body })
  if (error) {
    let message = error.message
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) message = ctx.error
    } catch (_) { /* ignore parse errors */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/**
 * Emit a monthly e-Ticket for a client (month is 0-indexed).
 * @param {object} [override] - Optional edited values from the confirmation modal:
 *   attendanceConcepto, attendanceAmount, transportConcepto, transportAmount, adenda, fechaEmision, fechaVencimiento
 */
export async function emitInvoice(clientId, year, month, override = {}) {
  return invokeBiller({ action: 'emit_invoice', clientId, year, month, ...override })
}

/** Fetch the comprobante PDF (base64) for an emitted invoice */
export async function getInvoicePdf(clientId, year, month) {
  return invokeBiller({ action: 'get_invoice_pdf', clientId, year, month })
}

/**
 * Pre-register / sync a client as a Biller receptor.
 * @param {boolean} [force] - Re-sync even if already linked (e.g. after editing fiscal data)
 */
export async function syncClientToBiller(clientId, force = false) {
  return invokeBiller({ action: 'sync_client', clientId, force })
}

/** Poll DGI acceptance status for an emitted invoice */
export async function checkDgiStatus(clientId, year, month) {
  return invokeBiller({ action: 'check_dgi_status', clientId, year, month })
}

/** Void an emitted invoice (issues a credit note in Biller) */
export async function voidInvoice(clientId, year, month) {
  return invokeBiller({ action: 'void_invoice', clientId, year, month })
}
