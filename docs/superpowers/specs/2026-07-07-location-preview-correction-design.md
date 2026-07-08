# Previsualización y corrección manual de ubicación (tipo Uber)

**Fecha:** 2026-07-07
**Branch base:** feat/contingency-fund (rama de trabajo a definir)
**Estado:** Diseño aprobado, pendiente plan de implementación

## Problema

Hoy, al dar de alta o editar un cliente, la dirección se escribe como texto libre y el
sistema la geocodifica silenciosamente (vía Nominatim/OpenStreetMap) para calcular lat/lng
y el rango de distancia al club. El usuario **no ve** dónde quedó el punto y **no puede
corregirlo** si el geocoder erró. Como la ubicación alimenta el mapa de transporte y la
facturación de transporte (por rango de distancia), un punto mal ubicado se traduce en
coordinación y cobros incorrectos.

## Objetivo

Replicar el patrón usual (tipo Uber): a partir de la dirección escrita, mostrar el punto en
un mapa y permitir **corregirlo manualmente arrastrando el pin**, con buena usabilidad.

## Decisiones de diseño (tomadas en brainstorming)

1. **Ubicación de la UI:** Modal de confirmación (no mapa inline). Un botón "Confirmar
   ubicación en el mapa" en el paso de dirección abre un modal enfocado con el mapa.
2. **Proveedor de geocoding:** Google `google.maps.Geocoder` (ya disponible en la API de
   Google Maps que la app carga para los mapas). Reemplaza a Nominatim. Motivos: coherencia
   con el mapa del modal (que es de Google), mejor precisión en direcciones de Montevideo, y
   habilita reverse-geocoding. Requiere que la key de Google Cloud tenga habilitada la
   **Geocoding API** (facturación aparte de Maps JavaScript API).
3. **Sin autocompletado:** El campo de dirección sigue siendo texto libre. El pin arrastrable
   resuelve la precisión. (Places Autocomplete queda como feature futura, ya listada en el
   proyecto.)

## Alcance

- **Incluye:** alta y edición de cliente (ambas usan `AddClient.jsx`).
- **No incluye:** una acción independiente de "corregir ubicación" en `ClientDetail`
  (YAGNI — editar cliente ya cubre el caso), Places Autocomplete, ni pantalla de precios.

## Flujo de usuario

1. En el paso 1 (Datos personales y contacto → sección Dirección), el usuario escribe la
   dirección como hoy.
2. Aparece un botón **"Confirmar ubicación en el mapa"** (deshabilitado si la dirección tiene
   menos de 5 caracteres).
3. Al hacer clic, se abre el **modal de confirmación**:
   - Se carga la API de Google Maps (lazy, sólo al abrir el modal la primera vez).
   - **Alta:** se geocodifica la dirección escrita con Google y el pin se centra ahí.
   - **Edición:** el pin arranca en las coordenadas ya guardadas (no se re-geocodifica, para
     no pisar una corrección previa).
   - Se muestra también el marcador del club (referencia visual de distancia).
