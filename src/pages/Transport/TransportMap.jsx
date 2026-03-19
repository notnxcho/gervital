import { useCallback, useEffect, useRef } from 'react'
import { GoogleMap, useJsApiLoader, MarkerF } from '@react-google-maps/api'
import { UNASSIGNED_COLOR } from '../../services/transport/transportConstants'

const MAP_CONTAINER_STYLE = {
  width: '100%',
  height: '100%'
}

const DEFAULT_CENTER = { lat: -34.6037, lng: -58.3816 }

const MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false
}

const pinIconCache = {}
function createPinIcon(color) {
  if (pinIconCache[color]) return pinIconCache[color]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="white"/>
  </svg>`
  const icon = {
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    scaledSize: { width: 24, height: 36 }
  }
  pinIconCache[color] = icon
  return icon
}

export default function TransportMap({
  shiftClients,
  shiftState,
  onPinClick,
  highlightedClient
}) {
  const mapRef = useRef(null)

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || ''
  })

  const clientColorMap = {}
  for (const car of (shiftState?.cars || [])) {
    for (const id of (car.memberIds || [])) {
      clientColorMap[id] = car.color
    }
  }

  const mappableClients = shiftClients.filter(c => c.latitude && c.longitude)

  const onMapLoad = useCallback((map) => {
    mapRef.current = map
    fitBounds(map, mappableClients)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapRef.current && mappableClients.length > 0) {
      fitBounds(mapRef.current, mappableClients)
    }
  }, [mappableClients.length]) // eslint-disable-line react-hooks/exhaustive-deps

  function fitBounds(map, clients) {
    if (!clients.length || !window.google) return
    const bounds = new window.google.maps.LatLngBounds()
    clients.forEach(c => bounds.extend({ lat: c.latitude, lng: c.longitude }))
    map.fitBounds(bounds, 60)
  }

  const legendItems = [
    ...(shiftState?.cars || []).map(car => ({ name: car.name, color: car.color })),
    { name: 'Sin asignar', color: UNASSIGNED_COLOR }
  ]

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-100 text-gray-500 text-sm">
        Error al cargar Google Maps
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  return (
    <div className="flex-1 relative">
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={DEFAULT_CENTER}
        zoom={12}
        options={MAP_OPTIONS}
        onLoad={onMapLoad}
      >
        {mappableClients.map(client => {
          const color = clientColorMap[client.id] || UNASSIGNED_COLOR
          const isHighlighted = highlightedClient === client.id

          return (
            <MarkerF
              key={client.id}
              position={{ lat: client.latitude, lng: client.longitude }}
              icon={createPinIcon(color)}
              title={`${client.firstName} ${client.lastName}`}
              onClick={() => onPinClick?.(client.id)}
              animation={isHighlighted ? window.google.maps.Animation.BOUNCE : undefined}
              zIndex={isHighlighted ? 999 : undefined}
            />
          )
        })}
      </GoogleMap>

      <div className="absolute bottom-3 left-3 bg-white rounded-lg shadow-md px-3 py-2 text-xs flex flex-wrap gap-x-3 gap-y-1 max-w-[300px]">
        {legendItems.map(item => (
          <div key={item.name} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-gray-600">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
