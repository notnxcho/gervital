import { isInactiveOn } from './inactivityPeriods'

describe('isInactiveOn', () => {
  const periods = [{ fromDate: '2026-03-10', toDate: '2026-06-15' }]

  test('día antes del período: activo', () => {
    expect(isInactiveOn('2026-03-09', periods)).toBe(false)
  })
  test('primer día del gap (from inclusive): inactivo', () => {
    expect(isInactiveOn('2026-03-10', periods)).toBe(true)
  })
  test('día en medio del gap: inactivo', () => {
    expect(isInactiveOn('2026-05-01', periods)).toBe(true)
  })
  test('día de reintegro (to exclusive): activo', () => {
    expect(isInactiveOn('2026-06-15', periods)).toBe(false)
  })
  test('período abierto (to null): inactivo desde from en adelante', () => {
    expect(isInactiveOn('2027-01-01', [{ fromDate: '2026-03-10', toDate: null }])).toBe(true)
  })
  test('múltiples períodos: matchea cualquiera', () => {
    const two = [
      { fromDate: '2026-03-10', toDate: '2026-06-15' },
      { fromDate: '2026-09-01', toDate: null }
    ]
    expect(isInactiveOn('2026-07-01', two)).toBe(false)
    expect(isInactiveOn('2026-09-02', two)).toBe(true)
  })
  test('sin períodos / null: activo', () => {
    expect(isInactiveOn('2026-05-01', [])).toBe(false)
    expect(isInactiveOn('2026-05-01', null)).toBe(false)
  })
})
