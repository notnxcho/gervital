import { supabase } from '../supabase/client'

/**
 * Get all attendance records for a client
 * @param {string} clientId
 * @returns {Promise<Array>}
 */
export async function getClientAttendance(clientId) {
  const { data, error } = await supabase
    .from('attendance_view')
    .select('*')
    .eq('clientId', clientId)
    .order('date', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(r => ({
    date: r.date,
    status: r.status,
    isJustified: r.isJustified,
    shift: r.shift,
    notes: r.notes
  }))
}

/**
 * Flip 'scheduled' → 'attended' for all past days
 * @returns {Promise<number>} rows updated
 */
export async function advanceScheduledAttendance() {
  const { data, error } = await supabase.rpc('advance_scheduled_attendance')
  if (error) throw new Error(error.message)
  return data
}

/**
 * Mark a past assigned day as absent
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {boolean} isJustified
 * @param {string} userName
 */
export async function markDayAbsent(clientId, date, isJustified, userName) {
  const { data, error } = await supabase.rpc('mark_day_absent', {
    p_client_id: clientId,
    p_date: date,
    p_is_justified: isJustified,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al marcar falta')
  return data
}

/**
 * Revert an absent record back to attended
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {string} userName
 */
export async function unmarkDayAbsent(clientId, date, userName) {
  const { data, error } = await supabase.rpc('unmark_day_absent', {
    p_client_id: clientId,
    p_date: date,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al deshacer falta')
  return data
}

/**
 * Mark a future assigned day as vacation
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {string} userName
 * @returns {Promise<{success: boolean, creditEarned: boolean}>}
 */
export async function markDayVacation(clientId, date, userName) {
  const { data, error } = await supabase.rpc('mark_day_vacation', {
    p_client_id: clientId,
    p_date: date,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al marcar vacación')
  return data
}

/**
 * Remove vacation from a day
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {string} userName
 * @returns {Promise<{success: boolean, creditRevoked: boolean}>}
 */
export async function unmarkDayVacation(clientId, date, userName) {
  const { data, error } = await supabase.rpc('unmark_day_vacation', {
    p_client_id: clientId,
    p_date: date,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al quitar vacación')
  return data
}

/**
 * Mark a range of assigned days as vacation
 * @param {string} clientId
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @param {string} userName
 * @returns {Promise<{success: boolean, daysMarked: number}>}
 */
export async function markVacationRange(clientId, fromDate, toDate, userName) {
  const { data, error } = await supabase.rpc('mark_vacation_range', {
    p_client_id: clientId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al marcar rango de vacaciones')
  return data
}

/**
 * Mark a non-planned day as a recovery attendance (uses 1 recovery day)
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {string} userName
 * @returns {Promise<{success: boolean, recoveryDaysAvailable: number}>}
 */
export async function markDayRecoveryAttended(clientId, date, userName) {
  const { data, error } = await supabase.rpc('mark_day_recovery_attended', {
    p_client_id: clientId,
    p_date: date,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al marcar recupero')
  return data
}

/**
 * Remove a recovery attendance record (refunds 1 recovery day)
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {string} userName
 */
export async function unmarkDayRecoveryAttended(clientId, date, userName) {
  const { data, error } = await supabase.rpc('unmark_day_recovery_attended', {
    p_client_id: clientId,
    p_date: date,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al deshacer recupero')
  return data
}
