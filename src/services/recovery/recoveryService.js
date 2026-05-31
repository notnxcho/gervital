import { supabase } from '../supabase/client'

/**
 * Available recovery credits for a client (not expired, not consumed/revoked),
 * soonest-expiring first.
 * @param {string} clientId
 * @returns {Promise<Array<{id, grantedAt, expiresAt, source, note}>>}
 */
export async function getRecoveryCredits(clientId) {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('recovery_credits')
    .select('id, granted_at, expires_at, source, note')
    .eq('client_id', clientId)
    .eq('status', 'available')
    .gte('expires_at', today)
    .order('expires_at', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(c => ({
    id: c.id,
    grantedAt: c.granted_at,
    expiresAt: c.expires_at,
    source: c.source,
    note: c.note
  }))
}

/**
 * Add one discretionary recovery credit (expires in 30 days) with an optional note.
 * @param {string} clientId
 * @param {string} note
 * @param {string} userName
 * @returns {Promise<{success: boolean, recoveryDaysAvailable: number, creditId: string}>}
 */
export async function addRecoveryCredit(clientId, note, userName) {
  const { data, error } = await supabase.rpc('add_recovery_credit', {
    p_client_id: clientId,
    p_note: note || null,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al agregar día de recupero')
  return data
}

/**
 * Revoke a recovery credit (kept for audit, no longer counts).
 * @param {string} creditId
 * @param {string} userName
 * @returns {Promise<{success: boolean, recoveryDaysAvailable: number}>}
 */
export async function revokeRecoveryCredit(creditId, userName) {
  const { data, error } = await supabase.rpc('revoke_recovery_credit', {
    p_credit_id: creditId,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al remover día de recupero')
  return data
}
