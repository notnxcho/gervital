import { endOfMonth, isWeekend, subDays } from 'date-fns'

// Último día hábil del mes (lun-vie). month is 0-indexed.
export function lastBusinessDayOfMonth(year, month) {
  let d = endOfMonth(new Date(year, month, 1))
  while (isWeekend(d)) d = subDays(d, 1)
  return d
}
