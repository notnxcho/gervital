# Previsualización y corrección de ubicación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir previsualizar en un mapa la ubicación que Google obtiene de la dirección escrita y corregirla arrastrando un pin, en el alta/edición de cliente.

**Architecture:** Un modal (`LocationPickerModal`) muestra un mapa de Google con un pin arrastrable. La geocodificación pasa de Nominatim a `google.maps.Geocoder`. El servicio `geocodingService` conserva las funciones puras (distancia/rango) y agrega wrappers de Google + un helper puro para el centro inicial. `AddClient` guarda `latitude`/`longitude`/`distanceRange` en el form vía el callback del modal; la persistencia no cambia.

**Tech Stack:** React 19, `@react-google-maps/api` 2.20 (`useJsApiLoader`, `GoogleMap`, `MarkerF`), Jest (via `craco test`), Tailwind (compilación manual).

---

## File Structure

- **Create** `src/pages/Clients/LocationPickerModal.jsx` — modal con mapa de Google, pin arrastrable, geocoding/reverse-geocoding, cálculo de rango en vivo.
- **Rewrite** `src/services/clients/geocodingService.js` — elimina Nominatim; agrega `geocodeWithGoogle`, `reverseGeocode`, `resolveInitialCenter`; conserva `haversineKm`, `distanceToRange`.
- **Create** `src/services/clients/geocodingService.test.js` — tests de las funciones puras.
- **Modify** `src/pages/Clients/AddClient.jsx` — campos `latitude`/`longitude` en el form, botón + chip en la sección Dirección, render del modal, submit sin re-geocodificar.

---

## Task 1: Servicio de geocoding (funciones puras + wrappers de Google)

**Files:**
- Rewrite: `src/services/clients/geocodingService.js`
- Test: `src/services/clients/geocodingService.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/services/clients/geocodingService.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- src/services/clients/geocodingService.test.js --watchAll=false`
Expected: FAIL — `resolveInitialCenter is not a function` (no existe aún) o import error.

- [ ] **Step 3: Rewrite the service**

Replace the entire contents of `src/services/clients/geocodingService.js`:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- src/services/clients/geocodingService.test.js --watchAll=false`
Expected: PASS — 4 suites de assertions, todas verdes.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/geocodingService.js src/services/clients/geocodingService.test.js
git commit -m "feat(clients): geocoding con Google + helpers puros testeados"
```

---

## Task 2: Modal de selección de ubicación

**Files:**
- Create: `src/pages/Clients/LocationPickerModal.jsx`

> Nota: no lleva unit test — el componente depende de la API de Google Maps, que no se testea unitariamente. Se verifica manualmente en la Task 4.

- [ ] **Step 1: Create the component**

Create `src/pages/Clients/LocationPickerModal.jsx`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader, MarkerF, OverlayViewF, OverlayView } from '@react-google-maps/api'
import { HomeAlt } from 'iconoir-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { CLUB_LOCATION } from '../../services/transport/transportConstants'
import {
  haversineKm,
  distanceToRange,
  resolveInitialCenter,
  geocodeWithGoogle,
  reverseGeocode
} from '../../services/clients/geocodingService'

const DISTANCE_LABELS = { '0_to_2km': '0 a 2 km', '2_to_5km': '2 a 5 km', '5_to_10km': '5 a 10 km' }

const MAP_CONTAINER_STYLE = { width: '100%', height: '340px' }

const MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  styles: [
    { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] }
  ]
}

const CLUB_BADGE_SIZE = 40
const getClubOffset = () => ({ x: -CLUB_BADGE_SIZE / 2, y: -CLUB_BADGE_SIZE / 2 })

