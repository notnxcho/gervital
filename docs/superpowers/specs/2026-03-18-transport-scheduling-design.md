# Transport Scheduling System — Design Spec

## Overview

A new **Transport tab** (`/transporte`) for managing daily vehicle assignments for clients who use the club's transport service. The tab provides a map-based interface for visualizing client addresses and a drag-and-drop panel for assigning clients to cars across four daily shifts.

Transport billing is **completely separate** from the existing attendance-based billing. The transport tab is purely operational — no pricing is displayed.

**Scope**: Desktop-only interface. The split-view map + DnD panel is not designed for mobile.

---

## Business Rules

### Client Transport Flag
- Each client has a `hasTransport` boolean on their profile (in `client_plans`)
- This flag determines whether the client appears in the transport tab for their scheduled days
- Set during client creation/edit alongside their `schedule` (morning, afternoon, full_day)
- The flag has **no effect on attendance pricing** — it only controls transport eligibility

### Client Address Geocoding
- The `client_addresses` table must be extended with `latitude` and `longitude` columns (DOUBLE PRECISION, nullable)
- Geocoding happens at address save time: when a client's address is created or updated, the frontend uses the Google Maps Geocoding API to resolve coordinates before saving
- The AddClient wizard and edit form will use a Google Places Autocomplete input for the street field, which provides structured lat/lng automatically
- If geocoding fails or no address is provided, the client appears in the assignment panel but with no map pin and a "Sin dirección" warning badge on their chip

### Shifts
Four fixed, system-wide shifts per day:

| Shift | Type | Time | Who appears |
|-------|------|------|-------------|
| Llegada mañana | Arrive | 9:00 | Morning + full-day clients with transport |
| Salida mañana | Leave | 14:00 | Morning clients with transport |
| Llegada tarde | Arrive | 15:00 | Afternoon clients with transport |
| Salida tarde | Leave | 19:00 | Afternoon + full-day clients with transport |

A **full-day** client with transport appears in shifts 1 (arrive morning) and 4 (leave evening). However, admins can exclude them from any shift by simply not assigning them to a car — this is a per-day operational decision, not a profile setting.

### Cars
- Cars are **per-day, per-shift** — each shift starts with a fresh car configuration
- Default fleet: 4 cars — 1 with 7 seats ("Combi Grande"), 3 with 4 seats ("Auto 2", "Auto 3", "Auto 4")
- Admins can add, remove, rename cars and adjust seat counts per shift
- Seat count is enforced — cannot assign more clients than seats

### Trip Counting for Billing
- On save, the system counts how many shifts each client was assigned to a car across the day's 4 shifts
- A client realistically appears in at most 2 shifts per day (arrive + leave), so trip count is 0, 1, or 2
- This count is persisted as the client's **trip count** for that day
- Monthly transport billing (separate invoice track) sums each client's trip counts × their per-trip price
- Per-trip price is determined by the client's plan (frequency + schedule) — **hardcoded for now**, future superadmin config screen
- **One-way transport** (trip count = 1) is a valid scenario — e.g., a client gets picked up but a family member drives them home

### "Repeat Last [Weekday]" Feature
1. Button in the top bar: "Repetir último [martes]" (dynamic weekday label)
2. Only enabled if saved data exists for a previous same-weekday
3. On click: confirmation modal — "Esto reemplazará la configuración actual de todos los turnos del día. ¿Continuar?"
4. On confirm: copies all 4 shifts' car configurations + assignments from the most recent matching weekday
5. **Reconciliation**: clients who no longer have `hasTransport` or don't attend on this weekday are dropped. New transport-eligible clients for this day go to "Sin asignar"
6. The button is disabled (grayed out) when no previous data is available for that weekday

---

## UI Layout

### Page Structure
Route: `/transporte`
Access: admin + superadmin (`hasAccess('clients')`)
Nav icon: to be determined (iconoir-react)

