import { attendanceRate, monthKpis, breakdownByDimension, trendSeries } from './attendanceStats'

const row = (over = {}) => ({
  year: 2026, month: 5,
  frequency: null, schedule: null, cognitiveLevel: null,
  attended: 0, absentJustified: 0, absentUnjustified: 0, recovery: 0, vacation: 0, scheduled: 0,
  ...over
})

describe('attendanceRate', () => {
  test('(attended + recovery) / (attended + recovery + absences)', () => {
    expect(attendanceRate({ attended: 8, recovery: 2, absentJustified: 2, absentUnjustified: 3 }))
      .toBeCloseTo(10 / 15, 6)
  })
  test('vacation and scheduled excluded from denominator', () => {
    // 8 attended, 2 absent → 8/10, vacation/scheduled ignored
    expect(attendanceRate({ attended: 8, absentUnjustified: 2, vacation: 5, scheduled: 4 }))
      .toBeCloseTo(0.8, 6)
  })
  test('null when denominator is 0', () => {
    expect(attendanceRate({ attended: 0, recovery: 0, absentJustified: 0, absentUnjustified: 0 })).toBeNull()
    expect(attendanceRate({ vacation: 5, scheduled: 3 })).toBeNull()
  })
  test('falta justificada cobrable cuenta como ausencia; no cobrable no', () => {
    // 8 attended, 1 absentJustified (cobrable) → 8/9; vacation (no cobrable) y scheduled ignorados
    expect(attendanceRate({ attended: 8, absentJustified: 1, vacation: 5, scheduled: 4 }))
      .toBeCloseTo(8 / 9)
  })
})

describe('monthKpis', () => {
  const rows = [
    row({ month: 5, attended: 5, absentUnjustified: 1, recovery: 1, vacation: 2 }),
    row({ month: 5, attended: 3, absentJustified: 2 }),
    row({ month: 4, attended: 100 }) // different month, ignored
  ]
  test('sums the target month only', () => {
    const k = monthKpis(rows, 2026, 5)
    expect(k.attended).toBe(8)
    expect(k.absentJustified).toBe(2)
    expect(k.absentUnjustified).toBe(1)
    expect(k.recovery).toBe(1)
    expect(k.vacation).toBe(2)
    // (8+1)/(8+1+2+1) = 9/12
    expect(k.attendanceRate).toBeCloseTo(9 / 12, 6)
  })
  test('null rate when month has no chargeable records', () => {
    expect(monthKpis([row({ month: 5, vacation: 3 })], 2026, 5).attendanceRate).toBeNull()
    expect(monthKpis([], 2026, 5).attendanceRate).toBeNull()
  })
})

describe('breakdownByDimension', () => {
  const rows = [
    row({ frequency: 3, attended: 4, absentUnjustified: 1 }),
    row({ frequency: 3, attended: 2 }),
    row({ frequency: 1, attended: 1, absentJustified: 1 }),
    row({ frequency: null, attended: 99 }) // no plan → skipped
  ]
  test('groups and sorts by frequency asc, skips null keys', () => {
    const out = breakdownByDimension(rows, 2026, 5, 'frequency')
    expect(out.map(s => s.key)).toEqual([1, 3])
    expect(out[0]).toMatchObject({ key: 1, label: '1× semana', attended: 1, absences: 1 })
    expect(out[0].rate).toBeCloseTo(1 / 2, 6)
    expect(out[1]).toMatchObject({ key: 3, label: '3× semana', attended: 6, absences: 1 })
    expect(out[1].rate).toBeCloseTo(6 / 7, 6)
  })
  test('schedule dimension sorted morning/afternoon/full_day', () => {
    const sr = [
      row({ schedule: 'full_day', attended: 1 }),
      row({ schedule: 'morning', attended: 1 }),
      row({ schedule: 'afternoon', attended: 1 })
    ]
    expect(breakdownByDimension(sr, 2026, 5, 'schedule').map(s => s.key))
      .toEqual(['morning', 'afternoon', 'full_day'])
  })
  test('tier dimension sorted A..D with labels', () => {
    const tr = [row({ cognitiveLevel: 'C', attended: 1 }), row({ cognitiveLevel: 'A', attended: 1 })]
    const out = breakdownByDimension(tr, 2026, 5, 'cognitiveLevel')
    expect(out.map(s => s.key)).toEqual(['A', 'C'])
    expect(out[0].label).toBe('Tier A')
  })
  test('empty for unknown dimension', () => {
    expect(breakdownByDimension(rows, 2026, 5, 'nope')).toEqual([])
  })
})

describe('trendSeries', () => {
  const rows = [
    row({ year: 2026, month: 4, attended: 8, absentUnjustified: 2 }), // May → 0.8
    row({ year: 2026, month: 5, attended: 9, absentUnjustified: 1 })  // Jun → 0.9
  ]
  test('trailing window with Spanish labels ending at target month', () => {
    const out = trendSeries(rows, 3, 2026, 5)
    expect(out).toHaveLength(3)
    expect(out.map(m => m.label)).toEqual(['Abr', 'May', 'Jun'])
    expect(out[0].rate).toBeNull()          // Abr no data
    expect(out[1].rate).toBeCloseTo(0.8, 6) // May
    expect(out[2].rate).toBeCloseTo(0.9, 6) // Jun
  })
  test('crosses year boundary correctly', () => {
    const out = trendSeries([], 2, 2026, 0) // Ene 2026 back to Dic 2025
    expect(out).toEqual([
      { year: 2025, month: 11, label: 'Dic', rate: null },
      { year: 2026, month: 0, label: 'Ene', rate: null }
    ])
  })
})
