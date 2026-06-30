import { format } from 'date-fns'
import { lastBusinessDayOfMonth } from './date'

const iso = (d) => format(d, 'yyyy-MM-dd')

describe('lastBusinessDayOfMonth', () => {
  test('returns the last day when it is a weekday', () => {
    // Jun 2026 ends on Tuesday the 30th
    expect(iso(lastBusinessDayOfMonth(2026, 5))).toBe('2026-06-30')
  })
  test('steps back when the month ends on Sunday', () => {
    // May 2026 ends on Sunday the 31st → Friday the 29th
    expect(iso(lastBusinessDayOfMonth(2026, 4))).toBe('2026-05-29')
  })
  test('steps back when the month ends on Saturday', () => {
    // Jan 2026 ends on Saturday the 31st → Friday the 30th
    expect(iso(lastBusinessDayOfMonth(2026, 0))).toBe('2026-01-30')
  })
})
