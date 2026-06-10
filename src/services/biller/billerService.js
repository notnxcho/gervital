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

/** Emit a monthly e-Ticket for a client (month is 0-indexed) */
export async function emitInvoice(clientId, year, month) {
  return invokeBiller({ action: 'emit_invoice', clientId, year, month })
}

/** Pre-register / sync a client as a Biller receptor */
export async function syncClientToBiller(clientId) {
  return invokeBiller({ action: 'sync_client', clientId })
}

/** Poll DGI acceptance status for an emitted invoice */
export async function checkDgiStatus(clientId, year, month) {
  return invokeBiller({ action: 'check_dgi_status', clientId, year, month })
}

/** Void an emitted invoice (issues a credit note in Biller) */
export async function voidInvoice(clientId, year, month) {
  return invokeBiller({ action: 'void_invoice', clientId, year, month })
}
