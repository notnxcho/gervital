/**
 * Reconciles the plan-based daily roster with the actual attendance records for
 * a given date. Single source of truth for "who is physically present on date D,
 * shift S" — used by Grupos and Transporte (daily and weekly views).
 *
 * Rule:
 *  - Planned client (assignedDays includes dayName AND matchesShift) is present,
 *    UNLESS their record for that date is an absence. The absence reason
 *    (absent / vacation / etc.) is NOT relevant to the daily roster UIs
 *    (Grupos / Transporte): all absences are flattened into a single "falta".
 *  - A client attending on a recovery day (record status 'recovery') is added
 *    even if the day is not in their plan, as long as matchesShift is true.
 *    Recovery records do not carry a shift, so shift membership is derived from
 *    the client's plan schedule via matchesShift (same predicate as planned).
 *  - No record, or 'attended' / 'scheduled', behaves exactly as plan-only did.
 */

// Statuses meaning the client is NOT physically present that day
export const ABSENT_STATUSES = ['absent', 'vacation']

// Status meaning the client attends on a day outside their plan
export const RECOVERY_STATUS = 'recovery'

/**
 * Index a list of attendance records (for a single date) by clientId.
 * @param {Array<{clientId: string}>} records
 * @returns {Map<string, object>}
 */
export function indexAttendanceByClientId(records) {
  const map = new Map()
  if (!records) return map
  for (const r of records) map.set(r.clientId, r)
  return map
}

/**
 * Classify the clients matching a day+shift into present / absent.
 * Absence reasons are flattened: any ABSENT_STATUSES record counts as a plain
 * absence ("falta"), which is all the daily roster UIs care about.
 * @param {object} params
 * @param {Array} params.clients - full client list (each with plan.assignedDays, plan.schedule)
 * @param {string} params.dayName - 'monday' | 'tuesday' | ...
 * @param {(client: object) => boolean} params.matchesShift - shift membership predicate
 * @param {Map<string, object>} [params.attendanceByClientId] - records for this date; empty = plan-only
 * @param {boolean} [params.reflectAbsences=true] - when false, absences are ignored: planned
 *   clients stay in `present` regardless of an absence record (absent comes back
 *   empty). Recovery attendees are still added. Used by the weekly views, which are plan-based.
 * @returns {{present: Array, absent: Array}} lists in input order
 */
export function classifyDay({ clients, dayName, matchesShift, attendanceByClientId, reflectAbsences = true }) {
  const att = attendanceByClientId || new Map()
  const present = []
  const absent = []
  for (const c of clients) {
    if (!matchesShift(c)) continue
    const rec = att.get(c.id)
    const planned = c.plan?.assignedDays?.includes(dayName)
    if (planned) {
      if (reflectAbsences && ABSENT_STATUSES.includes(rec?.status)) absent.push(c)
      else present.push(c)
    } else if (rec?.status === RECOVERY_STATUS) {
      present.push(c)
    }
  }
  return { present, absent }
}

/**
 * Clients present on a day+shift (planned minus absences plus recoveries).
 * @returns {Array} in input order
 */
export function buildDayRoster(params) {
  return classifyDay(params).present
}

/**
 * @param {object} client
 * @param {Map<string, object>} [attendanceByClientId]
 * @returns {boolean} true when the client is attending as a recovery that day
 */
export function isRecoveryAttendee(client, attendanceByClientId) {
  return attendanceByClientId?.get(client.id)?.status === RECOVERY_STATUS
}