Full-width gray background following the standard page pattern:
```
-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8 min-h-full bg-gray-50
```

### Top Bar
Left side:
- ← → day navigation arrows (skip weekends)
- Current date: "Martes 18 de Marzo, 2026" (bold, 16px)
- Subtitle: "12 asistentes con transporte" (total unique transport clients for the day)

Right side:
- "↻ Repetir último [martes]" button (secondary style, disabled if no previous data)
- "Guardar día" button (primary indigo style)

### Shift Tabs
Horizontal tab bar below the top bar. Four tabs:
- "Llegada mañana · 9:00"
- "Salida mañana · 14:00"
- "Llegada tarde · 15:00"
- "Salida tarde · 19:00"

Each tab shows an attendee count badge. Active tab: indigo border + text. Inactive: gray, hover effect.

### Main Content Area (Split View)

**Left panel — Google Maps (flex: 1)**
- Renders a Google Map via `@react-google-maps/api`
- Plots a pin for each client address in the current shift
- Pin colors match their assigned car color
- Unassigned clients show gray pins
- Map auto-fits bounds to show all pins
- Clicking a pin highlights the corresponding client in the right panel
- Bottom-left legend overlay shows car name → color mapping

**Right panel — Car Assignment (width: 340px)**
Scrollable panel with:

1. **Unassigned pool** (top, sticky)
   - Header: "SIN ASIGNAR (N)" — uppercase, small, gray
   - Client chips: gray background, full name (firstName + lastName), draggable
   - Wrap layout for multiple chips

2. **Car cards** (scrollable list)
   - Each car shows:
     - Color dot + editable car name (inline edit on click)
     - Seat counter: "3/4 asientos" with +/- buttons or direct edit
     - Delete button (with confirmation)
     - Assigned client chips in the car's color scheme (colored background + border)
     - Empty state: dashed border "Arrastrá asistentes aquí"
   - Seat limit enforced: if car is full, drop is rejected with visual feedback

3. **"+ Agregar auto" button** (bottom)
   - Dashed border, full width
   - Adds a new car with default 4 seats and auto-generated name

### Drag and Drop
- Uses `@dnd-kit` (already in the project from DailyGroups)
- One `DndContext` per shift (same pattern as DailyGroups)
- Drag from unassigned → car, car → car, car → unassigned
- Visual feedback: drop target highlights, drag overlay shows client name
- When a client is dragged into a full car, show a rejection indicator (red flash or toast)

### Map-List Interaction
- Clicking a map pin scrolls to and briefly highlights the client chip in the right panel
- Hovering a client chip in the right panel can optionally pulse the corresponding map pin
- Pin colors update in real-time as clients are assigned/unassigned

---

## Data Model

### New Tables

```sql
-- Anchor table: one row per saved day
CREATE TABLE transport_day_arrangements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  saved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Cars per shift within a day
CREATE TABLE transport_shift_cars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arrangement_id UUID NOT NULL REFERENCES transport_day_arrangements(id) ON DELETE CASCADE,
  shift TEXT NOT NULL CHECK (shift IN ('morning_arrive', 'morning_leave', 'afternoon_arrive', 'afternoon_leave')),
  name TEXT NOT NULL,
  seat_count INTEGER NOT NULL DEFAULT 4,
  color TEXT NOT NULL, -- hex color for map pins
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Client-to-car assignments per shift
-- Cross-car uniqueness (one client per shift) is enforced at application level
-- since the shift value lives on the parent transport_shift_cars row
CREATE TABLE transport_shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID NOT NULL REFERENCES transport_shift_cars(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (car_id, client_id)
);

-- Trip counts derived on save, used for billing
CREATE TABLE transport_trip_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  trip_count INTEGER NOT NULL DEFAULT 0 CHECK (trip_count BETWEEN 0 AND 2),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, date)
);

-- Add geocoding columns to client_addresses
ALTER TABLE client_addresses ADD COLUMN latitude DOUBLE PRECISION;
ALTER TABLE client_addresses ADD COLUMN longitude DOUBLE PRECISION;
```

