import { getPlanPriceSync } from './pricingService'

const data = [
  { frequency: 2, schedule: 'morning', priceNet: 100, priceGross: 122, effectiveYear: 2000, effectiveMonth: 0 },
  { frequency: 2, schedule: 'morning', priceNet: 200, priceGross: 244, effectiveYear: 2026, effectiveMonth: 6 },
  { frequency: 2, schedule: 'afternoon', priceNet: 150, priceGross: 183, effectiveYear: 2000, effectiveMonth: 0 }
]

test('picks the baseline version for a month before any edit', () => {
  expect(getPlanPriceSync(data, 2, 'morning', 2026, 5)).toEqual({ priceNet: 100, priceGross: 122 })
})

test('picks the newer version from its effective month onward', () => {
  expect(getPlanPriceSync(data, 2, 'morning', 2026, 6)).toEqual({ priceNet: 200, priceGross: 244 })
  expect(getPlanPriceSync(data, 2, 'morning', 2026, 11)).toEqual({ priceNet: 200, priceGross: 244 })
})

test('returns zeros when no combo matches', () => {
  expect(getPlanPriceSync(data, 5, 'full_day', 2026, 6)).toEqual({ priceNet: 0, priceGross: 0 })
})
