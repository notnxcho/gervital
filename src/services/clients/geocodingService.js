/**
 * Calculate distance in km between two lat/lng points using the Haversine formula.
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
 * Driving route distance in km between two points, via Google Distance Matrix.
 * Resolves to the road distance in km, or null on any failure (API not enabled,
 * ZERO_RESULTS, network error, missing service) so callers can fall back to haversine.
 * @param {google.maps.DistanceMatrixService} service
 * @param {{lat:number,lng:number}} origin
 * @param {{lat:number,lng:number}} destination
 */
export async function routeDistanceKm(service, origin, destination) {
  if (!service || !origin || !destination) return null
  return new Promise(resolve => {
    try {
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: 'DRIVING'
        },
        (res, status) => {
          const el = status === 'OK' && res?.rows?.[0]?.elements?.[0]
          if (el && el.status === 'OK' && el.distance?.value != null) {
            resolve(el.distance.value / 1000)
          } else {
            resolve(null)
          }
        }
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * Determine the distance range bucket from a distance in km.
 */
export function distanceToRange(km) {
  if (km < 2) return '0_to_2km'
  if (km < 5) return '2_to_5km'
  return '5_to_10km'
}

/**
 * Decide the initial map center: stored coords > geocoded coords > club.
 * Pure helper so the center logic is testable without Google.
 */
export function resolveInitialCenter(initialCoords, geocoded, club) {
  if (initialCoords && initialCoords.lat != null && initialCoords.lng != null) {
    return { lat: initialCoords.lat, lng: initialCoords.lng }
  }
  if (geocoded && geocoded.lat != null && geocoded.lng != null) {
    return { lat: geocoded.lat, lng: geocoded.lng }
  }
  return { lat: club.lat, lng: club.lng }
}

/**
 * Forward-geocode an address string with Google. Restricted to Uruguay.
 * Returns { lat, lng, formattedAddress } or null.
 * @param {google.maps.Geocoder} geocoder
 * @param {string} address
 */
export async function geocodeWithGoogle(geocoder, address) {
  if (!geocoder || !address || address.trim().length < 5) return null
  return new Promise(resolve => {
    geocoder.geocode(
      {
        address: `${address}, Montevideo, Uruguay`,
        componentRestrictions: { country: 'uy' }
      },
      (results, status) => {
        if (status === 'OK' && results && results[0]) {
          const loc = results[0].geometry.location
          resolve({
            lat: loc.lat(),
            lng: loc.lng(),
            formattedAddress: results[0].formatted_address
          })
        } else {
          resolve(null)
        }
      }
    )
  })
}

/**
 * Reverse-geocode a coordinate with Google. Returns a formatted address or null.
 * @param {google.maps.Geocoder} geocoder
 * @param {{lat:number,lng:number}} latlng
 */
export async function reverseGeocode(geocoder, latlng) {
  if (!geocoder || !latlng) return null
  return new Promise(resolve => {
    geocoder.geocode({ location: latlng }, (results, status) => {
      resolve(status === 'OK' && results && results[0] ? results[0].formatted_address : null)
    })
  })
}