### Indexes
```sql
-- Note: transport_day_arrangements.date UNIQUE already creates an implicit index
CREATE INDEX idx_transport_shift_cars_arrangement ON transport_shift_cars(arrangement_id);
CREATE INDEX idx_transport_assignments_car ON transport_shift_assignments(car_id);
CREATE INDEX idx_transport_assignments_client ON transport_shift_assignments(client_id);
CREATE INDEX idx_transport_trip_counts_date ON transport_trip_counts(date);
-- Note: transport_trip_counts (client_id, date) UNIQUE already creates an implicit index
```

### RLS Policies
Follow existing pattern — authenticated users with admin or superadmin role can read/write all transport tables.

### Car Color Palette
Fixed rotation of distinct, accessible colors for map pins:
```javascript
const CAR_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#8b5cf6', // purple
  '#f97316', // orange
  '#ec4899', // pink
  '#06b6d4', // cyan
]
```
Assigned in order as cars are added. Unassigned clients use `#9ca3af` (gray).

---

## Save Logic

### "Guardar día" Flow
Entire save is wrapped in a single Supabase RPC function (`save_transport_day`) for atomicity — a partial failure must not leave the database in an inconsistent state.

1. Validate: warn if any clients remain unassigned (non-blocking — admin can save anyway)
2. Call `save_transport_day` RPC with the full day's data:
   - Upsert `transport_day_arrangements` for the date
   - For each of the 4 shifts: delete existing `transport_shift_cars` (cascade deletes assignments), insert new cars with their assignments
   - Calculate trip counts: for each client, count how many shifts they appear in across all 4 shifts
   - Upsert `transport_trip_counts` for each client on that date
3. Success toast: "Transporte del [fecha] guardado"

### "Repetir último [día]" Query
Find the most recent matching weekday with saved data:
```sql
SELECT id, date FROM transport_day_arrangements
WHERE EXTRACT(DOW FROM date) = EXTRACT(DOW FROM $current_date)
  AND date < $current_date
ORDER BY date DESC
LIMIT 1;
```

### State Management
```javascript
// Top-level state
const [currentDate, setCurrentDate] = useState(() => new Date())
const [activeShift, setActiveShift] = useState('morning_arrive')
const [shifts, setShifts] = useState({
  morning_arrive: { cars: [], unassigned: [] },
  morning_leave: { cars: [], unassigned: [] },
  afternoon_arrive: { cars: [], unassigned: [] },
  afternoon_leave: { cars: [], unassigned: [] },
})
const [isDirty, setIsDirty] = useState(false)

// Car shape
{
  id: string,        // temp UUID for new, DB UUID for saved
  name: string,
  seatCount: number,
  color: string,
  position: number,
  memberIds: [clientId, ...]
}
```

### Unsaved Changes Guard
If `isDirty` is true and the admin tries to navigate away (day change or route change), show a confirmation: "Tenés cambios sin guardar. ¿Querés descartarlos?"

---

## Cleanup of Existing Transport Pricing

### Database — New Migration
Remove transport pricing logic from existing functions/views:

- **`get_plan_price` function**: remove the `IF p_has_transport THEN RETURN ROUND(v_base_price * 1.2)` block. Remove the `p_has_transport` parameter entirely.
- **`monthly_billing_summary` view** (in migration 008): remove `CASE WHEN cp.has_transport THEN ROUND(pp.price * 1.2) ELSE pp.price END`. Use `pp.price` directly as `monthly_price`.
- **`calculate_billing_for_month` function**: remove the transport price multiplier. Use `v_pricing.price` directly.

**Keep**: `has_transport` column on `client_plans` — still needed for transport eligibility.

