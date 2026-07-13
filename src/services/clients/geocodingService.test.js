import { haversineKm, distanceToRange, resolveInitialCenter, routeDistanceKm } from './geocodingService'

const CLUB = { lat: -34.8969, lng: -56.1470 }
const PIN = { lat: -34.9, lng: -56.15 }

// Build a mock DistanceMatrixService whose callback receives (res, status).
const mockService = (res, status) => ({
  getDistanceMatrix: (_req, cb) => cb(res, status)
})
const okRes = meters => ({ rows: [{ elements: [{ status: 'OK', distance: { value: meters } }] }] })

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

describe('routeDistanceKm', () => {
  test('returns road distance in km (meters / 1000) on OK', async () => {
    const km = await routeDistanceKm(mockService(okRes(3400), 'OK'), CLUB, PIN)
    expect(km).toBe(3.4)
  })

  test('null on top-level non-OK status', async () => {
    const km = await routeDistanceKm(mockService(okRes(3400), 'OVER_QUERY_LIMIT'), CLUB, PIN)
    expect(km).toBeNull()
  })

  test('null on element-level ZERO_RESULTS', async () => {
    const res = { rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] }
    const km = await routeDistanceKm(mockService(res, 'OK'), CLUB, PIN)
    expect(km).toBeNull()
  })

  test('null when the service throws', async () => {
    const throwing = { getDistanceMatrix: () => { throw new Error('boom') } }
    const km = await routeDistanceKm(throwing, CLUB, PIN)
    expect(km).toBeNull()
  })

  test('null when service or points are missing', async () => {
    expect(await routeDistanceKm(null, CLUB, PIN)).toBeNull()
    expect(await routeDistanceKm(mockService(okRes(100), 'OK'), null, PIN)).toBeNull()
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
