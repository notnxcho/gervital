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
    isChargeable: r.isChargeable,
    shift: r.shift,
    notes: r.notes
  }))
}

/**
 * Get all attendance records for a single date (across all clients)
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<Array>}
 */
export async function getAttendanceForDate(date) {
  const { data, error } = await supabase
    .from('attendance_view')
    .select('*')
    .eq('date', date)

  if (error) throw new Error(error.message)
  return data
}

/**
 * Get all attendance records in a date range (inclusive), across all clients
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @returns {Promise<Array>}
 */
export async function getAttendanceForDateRange(fromDate, toDate) {
  const { data, error } = await supabase
    .from('attendance_view')
    .select('*')
    .gte('date', fromDate)
    .lte('date', toDate)

  if (error) throw new Error(error.message)
  return data
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
 * Registra una falta (única fuente de verdad server-side). El backend deriva
 * si es cobrable y si genera recupero. Ver absenceModel.deriveAbsence.
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {boolean} isJustified
 * @param {string} userName
 * @param {string|null} notes - Motivo (chip o texto libre)
 * @returns {Promise<{success: boolean, isChargeable: boolean, creditEarned: boolean}>}
 */
export async function registerAbsence(clientId, date, isJustified, userName, notes = null) {
  const { data, error } = await supabase.rpc('register_absence', {
    p_client_id: clientId,
    p_date: date,
    p_is_justified: isJustified,
    p_notes: notes,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al registrar falta')
  return data
}

/**
 * Registra faltas en un rango; cada día asignado se evalúa por separado.
 * @returns {Promise<{success: boolean, daysMarked: number}>}
 */
export async function registerAbsenceRange(clientId, fromDate, toDate, isJustified, userName, notes = null) {
  const { data, error } = await supabase.rpc('register_absence_range', {
    p_client_id: clientId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_is_justified: isJustified,
    p_notes: notes,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al registrar rango de faltas')
  return data
}

/**
 * Deshace una falta: revierte el día a attended/scheduled y revoca el crédito
 * de recupero si la falta lo había generado.
 * @returns {Promise<{success: boolean, creditRevoked: boolean}>}
 */
export async function unregisterAbsence(clientId, date, userName) {
  const { data, error } = await supabase.rpc('unregister_absence', {
    p_client_id: clientId,
    p_date: date,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al deshacer falta')
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
