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
  reverseGeocode,
  routeDistanceKm
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
  const distanceMatrixRef = useRef(null)
  const [coords, setCoords] = useState(null)
  const [distanceRange, setDistanceRange] = useState(null)
  const [computingDistance, setComputingDistance] = useState(false)
  const [formattedAddress, setFormattedAddress] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | ready | not_found

  // Driving route distance to the club, falling back to straight-line if routing fails.
  const computeRange = useCallback(async (lat, lng) => {
    distanceMatrixRef.current = distanceMatrixRef.current || new window.google.maps.DistanceMatrixService()
    const routeKm = await routeDistanceKm(distanceMatrixRef.current, CLUB_LOCATION, { lat, lng })
    const km = routeKm != null ? routeKm : haversineKm(lat, lng, CLUB_LOCATION.lat, CLUB_LOCATION.lng)
    return distanceToRange(km)
  }, [])

  // Depend on primitive coords, not the object literal, so a parent re-render while
  // the modal is open (e.g. mid-drag) does not re-run the effect and snap the pin back.
  const initLat = initialCoords?.lat ?? null
  const initLng = initialCoords?.lng ?? null

  // On open: resolve the initial pin (stored coords > geocoded address > club).
  useEffect(() => {
    if (!isOpen || !isLoaded) return
    let cancelled = false
    setStatus('loading')
    geocoderRef.current = geocoderRef.current || new window.google.maps.Geocoder()
    const stored = initLat != null && initLng != null ? { lat: initLat, lng: initLng } : null

    const run = async () => {
      let geocoded = null
      let foundLabel = ''
      if (!stored) {
        const g = await geocodeWithGoogle(geocoderRef.current, address)
        if (g) {
          geocoded = { lat: g.lat, lng: g.lng }
          foundLabel = g.formattedAddress
        }
      }
      const center = resolveInitialCenter(stored, geocoded, CLUB_LOCATION)
      if (stored) {
        foundLabel = await reverseGeocode(geocoderRef.current, center) || ''
      }
      if (cancelled) return
      setCoords(center)
      setFormattedAddress(foundLabel)
      setStatus(!stored && !geocoded ? 'not_found' : 'ready')
      setComputingDistance(true)
      const range = await computeRange(center.lat, center.lng)
      if (cancelled) return
      setDistanceRange(range)
      setComputingDistance(false)
    }
    run()
    return () => { cancelled = true }
  }, [isOpen, isLoaded, address, initLat, initLng, computeRange])

  const onDragEnd = useCallback(async (e) => {
    const lat = e.latLng.lat()
    const lng = e.latLng.lng()
    setCoords({ lat, lng })
    setStatus('ready')
    setComputingDistance(true)
    computeRange(lat, lng).then(range => {
      setDistanceRange(range)
      setComputingDistance(false)
    })
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
              {computingDistance ? (
                <span className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  Calculando distancia…
                </span>
              ) : distanceRange && (
                <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  Distancia al club: {DISTANCE_LABELS[distanceRange]}
                </span>
              )}
              <span className="text-xs text-gray-400">se recalcula al mover el pin</span>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={!coords || computingDistance}>Confirmar ubicación</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
