import { haversineKm, distanceToRange, resolveInitialCenter } from './geocodingService'

const CLUB = { lat: -34.8969, lng: -56.1470 }

describe('haversineKm', () => {
  test('distance to itself is zero', () => {
    expect(haversineKm(CLUB.lat, CLUB.lng, CLUB.lat, CLUB.lng)).toBeCloseTo(0, 5)
  })

  test('~1.11 km per 0.01 degree of latitude', () => {
    const km = haversineKm(CLUB.lat, CLUB.lng, CLUB.lat + 0.01, CLUB.lng)
    expect(km).toBeGreaterThan(1.0)
    expect(km).toBeLessThan(1.2)
  })
})

describe('distanceToRange', () => {
  test('below 2 km', () => {
    expect(distanceToRange(0)).toBe('0_to_2km')
    expect(distanceToRange(1.99)).toBe('0_to_2km')
  })

  test('2 km boundary falls into 2_to_5km', () => {
    expect(distanceToRange(2)).toBe('2_to_5km')
    expect(distanceToRange(4.99)).toBe('2_to_5km')
  })

  test('5 km boundary falls into 5_to_10km', () => {
    expect(distanceToRange(5)).toBe('5_to_10km')
    expect(distanceToRange(50)).toBe('5_to_10km')
  })
})

describe('resolveInitialCenter', () => {
  test('prefers initial coords when present', () => {
    const r = resolveInitialCenter({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, CLUB)
    expect(r).toEqual({ lat: 1, lng: 2 })
  })

  test('falls back to geocoded when no initial coords', () => {
    const r = resolveInitialCenter(null, { lat: 3, lng: 4 }, CLUB)
    expect(r).toEqual({ lat: 3, lng: 4 })
  })

  test('falls back to club when nothing else', () => {
    const r = resolveInitialCenter(null, null, CLUB)
    expect(r).toEqual({ lat: CLUB.lat, lng: CLUB.lng })
  })

  test('ignores partial coords (null lng)', () => {
    const r = resolveInitialCenter({ lat: 1, lng: null }, null, CLUB)
    expect(r).toEqual({ lat: CLUB.lat, lng: CLUB.lng })
  })
})
