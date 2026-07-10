import {
  promoOrdinal, classifyPromotions, promoKpis, promoCashRow
} from './promotionsView'

// month is 0-indexed everywhere (0 = enero ... 11 = diciembre), except inside
// 'YYYY-MM-DD' date strings, where the month segment is 1-indexed (calendar convention).
const promo = (over) => ({
  id: 'p', clientId: 'c', discountPercent: 15,
  startYear: 2026, startMonth: 5, endYear: 2026, endMonth: 7, // 2026-06 .. 2026-08
  paidDate: '2026-06-05', paidAmount: 30000, ...over
})

describe('promoOrdinal', () => {
  test('year*12+month', () => {
    expect(promoOrdinal(2026, 0)).toBe(24312)
    expect(promoOrdinal(2026, 5)).toBe(24317)
  })
})

describe('classifyPromotions', () => {
  test('ref dentro del rango, lejos del final -> active (y no upcoming/historical)', () => {
    // promo() default: 2026-06 .. 2026-08. ref = 2026-06 (month 5, 0-indexed).
    // e (2026-08 = 24319) no coincide con ref (24317) ni con ref+1 (24318), asi que
    // no dispara la regla de "por vencer".
    const { active, upcoming, historical } = classifyPromotions([promo()], 2026, 5)
    expect(active).toHaveLength(1)
    expect(upcoming).toHaveLength(0)
    expect(historical).toHaveLength(0)
  })

  test('rango terminado antes del ref -> historical', () => {
    const { historical } = classifyPromotions(
      [promo({ startYear: 2026, startMonth: 0, endYear: 2026, endMonth: 2 })], // 2026-01..2026-03
      2026, 6 // ref = 2026-07
    )
    expect(historical).toHaveLength(1)
  })

  test('rango que empieza en el futuro -> upcoming', () => {
    const { upcoming, active, historical } = classifyPromotions(
      [promo({ startYear: 2026, startMonth: 9, endYear: 2026, endMonth: 11 })], // 2026-10..2026-12
      2026, 6 // ref = 2026-07
    )
    expect(upcoming).toHaveLength(1)
    expect(active).toHaveLength(0)
    expect(historical).toHaveLength(0)
  })

  test('activa que termina en el ref tambien cuenta como upcoming (ultimo mes)', () => {
    const { active, upcoming } = classifyPromotions(
      [promo({ startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 6 })], // 2026-05..2026-07
      2026, 6 // ref = 2026-07 = end month
    )
    expect(active).toHaveLength(1)
    expect(upcoming).toHaveLength(1)
  })

  test('activa que termina en ref+1 tambien cuenta como upcoming', () => {
    const { active, upcoming } = classifyPromotions(
      [promo({ startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 6 })], // 2026-05..2026-07
      2026, 5 // ref = 2026-06, end month (7) = ref+1
    )
    expect(active).toHaveLength(1)
    expect(upcoming).toHaveLength(1)
  })
})

describe('promoKpis', () => {
  test('cash del periodo suma solo paidDate en el mes ref; descuento y conteos', () => {
    const promos = [
      // 2026-06..2026-08, pagada en junio -> activa en ref y su pago cae en el mes ref
      promo({ id: 'a', paidDate: '2026-06-05', paidAmount: 30000, discountPercent: 15 }),
      // 2026-02..2026-04, ya termino antes del ref -> historical, no activa
      promo({
        id: 'b', paidDate: '2026-05-20', paidAmount: 20000, discountPercent: 10,
        startYear: 2026, startMonth: 1, endYear: 2026, endMonth: 3
      }),
      // 2026-10..2026-12, arranca despues del ref -> upcoming, no activa
      promo({
        id: 'c', paidDate: '2026-10-01', paidAmount: 0, discountPercent: 20,
        startYear: 2026, startMonth: 9, endYear: 2026, endMonth: 11
      })
    ]
    const k = promoKpis(promos, 2026, 5) // ref = 2026-06 (month 5, 0-indexed)

    expect(k.activeCount).toBe(1) // solo 'a' esta activa en el ref ('b' ya termino, 'c' no empezo)
    expect(k.prepaidCashInPeriod).toBe(30000) // solo 'a' tiene paidDate en el mes de ref (2026-06)
    expect(k.upcomingCount).toBe(1) // solo 'c' arranca en el futuro
    // descuento de 'a' (unica activa): bruto = 30000 / (1 - 0.15) = 35294.117...; ahorro = bruto - 30000
    expect(k.totalDiscountGranted).toBe(5294)
  })
})

describe('promoCashRow', () => {
  test('mes prepago con cash atribuido a otro mes -> struck', () => {
    const r = promoCashRow({ promoTotal: 3, paymentStatus: 'paid', cashCollected: 0, paidAmount: 12000 })
    expect(r).toEqual({ struck: true, notional: 12000, cash: 0 })
  })
  test('mes del pago (cash > 0) -> no struck', () => {
    const r = promoCashRow({ promoTotal: 3, paymentStatus: 'paid', cashCollected: 45000, paidAmount: 12000 })
    expect(r.struck).toBe(false)
  })
  test('sin promo -> no struck', () => {
    const r = promoCashRow({ promoTotal: null, paymentStatus: 'paid', cashCollected: 0, paidAmount: 0 })
    expect(r.struck).toBe(false)
  })
})
