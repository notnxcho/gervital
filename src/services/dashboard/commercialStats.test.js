import {
  activeClientsInMonth,
  baseComposition,
  mrrForClient,
  mrrTotal,
  flowSeries,
  churnKpis,
  bajasByReason
} from './commercialStats'

const client = (over = {}) => ({
  plan: { frequency: 2, schedule: 'morning', hasTransport: false },
  cognitiveLevel: 'A',
  startDate: '2026-01-15',
  deletedAt: null,
  deactivationDate: null,
  deactivationReason: null,
  ...over
})

// pricing fixture (getPlanPriceSync shape)
const pricing = [
  { frequency: 2, schedule: 'morning', priceNet: 1000, priceGross: 1220 },
  { frequency: 3, schedule: 'full_day', priceNet: 2000, priceGross: 2440 }
]

describe('baseComposition', () => {
  const clients = [
    client({ cognitiveLevel: 'A' }),
    client({ cognitiveLevel: 'A' }),
    client({ cognitiveLevel: 'C' }),
    client({ cognitiveLevel: 'B', deletedAt: '2026-05-01' }) // inactive → excluded
  ]
  test('counts active clients per tier, sorted A..D, tier colors', () => {
    const out = baseComposition(clients, 'cognitiveLevel')
    expect(out.map(s => [s.key, s.value])).toEqual([['A', 2], ['C', 1]])
    expect(out[0].label).toBe('Tier A')
    expect(out[0].color).toBe('#16a34a')
    expect(out[1].color).toBe('#d97706') // C tier color
  })
  test('frequency dimension uses categorical palette', () => {
    const fr = [client({ plan: { frequency: 1 } }), client({ plan: { frequency: 3 } })]
    const out = baseComposition(fr, 'frequency')
    expect(out.map(s => s.key)).toEqual([1, 3])
    expect(out[0].color).toBe('#4f46e5')
    expect(out[0].label).toBe('1× semana')
  })
  test('skips clients missing the dimension value', () => {
    const out = baseComposition([client({ plan: {} })], 'frequency')
    expect(out).toEqual([])
  })
})

describe('mrr', () => {
  test('mrrForClient returns gross price for the plan', () => {
    expect(mrrForClient(client(), pricing)).toBe(1220)
  })
  test('mrrForClient 0 when plan unknown in pricing', () => {
    expect(mrrForClient(client({ plan: { frequency: 5, schedule: 'morning' } }), pricing)).toBe(0)
    expect(mrrForClient(client({ plan: {} }), pricing)).toBe(0)
  })
  test('mrrTotal sums active clients only', () => {
    const clients = [
      client(),                                   // 1220
      client({ plan: { frequency: 3, schedule: 'full_day' } }), // 2440
      client({ deletedAt: '2026-05-01' })         // inactive → 0
    ]
    expect(mrrTotal(clients, pricing)).toBe(1220 + 2440)
  })
})

describe('flowSeries', () => {
  const clients = [
    client({ startDate: '2026-05-10' }),
    client({ startDate: '2026-06-01' }),
    client({ startDate: '2026-06-20', deactivationDate: '2026-06-25' }),
    client({ startDate: '2026-01-01', deactivationDate: '2026-05-15' })
  ]
  test('counts altas/bajas per month with Spanish labels', () => {
    const out = flowSeries(clients, 3, 2026, 6) // Abr, May, Jun... wait endMonth 6 = Jul
    // months: May(4), Jun(5), Jul(6)
    expect(out.map(m => m.label)).toEqual(['May', 'Jun', 'Jul'])
    expect(out[0]).toMatchObject({ month: 4, altas: 1, bajas: 1 }) // May: 1 alta, 1 baja
    expect(out[1]).toMatchObject({ month: 5, altas: 2, bajas: 1 }) // Jun: 2 altas, 1 baja
    expect(out[2]).toMatchObject({ month: 6, altas: 0, bajas: 0 })
  })
})

