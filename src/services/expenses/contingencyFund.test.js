import { contingencyLimit, contingencyStatus } from './contingencyFund'

describe('contingencyLimit', () => {
  test('applies the percentage to the monthlyized base', () => {
    expect(contingencyLimit(100000, 10)).toBe(10000)
  })
  test('zero base gives zero limit', () => {
    expect(contingencyLimit(0, 10)).toBe(0)
  })
})

describe('contingencyStatus', () => {
  test('under limit: partial fill, positive remaining, not over', () => {
    expect(contingencyStatus(2500, 10000)).toEqual({ fillPct: 25, remaining: 7500, over: false })
  })
  test('exactly at limit: 100% fill, zero remaining, not over', () => {
    expect(contingencyStatus(10000, 10000)).toEqual({ fillPct: 100, remaining: 0, over: false })
  })
  test('over limit: fill capped at 100, negative remaining, over true', () => {
    expect(contingencyStatus(12000, 10000)).toEqual({ fillPct: 100, remaining: -2000, over: true })
  })
  test('zero limit with spend: 100% fill and over', () => {
    expect(contingencyStatus(500, 0)).toEqual({ fillPct: 100, remaining: -500, over: true })
  })
  test('zero limit with zero spend: 0% fill and not over', () => {
    expect(contingencyStatus(0, 0)).toEqual({ fillPct: 0, remaining: 0, over: false })
  })
})