export default function LocationPickerModal({ isOpen, address, initialCoords, onConfirm, onClose }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || ''
  })

  const geocoderRef = useRef(null)
  const mapRef = useRef(null)
  const [coords, setCoords] = useState(null)
  const [distanceRange, setDistanceRange] = useState(null)
  const [formattedAddress, setFormattedAddress] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | ready | not_found

  const computeRange = useCallback((lat, lng) => {
    const km = haversineKm(lat, lng, CLUB_LOCATION.lat, CLUB_LOCATION.lng)
    return distanceToRange(km)
  }, [])

  // On open: resolve the initial pin (stored coords > geocoded address > club).
  useEffect(() => {
    if (!isOpen || !isLoaded) return
    let cancelled = false
    setStatus('loading')
    geocoderRef.current = geocoderRef.current || new window.google.maps.Geocoder()

    const run = async () => {
      let geocoded = null
      let foundLabel = ''
      if (!initialCoords) {
        const g = await geocodeWithGoogle(geocoderRef.current, address)
        if (g) {
          geocoded = { lat: g.lat, lng: g.lng }
          foundLabel = g.formattedAddress
        }
      }
      const center = resolveInitialCenter(initialCoords, geocoded, CLUB_LOCATION)
      if (initialCoords) {
        foundLabel = await reverseGeocode(geocoderRef.current, center) || ''
      }
      if (cancelled) return
      setCoords(center)
      setDistanceRange(computeRange(center.lat, center.lng))
      setFormattedAddress(foundLabel)
      setStatus(!initialCoords && !geocoded ? 'not_found' : 'ready')
    }
    run()
    return () => { cancelled = true }
  }, [isOpen, isLoaded, address, initialCoords, computeRange])

  const onDragEnd = useCallback(async (e) => {
    const lat = e.latLng.lat()
    const lng = e.latLng.lng()
    setCoords({ lat, lng })
    setDistanceRange(computeRange(lat, lng))
    setStatus('ready')
    const label = await reverseGeocode(geocoderRef.current, { lat, lng })
    if (label) setFormattedAddress(label)
  }, [computeRange])

  const handleConfirm = () => {
    if (!coords) return
    onConfirm({ lat: coords.lat, lng: coords.lng, distanceRange, formattedAddress })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirmar ubicación" size="xl">
      {loadError && (
        <div className="py-10 text-center text-sm text-gray-500">
          No se pudo cargar Google Maps. Podés definir la distancia manualmente en el formulario.
        </div>
      )}

      {!loadError && !isLoaded && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      )}

      {!loadError && isLoaded && (
        <div>
          <div className="relative rounded-xl overflow-hidden border border-gray-200">
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER_STYLE}
              center={coords || CLUB_LOCATION}
              zoom={15}
              options={MAP_OPTIONS}
              onLoad={map => { mapRef.current = map }}
            >
              <OverlayViewF
                position={CLUB_LOCATION}
                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                getPixelPositionOffset={getClubOffset}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow"
                  title="Centro Gervital"
                >
                  <HomeAlt width={18} height={18} strokeWidth={2} />
                </div>
              </OverlayViewF>

              {coords && (
                <MarkerF
                  position={coords}
                  draggable
                  onDragEnd={onDragEnd}
                />
              )}
            </GoogleMap>

            <div className="absolute top-3 left-3 right-3 rounded-lg bg-white/95 px-3 py-2 text-sm text-gray-700 shadow">
              {status === 'not_found'
                ? '📍 No pudimos ubicar la dirección. Arrastrá el pin al lugar correcto.'
                : '📍 Arrastrá el pin hasta la puerta exacta por donde se pasa a buscar al cliente'}
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs uppercase tracking-wide text-gray-400">El pin está en</div>
            <div className="text-sm text-gray-900">{formattedAddress || address || 'Ubicación sin descripción'}</div>
            <div className="mt-2 flex items-center gap-2">
              {distanceRange && (
                <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  Distancia al club: {DISTANCE_LABELS[distanceRange]}
                </span>
              )}
              <span className="text-xs text-gray-400">se recalcula al mover el pin</span>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={!coords}>Confirmar ubicación</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: Verify Button variant prop exists**

Run: `grep -n "variant" src/components/ui/Button.jsx`
Expected: a `variant` prop with a `secondary` option. If `secondary` does not exist, use the closest neutral variant available (e.g. `ghost`/`outline`) instead — adjust the `variant="secondary"` line accordingly. If `Button` takes no `variant`, drop the prop and leave a plain `<Button onClick={onClose}>Cancelar</Button>`.

- [ ] **Step 3: Verify the file compiles (lint/build parse)**

Run: `CI=true npx craco build 2>&1 | grep -i "LocationPickerModal\|Failed to compile" | head` — expect no errors referencing this file. (Full build also validates Task 3 later; a quick syntax check here is enough.)
Expected: sin errores de `LocationPickerModal`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients/LocationPickerModal.jsx
git commit -m "feat(clients): modal de previsualización y corrección de ubicación"
```

---

## Task 3: Integrar el modal en AddClient

**Files:**
- Modify: `src/pages/Clients/AddClient.jsx`

- [ ] **Step 1: Swap the geocoding import for the modal import**

In `src/pages/Clients/AddClient.jsx:6`, replace:

```jsx
import { geocodeAndCalculateDistance } from '../../services/clients/geocodingService'
```

with:

```jsx
import LocationPickerModal from './LocationPickerModal'
```

- [ ] **Step 2: Add lat/lng to INITIAL_FORM_DATA**

In `src/pages/Clients/AddClient.jsx`, in `INITIAL_FORM_DATA`, replace the line `  distanceRange: '',` (around line 98) with:

```jsx
  distanceRange: '',
  latitude: null,
  longitude: null,
```

- [ ] **Step 3: Load lat/lng in edit mode**

In the edit-mode `setFormData({...})` call, replace the line `          distanceRange: client.address?.distanceRange || '',` (around line 175) with:

```jsx
          distanceRange: client.address?.distanceRange || '',
          latitude: client.address?.latitude ?? null,
          longitude: client.address?.longitude ?? null,
```

- [ ] **Step 4: Replace geocoding state and remove the blur handler**

Replace the state line `  const [geocoding, setGeocoding] = useState(false)` (around line 134) with:

```jsx
  const [showLocationModal, setShowLocationModal] = useState(false)
```

Then delete the entire `handleStreetBlur` function (around lines 217-229):

```jsx
  const handleStreetBlur = async () => {
    if (!formData.street || formData.street.trim().length < 5) return
    setGeocoding(true)
    try {
      const geo = await geocodeAndCalculateDistance(formData.street)
      if (geo.distanceRange) {
        updateField('distanceRange', geo.distanceRange)
      }
    } catch (e) {
      console.warn('Geocoding on blur failed:', e)
    }
    setGeocoding(false)
  }
```

- [ ] **Step 5: Update the address field, add the button + confirmed chip**

In the "Dirección" section, replace the street `Input` (around lines 693-701):

```jsx
                  <Input
                    label="Dirección"
                    value={formData.street}
                    onChange={(e) => updateField('street', e.target.value)}
                    onBlur={handleStreetBlur}
                    error={errors.street}
                    placeholder="18 de Julio 1234, Montevideo"
                    className="col-span-2"
                  />
```

with (removes `onBlur`, adds a button + chip row below):

```jsx
                  <Input
                    label="Dirección"
                    value={formData.street}
                    onChange={(e) => updateField('street', e.target.value)}
                    error={errors.street}
                    placeholder="18 de Julio 1234, Montevideo"
                    className="col-span-2"
                  />
                  <div className="col-span-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowLocationModal(true)}
                      disabled={!formData.street || formData.street.trim().length < 5}
                      className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MapPin className="h-4 w-4" />
                      {formData.latitude != null ? 'Ajustar ubicación en el mapa' : 'Confirmar ubicación en el mapa'}
                    </button>
                    {formData.latitude != null && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                        Ubicación confirmada
                        {formData.distanceRange ? ` · ${DISTANCE_LABELS[formData.distanceRange]}` : ''}
                      </span>
                    )}
                  </div>