describe('churnKpis', () => {
  const clients = [
    client({ startDate: '2026-01-01' }),                              // active since Jan, part of base
    client({ startDate: '2026-02-01' }),                              // active since Feb, part of base
    client({ startDate: '2026-06-05' }),                             // alta in Jun
    client({ startDate: '2026-03-01', deactivationDate: '2026-06-20', deletedAt: '2026-06-20', deactivationReason: 'financial' }) // baja in Jun, was in base
  ]
  test('base-at-start, churn rate, mrr gained/lost', () => {
    const k = churnKpis(clients, 2026, 5, pricing) // month 5 = Jun
    // base at start of Jun: clients starting before Jun and not deactivated before Jun
    // = Jan, Feb, Mar-client (deact Jun, not before) = 3
    expect(k.altas).toBe(1)
    expect(k.bajas).toBe(1)
    expect(k.churnRate).toBeCloseTo((1 / 3) * 100, 6)
    expect(k.mrrGained).toBe(1220) // the Jun alta
    expect(k.mrrLost).toBe(1220)   // the Jun baja
    expect(k.activeCount).toBe(3)  // one is deletedAt
  })
  test('avgTenureMonths uses deactivationDate or today', () => {
    const k = churnKpis(
      [client({ startDate: '2026-01-01', deactivationDate: '2026-04-01' })], // 3 months
      2026, 5, pricing
    )
    expect(k.avgTenureMonths).toBe(3)
  })
  test('churnRate 0 when no base', () => {
    const k = churnKpis([client({ startDate: '2026-06-01' })], 2026, 5, pricing)
    expect(k.churnRate).toBe(0)
  })
})

describe('bajasByReason', () => {
  const clients = [
    client({ deactivationDate: '2026-05-10', deactivationReason: 'financial' }),
    client({ deactivationDate: '2026-06-01', deactivationReason: 'financial' }),
    client({ deactivationDate: '2026-06-15', deactivationReason: 'death' }),
    client({ deactivationDate: '2026-06-20', deactivationReason: null }), // → other
    client({ deactivationDate: '2026-12-01', deactivationReason: 'death' }) // out of range
  ]
  test('groups deactivations in range with Spanish labels, reason order', () => {
    const out = bajasByReason(clients, 2026, 5, 2026, 6) // Jun..Jul (month 5,6)
    // in range: Jun financial, Jun death, Jun other. May is out (month 4).
    const map = Object.fromEntries(out.map(r => [r.reason, r.value]))
    expect(map).toEqual({ death: 1, financial: 1, other: 1 })
    // ordered: death before financial before other
    expect(out.map(r => r.reason)).toEqual(['death', 'financial', 'other'])
    expect(out.find(r => r.reason === 'death').label).toBe('Fallecimiento')
    expect(out.find(r => r.reason === 'other').label).toBe('Otro')
  })
})

describe('activeClientsInMonth', () => {
  const clients = [
    { startDate: '2026-01-10', deactivationDate: null },              // activo desde ene
    { startDate: '2026-06-05', deactivationDate: null },              // alta en junio
    { startDate: '2026-02-01', deactivationDate: '2026-05-20' },      // baja en mayo
    { startDate: '2026-07-01', deactivationDate: null }               // alta futura (julio)
  ]
  test('cuenta activos en el mes (junio 2026, month 5)', () => {
    // cliente1 (activo), cliente2 (alta junio) → 2; cliente3 se fue en mayo, cliente4 aún no entra
    expect(activeClientsInMonth(clients, 2026, 5)).toBe(2)
  })
  test('una baja dentro del mes todavía cuenta ese mes', () => {
    // mayo 2026 (month 4): cliente1, cliente3 (baja este mes) → 2
    expect(activeClientsInMonth(clients, 2026, 4)).toBe(2)
  })
  test('mes anterior a cualquier alta = 0', () => {
    expect(activeClientsInMonth(clients, 2025, 11)).toBe(0)
  })
})
