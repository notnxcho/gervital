/**
 * Lógica pura del modelo unificado de faltas. Toda falta es status 'absent',
 * descrita por is_justified + is_chargeable. El recupero se genera sii
 * (is_justified AND is_chargeable). Espejo exacto de la RPC register_absence.
 *
 * is_chargeable = NOT (justificada AND futuro AND mes NO pago)
 *   - futuro = date > today (estrictamente; hoy y pasado NO son futuro)
 */

/**
 * @param {{ isJustified: boolean, date: string, today: string, monthPaid: boolean }} p
 *   date/today en formato 'YYYY-MM-DD' (comparación lexicográfica válida).
 * @returns {{ status: 'absent', isJustified: boolean, isChargeable: boolean, generatesCredit: boolean }}
 */
export function deriveAbsence({ isJustified, date, today, monthPaid }) {
  const isFuture = date > today
  const isChargeable = !(isJustified && isFuture && !monthPaid)
  const generatesCredit = isJustified && isChargeable
  return { status: 'absent', isJustified: !!isJustified, isChargeable, generatesCredit }
}

/** Clases Tailwind de la celda del calendario por status + atributos de falta. */
export function dayStyle(status, isJustified, isChargeable) {
  if (status === 'attended') return 'bg-green-500 text-white'
  if (status === 'absent') {
    if (!isJustified) return 'bg-red-500 text-white'
    return isChargeable ? 'bg-red-300 text-white' : 'bg-orange-400 text-white'
  }
  if (status === 'recovery') return 'bg-blue-500 text-white'
  if (status === 'scheduled') return 'bg-gray-200 text-gray-600'
  return ''
}

/** { title, reason } — reason es el motivo libre (notes) cuando la falta lo tiene. */
export function dayTooltip(status, isJustified, isChargeable, notes) {
  let title = ''
  if (status === 'attended') title = 'Asistió'
  else if (status === 'absent') {
    if (!isJustified) title = 'Falta no justificada'
    else title = isChargeable ? 'Falta justificada (+1 recupero)' : 'Falta justificada (no cobrable)'
  }
  else if (status === 'recovery') title = 'Día recuperado'
  else if (status === 'scheduled') title = 'Programado'
  const reason = status === 'absent' && notes ? notes : null
  return { title, reason }
}

/** Texto predecible del resultado, para el modal de registro de falta. */
export function outcomePreview({ isJustified, date, today, monthPaid }) {
  if (!isJustified) return 'Se cobra el día igual. Sin crédito de recupero.'
  const { generatesCredit } = deriveAbsence({ isJustified, date, today, monthPaid })
  return generatesCredit
    ? 'Se cobra el día y se acredita 1 día de recupero.'
    : 'No se cobra el día (sin recupero).'
}