```

- [ ] **Step 6: Import the MapPin icon**

In `src/pages/Clients/AddClient.jsx:4`, replace:

```jsx
import { ArrowLeft, Check, Plus, Trash, Bus } from 'iconoir-react'
```

with:

```jsx
import { ArrowLeft, Check, Plus, Trash, Bus, MapPin } from 'iconoir-react'
```

- [ ] **Step 7: Update the "Distancia al club" Select label**

The Select label references the removed `geocoding` state. Replace (around line 715):

```jsx
                    label={geocoding ? 'Calculando distancia...' : 'Distancia al club'}
```

with:

```jsx
                    label="Distancia al club"
```

- [ ] **Step 8: Remove submit-time geocoding, use form coords**

In `handleSubmit`, replace the geocoding block (around lines 309-313):

```jsx
      // Geocode address to get lat/lng and auto-calculate distance range
      let geoData = { lat: null, lng: null, distanceRange: null }
      if (formData.street) {
        geoData = await geocodeAndCalculateDistance(formData.street)
      }

```

with (nothing — the coords now come from the form). Then update the `address` object (around lines 341-343):

```jsx
          latitude: geoData.lat,
          longitude: geoData.lng,
          distanceRange: formData.distanceRange || geoData.distanceRange
```

to:

```jsx
          latitude: formData.latitude,
          longitude: formData.longitude,
          distanceRange: formData.distanceRange
```

Then update the edit-mode coords call (around lines 369-371):

```jsx
        if (geoData.lat && geoData.lng) {
          await updateClientAddressCoords(id, geoData.lat, geoData.lng).catch(console.error)
        }
```

to:

```jsx
        if (formData.latitude != null && formData.longitude != null) {
          await updateClientAddressCoords(id, formData.latitude, formData.longitude).catch(console.error)
        }