4. El usuario puede **arrastrar el pin** hasta la puerta exacta. En cada `dragEnd`:
   - Se hace **reverse-geocoding** para mostrar la dirección real del punto ("El pin está
     en: ...") como confirmación.
   - Se **recalcula la distancia al club** (Haversine) y se muestra el rango en vivo.
5. **"Confirmar ubicación"** guarda `lat`, `lng`, `distanceRange` y la dirección formateada en
   el estado del formulario, cierra el modal y muestra un **chip verde "Ubicación
   confirmada"** con el rango en el paso.
6. **"Cancelar"** cierra sin cambios.
7. Al guardar el cliente, las coordenadas persisten por el camino actual
   (`updateClientAddressCoords` tras crear/actualizar) y `distanceRange` por
   `create/update_client_full`.

## Arquitectura

### Componentes y archivos

**`src/pages/Clients/LocationPickerModal.jsx` (nuevo)**
- Envuelve el componente `Modal` de `src/components/ui/`.
- Carga Google con `useJsApiLoader` (misma key `REACT_APP_GOOGLE_MAPS_API_KEY`; el loader es
  singleton, así que comparte instancia con `TransportMap`).
- Renderiza `GoogleMap` con:
  - Marcador del club (reusar `CLUB_LOCATION` de `transportConstants`).
  - `MarkerF` arrastrable para el cliente (`draggable`, `onDragEnd`).
- Al abrir: si hay `initialCoords` los usa; si no, geocodifica `address`; si falla, centra en
  `CLUB_LOCATION`/Montevideo con aviso.
- Estado local: `coords`, `formattedAddress`, `distanceRange`, `status` (loading/ok/not_found/error).
- Props:
  - `isOpen: boolean`
  - `address: string`
  - `initialCoords: { lat, lng } | null`
  - `onConfirm: ({ lat, lng, distanceRange, formattedAddress }) => void`
  - `onClose: () => void`

**`src/services/clients/geocodingService.js` (reescritura)**
- **Eliminar** la implementación Nominatim (`geocodeAddress`, `geocodeAndCalculateDistance`).
  Único importador actual es `AddClient.jsx`.
- **Mantener** (puras, testeables): `haversineKm(lat1,lng1,lat2,lng2)`,
  `distanceToRange(km)`.
- **Agregar**:
  - `geocodeWithGoogle(geocoder, address): Promise<{lat,lng,formattedAddress} | null>` —
    wrapper sobre `geocoder.geocode({ address, componentRestrictions: { country: 'uy' } })`.
  - `reverseGeocode(geocoder, { lat, lng }): Promise<string | null>` — devuelve
    `formatted_address`.
  - `resolveInitialCenter(initialCoords, geocoded, club): {lat,lng}` — helper puro que decide
    el centro inicial (coords > geocoded > club). Testeable sin Google.

**`src/pages/Clients/AddClient.jsx` (modificación)**
- Agregar `latitude` y `longitude` a `initialFormData` y cargarlos desde
  `client.address?.latitude/longitude` en modo edición.
- **Quitar** `handleStreetBlur` (geocoding Nominatim on-blur) y el geocoding Nominatim en
  submit.
- En la sección Dirección, agregar el botón "Confirmar ubicación en el mapa" y el chip de
  estado confirmado (muestra `DISTANCE_LABELS[distanceRange]`).
- Renderizar `LocationPickerModal` (condicional a `isOpen`).
- `onConfirm` escribe `latitude`, `longitude` y `distanceRange` en `formData`.
- El `Select` manual "Distancia al club" se mantiene como override/fallback.
- Submit: usar `formData.latitude/longitude` para `updateClientAddressCoords` (sin
  re-geocodificar).

### Flujo de datos y persistencia

Sin cambios de esquema ni migración: las columnas `client_addresses.latitude/longitude` y
`distance_range` ya existen (migración 012) y la vista `clients_full` ya devuelve
`address.latitude/longitude/distanceRange` (verificado). Se reutiliza:
- `updateClientAddressCoords(clientId, lat, lng)` para persistir coordenadas.
- `create_client_full` / `update_client_full` para `distanceRange`.

## Manejo de errores y edge cases

- **Dirección no geocodificable:** modal centrado en Montevideo/club + aviso "No pudimos
  ubicar la dirección. Arrastrá el pin al lugar correcto." Confirmar funciona igual.
- **Dirección vacía / < 5 caracteres:** botón "Confirmar ubicación" deshabilitado.
- **Google no carga (`loadError`):** modal en estado de error; el `Select` manual de distancia
  queda como camino alternativo para poder guardar el cliente.
- **Edición:** `initialCoords` tiene prioridad sobre re-geocodificar, para no pisar
  correcciones previas.

## Testing

- **Unit (Jest, junto a `geocodingService.test.js` si existe patrón):**
  - `haversineKm`: distancia conocida entre dos puntos.
  - `distanceToRange`: límites 2 km y 5 km (`0_to_2km` / `2_to_5km` / `5_to_10km`).
  - `resolveInitialCenter`: prioridad coords > geocoded > club.
- **Manual:** flujo completo del modal (alta y edición), arrastre de pin, recálculo de
  distancia, estados de error. El mapa de Google no se testea unitariamente.

## Fuera de alcance / futuro

- Google Places Autocomplete en el campo de dirección.
- Acción independiente de corregir ubicación desde `ClientDetail`.
- Pantalla de superadmin para precios de transporte (no relacionada).
