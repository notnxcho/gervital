# Transport distance by driving route (not straight line)

**Date:** 2026-07-13
**Status:** Approved

## Problem

Transport distance ranges (`0_to_2km` / `2_to_5km` / `5_to_10km`) currently come from
the **straight-line (Haversine)** distance between the client's pin and the club
(`CLUB_LOCATION`). Straight-line understates how far the van actually drives, so clients
are bucketed too low and, in some cases, under-priced for transport.

We want the bucket to reflect the **driving route distance** instead.

## Decision

- Measure the **driving route distance** from the club to the client's pin and bucket it
  with the **existing, unchanged thresholds** (2 / 5 / 10 km), now interpreted as road km.
  Some clients will move up a bucket (road distance ≥ straight-line) and their transport
  price rises — this is the intended effect.
- Use the client-side `google.maps.DistanceMatrixService` (the Maps JS SDK is already
  loaded via `@react-google-maps/api`; same API key, no new key handling). Requires the
  **Distance Matrix API** enabled on `REACT_APP_GOOGLE_MAPS_API_KEY` (believed enabled).
- Keep `haversineKm` as a **fallback**: if the routing call fails (API not enabled,
  `ZERO_RESULTS`, network error), fall back to straight-line so the flow never breaks.
- Direction: measure **club → pin** (the direction the van drives to reach the client).
  Road distance is mildly asymmetric; one direction is sufficient for bucketing and
  matches the single-number model in place today.

### Rejected alternatives

- **Routes API (`computeRouteMatrix`, REST):** newer/marginally more accurate but needs a
  `fetch` with the key in the URL and separate enablement — more surface area, no
  meaningful gain at this volume.
- **`DirectionsService`:** returns the full polyline; overkill for a scalar distance.
- **Re-tuning thresholds:** rejected — keep 2/5/10 km, apply to road km.

## Changes

### 1. `src/services/clients/geocodingService.js`

Add:

```
routeDistanceKm(service, origin, destination) → Promise<number | null>
```

- `service`: a `google.maps.DistanceMatrixService` instance.
- `origin` / `destination`: `{ lat, lng }`.
- Calls `getDistanceMatrix({ origins:[origin], destinations:[destination],
  travelMode: 'DRIVING' })`.
- On `status === 'OK'` and `rows[0].elements[0].status === 'OK'`, resolves to
  `elements[0].distance.value / 1000` (km).
- On any other status, rejection, or missing service → resolves to `null` (never throws).

`haversineKm` and `distanceToRange` are unchanged.

### 2. `src/pages/Clients/LocationPickerModal.jsx`

- Hold a `DistanceMatrixService` ref alongside the existing `geocoderRef`.
- `computeRange(lat, lng)` becomes async: call `routeDistanceKm(service,
  CLUB_LOCATION, { lat, lng })`; if it returns a number, bucket it; if `null`, bucket
  `haversineKm(...)`.
- Await it in the open effect and in `onDragEnd`.
- Show a small "calculando…" state on the distance badge while the call is in flight so a
  drag doesn't show a stale bucket.

### 3. `src/pages/Clients/AddClient.jsx` (~line 286)

The post-geocode auto-calc uses the same `routeDistanceKm` → fallback-to-haversine path
before `setFormData({ ..., distanceRange })`.

## Testing

- Unit-test `routeDistanceKm` with a mocked `DistanceMatrixService`:
  - `OK` element → returns km (meters / 1000).
  - `ZERO_RESULTS` (top-level or element-level) → `null`.
  - rejected / throwing callback → `null`.
  - missing service → `null`.
- Existing `haversineKm` / `distanceToRange` tests stay as-is.
- Manual: open the location picker for a client, confirm the badge shows a bucket derived
  from road distance and updates on pin drag; confirm graceful fallback if the API errors.

## Out of scope

- Threshold re-tuning.
- Round-trip / detour-aware distance modeling.
- Migrating existing clients' stored `distance_range` (recomputed only when their location
  is next edited/confirmed).