### Frontend
- **`pricingService.js`**: remove `hasTransport` parameter from `calculatePlanPrice()` (which calls the RPC) and `calculatePlanPriceSync()` (signature-only change — the sync function never applied the surcharge anyway).
- **`AddClient.jsx`**: remove "El transporte tiene un costo adicional del 20%" helper text. Keep the `hasTransport` checkbox.
- **`ClientDetail.jsx`**: keep "Transporte: Incluido/No incluido" display as-is.
- **`ClientList.jsx`**: keep the transport filter as-is.
- **`dashboardService.js`**: keep `withTransport` / `transportPct` metrics.
- **`clientTransformers.js`**: keep `hasTransport` field mapping.

---

## File Structure

```
src/
├── pages/
│   └── Transport/
│       └── TransportScheduler.jsx    # Main page component
├── services/
│   └── transport/
│       └── transportService.js       # CRUD, save, repeat-last, trip counts
├── services/
│   └── api.js                        # Add transport re-exports

supabase/
└── migrations/
    └── 012_transport_scheduling.sql  # New tables + cleanup of old pricing
```

### New Dependencies
- `@react-google-maps/api` — Google Maps React wrapper
- Google Maps JavaScript API key via `REACT_APP_GOOGLE_MAPS_API_KEY` environment variable (CRA convention)
- Maps API must have Maps JavaScript API + Geocoding API + Places API enabled

### Existing Dependencies Reused
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — already installed
- `date-fns` with `es` locale — for date formatting and weekday navigation
- UI components: `Button`, `Card`, `Modal`, `Tabs` from `src/components/ui/`

---

## Routing & Navigation

- Add route: `/transporte` → `TransportScheduler`
- Add Navbar item: "Transporte" with appropriate iconoir icon, access check `hasAccess('clients')`
- Position in nav: after "Grupos" (groups)

---

## Edge Cases

1. **No transport clients for a day**: Show empty state — "No hay asistentes con transporte para este día"
2. **Client removed from transport mid-month**: Existing trip counts for past days are preserved (already billed). They stop appearing in future days.
3. **Weekend navigation**: ← → arrows skip Saturday/Sunday
4. **Full car rejection**: Visual feedback when trying to drop into a full car (brief red highlight, no toast spam)
5. **Client address missing**: Show pin at a default/fallback location with a warning badge on their chip ("Sin dirección")
6. **Repeat with no previous data**: Button is disabled with tooltip "No hay datos previos para [día]"
7. **Save with unassigned clients**: Non-blocking warning — "Hay N asistentes sin asignar. ¿Guardar de todos modos?"

---

## Transport Billing (Separate Track)

Transport billing uses its own invoice table (future migration), completely independent from the attendance-based `monthly_invoices`. The transport tab's responsibility ends at persisting `transport_trip_counts`. Billing logic that consumes these counts is out of scope for this spec.

### Per-Trip Pricing (Hardcoded, Fictional — To Be Corrected)

```javascript
// Placeholder prices — per single trip
const TRANSPORT_TRIP_PRICES = {
  // { frequency: { schedule: pricePerTrip } }
  1: { morning: 3500, afternoon: 3500, full_day: 3500 },
  2: { morning: 3200, afternoon: 3200, full_day: 3200 },
  3: { morning: 2800, afternoon: 2800, full_day: 2800 },
  4: { morning: 2500, afternoon: 2500, full_day: 2500 },
}
```

Higher frequency → lower per-trip cost (volume discount pattern). These values are placeholders to be replaced with real pricing.

---

## Loading & Error States

Follow existing codebase patterns:
- **Loading**: centered spinner while fetching day data (same pattern as DailyGroups)
- **Save in progress**: "Guardar día" button shows loading spinner, disabled during save
- **Network error on load**: inline error message with retry button
- **Save failure**: error toast with message, state remains dirty so admin can retry

---

## Post-Implementation Cleanup

- **Update CLAUDE.md**: remove all references to "+20% transport surcharge" and update the Precios section to reflect that transport billing is a separate per-trip track. Update the file structure section to include the new Transport module.