```

And the create-mode coords call (around lines 387-389):

```jsx
        if (geoData.lat && geoData.lng && newClient?.id) {
          await updateClientAddressCoords(newClient.id, geoData.lat, geoData.lng).catch(console.error)
        }
```

to:

```jsx
        if (formData.latitude != null && formData.longitude != null && newClient?.id) {
          await updateClientAddressCoords(newClient.id, formData.latitude, formData.longitude).catch(console.error)
        }
```

- [ ] **Step 9: Render the modal**

Find the closing of the wizard content. Immediately before the final closing `</div>` of the component's returned tree (right after the step blocks, alongside other top-level JSX), add the modal render. Place it just before the outermost closing tags of the return. Add:

```jsx
      <LocationPickerModal
        isOpen={showLocationModal}
        address={formData.street}
        initialCoords={formData.latitude != null && formData.longitude != null
          ? { lat: formData.latitude, lng: formData.longitude }
          : null}
        onClose={() => setShowLocationModal(false)}
        onConfirm={(res) => {
          updateField('latitude', res.lat)
          updateField('longitude', res.lng)
          if (res.distanceRange) updateField('distanceRange', res.distanceRange)
          setShowLocationModal(false)
        }}
      />
```

> To find the exact insertion point: locate the `return (` of the `AddClient` component and its matching final `</div>` / closing paren. Insert the block as the last child element before that final closing wrapper. If the outermost element is a fragment or a single `<div>`, place it as the last child inside it.

- [ ] **Step 10: Verify the build compiles**

Run: `CI=true npx craco build 2>&1 | tail -20`
Expected: `Compiled successfully` (o sólo warnings de eslint preexistentes). Sin errores de `geocodeAndCalculateDistance`, `geocoding`, ni imports faltantes.

- [ ] **Step 11: Commit**

```bash
git add src/pages/Clients/AddClient.jsx
git commit -m "feat(clients): integrar modal de ubicación en alta/edición"
```

---

## Task 4: Compilar Tailwind y verificación manual

**Files:** ninguno (build + verificación)

- [ ] **Step 1: Recompilar Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: genera el CSS sin error. (Las clases nuevas usan utilidades estándar de Tailwind.)

- [ ] **Step 2: Levantar la app**

Run: `npm start` (o pedir al usuario `! npm start` si hace falta login/entorno).
Expected: compila y sirve en `http://localhost:3000`.

- [ ] **Step 3: Verificación manual — alta**

1. Ir a `Clientes → Nuevo cliente`.
2. En el paso 1, escribir una dirección real de Montevideo (p. ej. `18 de Julio 1234`).
3. Clic en "Confirmar ubicación en el mapa" → el modal abre, el pin cae sobre la dirección, se ve el marcador del club y el chip de distancia.
4. Arrastrar el pin → la dirección ("El pin está en…") y el rango de distancia se actualizan.
5. "Confirmar ubicación" → el modal cierra y aparece el chip verde "Ubicación confirmada · <rango>".
6. Completar el alta y guardar → verificar en `Transporte` (o en la DB) que el cliente aparece en el mapa en el punto elegido.

- [ ] **Step 4: Verificación manual — edición**

1. Editar un cliente que ya tiene ubicación.
2. Abrir el modal → el pin arranca en las coordenadas guardadas (no re-geocodifica la calle).
3. Corregir el pin, confirmar, guardar → verificar que las nuevas coordenadas persisten.

- [ ] **Step 5: Verificación manual — casos borde**

1. Dirección con menos de 5 caracteres → botón deshabilitado.
2. Dirección inexistente/absurda → el modal abre centrado en el club con el aviso "No pudimos ubicar la dirección…", y confirmar igual guarda el punto colocado a mano.

- [ ] **Step 6: Correr toda la suite de tests**

Run: `CI=true npm test -- --watchAll=false`
Expected: PASS (incluye el nuevo `geocodingService.test.js`; sin romper tests existentes).

- [ ] **Step 7: Commit del CSS compilado**

```bash
git add src/tailwind.output.css
git commit -m "chore(clients): recompilar Tailwind para el modal de ubicación"
```

---

## Notas de dependencias / setup

- **Geocoding API:** la key `REACT_APP_GOOGLE_MAPS_API_KEY` debe tener habilitada la **Geocoding API** en Google Cloud (además de Maps JavaScript API). Si el forward/reverse geocoding devuelve siempre `null`, revisar que la API esté habilitada y sin restricciones de referer que bloqueen las llamadas del `Geocoder`.
- **Sin migración:** las columnas `client_addresses.latitude/longitude/distance_range` y la vista `clients_full` ya existen.
