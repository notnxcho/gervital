import { subMonths, startOfMonth } from 'date-fns'

// Ventana de datos compartida por el dashboard (header + secciones): últimos 24 meses
// terminando en el mes actual. El mes seleccionado se mueve dentro de esta ventana.
export const RANGE_MONTHS = 24
export const TODAY = startOfMonth(new Date())
export const WINDOW_START = subMonths(TODAY, RANGE_MONTHS - 1)

export const inWindow = (y, m) => {
  const d = new Date(y, m, 1)
  return d >= WINDOW_START && d <= TODAY
}
