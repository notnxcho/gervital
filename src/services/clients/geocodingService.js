import { CLUB_LOCATION } from '../transport/transportConstants'

/**
 * Geocode an address string using Nominatim (OpenStreetMap).
 * Returns { lat, lng } or null if not found.
 */
export async function geocodeAddress(street) {
  if (!street || street.trim().length < 5) return null
  const query = `${street}, Montevideo, Uruguay`
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    countrycodes: 'uy'
  })}`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'gervital-app/1.0' }
    })
    const data = await res.json()
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      }
    }
  } catch (e) {
    console.warn('Geocoding failed:', e.message)
  }
  return null
}

/**
 * Calculate distance in km between two lat/lng points using Haversine formula.
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Determine the distance range bucket from a distance in km.
 */
export function distanceToRange(km) {
  if (km < 1) return 'under_1km'
  if (km < 5) return '1_to_5km'
  if (km < 10) return '5_to_10km'
  return 'over_10km'
}

/**
 * Geocode a street address and return { lat, lng, distanceRange } relative to the club.
 * Returns null fields if geocoding fails.
 */
export async function geocodeAndCalculateDistance(street) {
  const coords = await geocodeAddress(street)
  if (!coords) return { lat: null, lng: null, distanceRange: null }

  const km = haversineKm(coords.lat, coords.lng, CLUB_LOCATION.lat, CLUB_LOCATION.lng)
  return {
    lat: coords.lat,
    lng: coords.lng,
    distanceRange: distanceToRange(km)
  }
}
