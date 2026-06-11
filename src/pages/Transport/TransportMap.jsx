import { useCallback, useEffect, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader, OverlayViewF, OverlayView } from '@react-google-maps/api'
import { HomeAlt, Xmark } from 'iconoir-react'
import { UNASSIGNED_COLOR, CLUB_LOCATION } from '../../services/transport/transportConstants'
import './TransportMap.css'

const TIER_HEX = { A: '#34d399', B: '#38bdf8', C: '#fbbf24', D: '#fb7185' }

const MAP_CONTAINER_STYLE = {
  width: '100%',
  height: '100%'
}

const DEFAULT_CENTER = CLUB_LOCATION

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

// Center the circular marker over its coordinate
const MARKER_SIZE = 40
function getMarkerOffset() {
  return { x: -MARKER_SIZE / 2, y: -MARKER_SIZE / 2 }
}

// Center the club badge (44px) horizontally, anchor its bottom at the coordinate
const CLUB_BADGE_SIZE = 44
function getClubOffset() {
  return { x: -CLUB_BADGE_SIZE / 2, y: -CLUB_BADGE_SIZE / 2 }
}

// Place the popup centered above the marker (offset uses the card's own size)
function getPopupOffset(width, height) {
  return { x: -width / 2, y: -(height + MARKER_SIZE / 2 + 10) }
}

function MarkerAvatar({ client }) {
  const [failed, setFailed] = useState(false)
  const initials = `${client.firstName[0]}${client.lastName[0]}`
  if (client.avatarUrl && !failed) {
    return (
      <img
        className="tm-marker-photo"
        src={client.avatarUrl}
        alt={`${client.firstName} ${client.lastName}`}
        onError={() => setFailed(true)}
      />
    )
  }
  return <div className="tm-marker-initials">{initials}</div>
}

function ClientPopup({ client, color, onClose }) {
  const phone = client.phone?.trim()
  const tier = client.cognitiveLevel
  const street = client.address?.street?.trim()

  return (
    <div
      className="tm-popup"
      style={{ '--tm-ring': color }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <button className="tm-popup-close" onClick={onClose} aria-label="Cerrar">
        <Xmark width={16} height={16} strokeWidth={2.2} />
      </button>

      <div className="tm-popup-head">
        {tier && (
          <span className="tm-popup-tier" style={{ background: TIER_HEX[tier] || '#94a3b8' }}>{tier}</span>
        )}
        <div className="tm-popup-name">{client.firstName} {client.lastName}</div>
      </div>

      <div className="tm-popup-rows">
        {phone && (
          <div className="tm-popup-row"><span className="tm-popup-key">Cel:</span>{phone}</div>
        )}
        <div className="tm-popup-col">
          <span className="tm-popup-key">Dirección</span>
          <span>{street || 'Sin dirección'}</span>
        </div>
      </div>

      <div className="tm-popup-tip" />
    </div>
  )
}

export default function TransportMap({
  shiftClients,
  shiftState
}) {
  const mapRef = useRef(null)
  const [selectedId, setSelectedId] = useState(null)

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
  const selectedClient = mappableClients.find(c => c.id === selectedId) || null

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
        onClick={() => setSelectedId(null)}
      >
        <OverlayViewF
          position={CLUB_LOCATION}
          mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          getPixelPositionOffset={getClubOffset}
          zIndex={1000}
        >
          <div className="tm-club" title="Centro Gervital — Alejo Rosell y Rius 1663">
            <div className="tm-club-badge">
              <HomeAlt width={22} height={22} strokeWidth={2} />
            </div>
            <span className="tm-club-label">Centro</span>
          </div>
        </OverlayViewF>

        {mappableClients.map(client => {
          const color = clientColorMap[client.id] || UNASSIGNED_COLOR
          const isSelected = selectedId === client.id
          const fullName = `${client.firstName} ${client.lastName}`

          return (
            <OverlayViewF
              key={client.id}
              position={{ lat: client.latitude, lng: client.longitude }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
              getPixelPositionOffset={getMarkerOffset}
              zIndex={isSelected ? 999 : undefined}
            >
              <div
                className={`tm-marker${isSelected ? ' is-highlighted' : ''}`}
                style={{ '--tm-ring': color }}
                title={fullName}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation()
                  setSelectedId(prev => (prev === client.id ? null : client.id))
                }}
              >
                <MarkerAvatar client={client} />
              </div>
            </OverlayViewF>
          )
        })}

        {selectedClient && (
          <OverlayViewF
            position={{ lat: selectedClient.latitude, lng: selectedClient.longitude }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={getPopupOffset}
            zIndex={1001}
          >
            <ClientPopup
              client={selectedClient}
              color={clientColorMap[selectedClient.id] || UNASSIGNED_COLOR}
              onClose={() => setSelectedId(null)}
            />
          </OverlayViewF>
        )}
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
