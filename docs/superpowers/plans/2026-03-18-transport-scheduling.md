# Transport Scheduling System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a transport scheduling tab where admins assign clients to cars across 4 daily shifts, with Google Maps visualization, drag-and-drop assignment, and trip count persistence for billing.

**Architecture:** Single-page `/transporte` route with day navigation and shift tabs. Split view: Google Maps (left) + car assignment panel with DnD (right). Data flows through a Supabase RPC for atomic day saves. Transport billing is a separate track from attendance billing.

**Tech Stack:** React 19, @react-google-maps/api (new), @dnd-kit (existing), date-fns (existing), Supabase PostgreSQL + RPC, Tailwind CSS 3.

**Spec:** `docs/superpowers/specs/2026-03-18-transport-scheduling-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/012_transport_scheduling.sql` | New tables, indexes, RLS, RPC functions + cleanup of old transport pricing |
| `src/services/transport/transportService.js` | All transport CRUD: load day, save day, repeat last weekday, get eligible clients |
| `src/services/transport/transportConstants.js` | Shift definitions, car colors, default fleet config, pricing placeholders |
| `src/pages/Transport/TransportScheduler.jsx` | Main page component: day nav, shift tabs, state management, save logic |
| `src/pages/Transport/TransportMap.jsx` | Google Maps component: pins, color-coding, legend, pin-click interaction |
| `src/pages/Transport/CarAssignmentPanel.jsx` | Right panel: unassigned pool, car cards, DnD context, add/remove/rename cars |
| `src/pages/Transport/CarCard.jsx` | Single car card: inline name edit, seat count, client chips, delete |
| `src/pages/Transport/ClientChip.jsx` | Draggable client chip: name, color by car assignment, "Sin dirección" badge |

### Modified Files
| File | Changes |
|------|---------|
| `src/App.js` | Add `/transporte` route |
| `src/components/Layout/Navbar.jsx` | Add "Transporte" nav item after "Grupos" |
| `src/services/api.js` | Add transport service re-exports |
| `src/services/pricing/pricingService.js` | Remove `hasTransport` params from `calculatePlanPrice` and `calculatePlanPriceSync` |
| `src/pages/Clients/AddClient.jsx` | Remove "20%" helper text, keep checkbox. Remove `hasTransport` from price calc call |
| `src/pages/Clients/ClientDetail.jsx` | Remove `hasTransport` arg from `calculatePlanPriceSync` call (line ~569) |

---

## Task 1: Database Migration — New Tables + Cleanup

**Files:**
- Create: `supabase/migrations/012_transport_scheduling.sql`

This migration creates the transport tables, RPC functions, and removes the old transport pricing logic from existing DB objects.

- [ ] **Step 1: Create migration file with transport tables**

```sql
-- =============================================================================
-- Migration 012: Transport Scheduling System
-- =============================================================================

-- ── New tables ───────────────────────────────────────────────────────────────

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
  color TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Client-to-car assignments per shift
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
ALTER TABLE client_addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE client_addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- ── Update clients_full view to include lat/lng in address ───────────────────

DROP VIEW IF EXISTS clients_full;
CREATE VIEW clients_full AS
SELECT
  c.id,
  c.first_name AS "firstName",
  c.last_name AS "lastName",
  c.email,
  c.phone,
  c.birth_date AS "birthDate",
  c.cognitive_level AS "cognitiveLevel",
  c.start_date AS "startDate",
  c.recovery_days_available AS "recoveryDaysAvailable",
  c.avatar_url AS "avatarUrl",
  c.created_at AS "createdAt",

  CASE
    WHEN cp.id IS NOT NULL THEN
      jsonb_build_object(
        'frequency', cp.frequency,
        'schedule', cp.schedule,
        'hasTransport', cp.has_transport,
        'assignedDays', cp.assigned_days
      )
    ELSE NULL
  END AS plan,

  CASE
    WHEN ec.id IS NOT NULL THEN
      jsonb_build_object(
        'name', ec.name,
        'relationship', ec.relationship,
        'phone', ec.phone
      )
    ELSE NULL
  END AS "emergencyContact",

  CASE
    WHEN ca.id IS NOT NULL THEN
      jsonb_build_object(
        'street', ca.street,
        'accessNotes', ca.access_notes,
        'doorbell', ca.doorbell,
        'concierge', ca.concierge,
        'latitude', ca.latitude,
        'longitude', ca.longitude
      )
    ELSE NULL
  END AS address,

  CASE
    WHEN mi.id IS NOT NULL THEN
      jsonb_build_object(
        'dietaryRestrictions', mi.dietary_restrictions,
        'medicalRestrictions', mi.medical_restrictions,
        'mobilityRestrictions', mi.mobility_restrictions,
        'medication', mi.medication,
        'medicationSchedule', mi.medication_schedule,
        'notes', mi.notes
      )
    ELSE NULL
  END AS "medicalInfo"

FROM clients c
LEFT JOIN client_plans cp ON c.id = cp.client_id
LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
LEFT JOIN client_addresses ca ON c.id = ca.client_id
LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_transport_shift_cars_arrangement ON transport_shift_cars(arrangement_id);
CREATE INDEX idx_transport_assignments_car ON transport_shift_assignments(car_id);
CREATE INDEX idx_transport_assignments_client ON transport_shift_assignments(client_id);
CREATE INDEX idx_transport_trip_counts_date ON transport_trip_counts(date);

-- ── Updated_at trigger ───────────────────────────────────────────────────────

CREATE TRIGGER set_transport_arrangements_updated_at
  BEFORE UPDATE ON transport_day_arrangements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

- [ ] **Step 2: Add RLS policies to the migration**

Append to the same migration file:

```sql
-- ── RLS Policies ─────────────────────────────────────────────────────────────

ALTER TABLE transport_day_arrangements ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_shift_cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_trip_counts ENABLE ROW LEVEL SECURITY;

-- transport_day_arrangements
CREATE POLICY "Authenticated users can read transport arrangements"
  ON transport_day_arrangements FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert transport arrangements"
  ON transport_day_arrangements FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update transport arrangements"
  ON transport_day_arrangements FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete transport arrangements"
  ON transport_day_arrangements FOR DELETE
  TO authenticated USING (true);

-- transport_shift_cars
CREATE POLICY "Authenticated users can read transport cars"
  ON transport_shift_cars FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert transport cars"
  ON transport_shift_cars FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update transport cars"
  ON transport_shift_cars FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete transport cars"
  ON transport_shift_cars FOR DELETE
  TO authenticated USING (true);

-- transport_shift_assignments
CREATE POLICY "Authenticated users can read transport assignments"
  ON transport_shift_assignments FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert transport assignments"
  ON transport_shift_assignments FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update transport assignments"
  ON transport_shift_assignments FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete transport assignments"
  ON transport_shift_assignments FOR DELETE
  TO authenticated USING (true);

-- transport_trip_counts
CREATE POLICY "Authenticated users can read transport trip counts"
  ON transport_trip_counts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert transport trip counts"
  ON transport_trip_counts FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update transport trip counts"
  ON transport_trip_counts FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete transport trip counts"
  ON transport_trip_counts FOR DELETE
  TO authenticated USING (true);
```

- [ ] **Step 3: Add save_transport_day RPC function**

Append to the migration file. This is the atomic save function called from the frontend:

```sql
-- ── RPC: save_transport_day ──────────────────────────────────────────────────
-- Atomically saves all 4 shifts for a day and computes trip counts.
-- p_data is a JSONB with shape:
-- {
--   "date": "2026-03-18",
--   "shifts": {
--     "morning_arrive": { "cars": [{ "name": "...", "seatCount": 4, "color": "#ef4444", "position": 0, "memberIds": ["uuid1", ...] }] },
--     "morning_leave": { ... },
--     "afternoon_arrive": { ... },
--     "afternoon_leave": { ... }
--   }
-- }

CREATE OR REPLACE FUNCTION save_transport_day(p_data JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date DATE;
  v_arrangement_id UUID;
  v_shift TEXT;
  v_shift_data JSONB;
  v_car JSONB;
  v_car_id UUID;
  v_member_id TEXT;
  v_position INTEGER;
  v_client_id UUID;
  v_trip_counts JSONB := '{}'::JSONB;
BEGIN
  v_date := (p_data->>'date')::DATE;

  -- Upsert arrangement
  INSERT INTO transport_day_arrangements (date, saved_by)
  VALUES (v_date, auth.uid())
  ON CONFLICT (date) DO UPDATE SET updated_at = now(), saved_by = auth.uid()
  RETURNING id INTO v_arrangement_id;

  -- Delete all existing cars for this arrangement (cascades to assignments)
  DELETE FROM transport_shift_cars WHERE arrangement_id = v_arrangement_id;

  -- Delete existing trip counts for this date
  DELETE FROM transport_trip_counts WHERE date = v_date;

  -- Insert cars and assignments for each shift
  FOR v_shift IN SELECT unnest(ARRAY['morning_arrive', 'morning_leave', 'afternoon_arrive', 'afternoon_leave'])
  LOOP
    v_shift_data := p_data->'shifts'->v_shift;
    IF v_shift_data IS NULL THEN CONTINUE; END IF;

    FOR v_car IN SELECT * FROM jsonb_array_elements(v_shift_data->'cars')
    LOOP
      INSERT INTO transport_shift_cars (arrangement_id, shift, name, seat_count, color, position)
      VALUES (
        v_arrangement_id,
        v_shift,
        v_car->>'name',
        (v_car->>'seatCount')::INTEGER,
        v_car->>'color',
        (v_car->>'position')::INTEGER
      )
      RETURNING id INTO v_car_id;

      v_position := 0;
      FOR v_member_id IN SELECT * FROM jsonb_array_elements_text(v_car->'memberIds')
      LOOP
        v_client_id := v_member_id::UUID;

        INSERT INTO transport_shift_assignments (car_id, client_id, position)
        VALUES (v_car_id, v_client_id, v_position);

        v_position := v_position + 1;

        -- Increment trip count for this client
        IF v_trip_counts ? v_member_id THEN
          v_trip_counts := jsonb_set(v_trip_counts, ARRAY[v_member_id], to_jsonb((v_trip_counts->>v_member_id)::INTEGER + 1));
        ELSE
          v_trip_counts := jsonb_set(v_trip_counts, ARRAY[v_member_id], '1'::JSONB);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Insert trip counts
  FOR v_member_id IN SELECT * FROM jsonb_object_keys(v_trip_counts)
  LOOP
    INSERT INTO transport_trip_counts (client_id, date, trip_count)
    VALUES (
      v_member_id::UUID,
      v_date,
      LEAST((v_trip_counts->>v_member_id)::INTEGER, 2)
    );
  END LOOP;

  RETURN v_arrangement_id;
END;
$$;
```

- [ ] **Step 4: Add cleanup of old transport pricing logic**

Append to the migration file:

```sql
-- ── Cleanup: Remove old transport pricing surcharge ──────────────────────────

-- Recreate get_plan_price WITHOUT transport parameter
CREATE OR REPLACE FUNCTION get_plan_price(
  p_frequency INTEGER,
  p_schedule TEXT
)
RETURNS NUMERIC AS $$
DECLARE
  v_base_price NUMERIC;
BEGIN
  SELECT price INTO v_base_price
  FROM plan_pricing
  WHERE frequency = p_frequency AND schedule = p_schedule;

  IF v_base_price IS NULL THEN
    RAISE EXCEPTION 'No pricing found for frequency % and schedule %', p_frequency, p_schedule;
  END IF;

  RETURN v_base_price;
END;
$$ LANGUAGE plpgsql STABLE;

-- NOTE: monthly_billing_summary and calculate_billing_for_month were already
-- dropped in migration 009 (billing v2). The replacement function
-- calculate_month_billing (in 009) already uses v_pricing.price directly
-- with no transport surcharge. No further cleanup needed for those objects.
--
-- The only DB object that still has the transport surcharge is get_plan_price,
-- which is recreated above without the p_has_transport parameter.
```

- [ ] **Step 5: Apply the migration**

Run via Supabase MCP tool `apply_migration` or directly against the database.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/012_transport_scheduling.sql
git commit -m "feat(db): add transport scheduling tables, RPC, and remove old transport pricing"
```

---

## Task 2: Transport Constants + Service Layer

**Files:**
- Create: `src/services/transport/transportConstants.js`
- Create: `src/services/transport/transportService.js`

- [ ] **Step 1: Create transport constants**

Create `src/services/transport/transportConstants.js`:

```javascript
// ── Shift definitions ────────────────────────────────────────────────────────

export const SHIFTS = [
  { id: 'morning_arrive', label: 'Llegada mañana', time: '9:00', type: 'arrive', period: 'morning' },
  { id: 'morning_leave', label: 'Salida mañana', time: '14:00', type: 'leave', period: 'morning' },
  { id: 'afternoon_arrive', label: 'Llegada tarde', time: '15:00', type: 'arrive', period: 'afternoon' },
  { id: 'afternoon_leave', label: 'Salida tarde', time: '19:00', type: 'leave', period: 'afternoon' }
]

// ── Car colors ───────────────────────────────────────────────────────────────

export const CAR_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#8b5cf6', // purple
  '#f97316', // orange
  '#ec4899', // pink
  '#06b6d4'  // cyan
]

export const UNASSIGNED_COLOR = '#9ca3af'

// ── Default fleet ────────────────────────────────────────────────────────────

export const DEFAULT_FLEET = [
  { name: 'Combi Grande', seatCount: 7 },
  { name: 'Auto 2', seatCount: 4 },
  { name: 'Auto 3', seatCount: 4 },
  { name: 'Auto 4', seatCount: 4 }
]

// ── Day names (reuse pattern from DailyGroups) ──────────────────────────────

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export const DAY_LABELS_ES = {
  monday: 'lunes',
  tuesday: 'martes',
  wednesday: 'miércoles',
  thursday: 'jueves',
  friday: 'viernes'
}

// ── Which shifts a client appears in based on their schedule ─────────────────

export function getShiftsForSchedule(schedule) {
  switch (schedule) {
    case 'morning':
      return ['morning_arrive', 'morning_leave']
    case 'afternoon':
      return ['afternoon_arrive', 'afternoon_leave']
    case 'full_day':
      return ['morning_arrive', 'afternoon_leave']
    default:
      return []
  }
}

// ── Placeholder transport pricing (per trip) ─────────────────────────────────
// These are fictional values — to be replaced with real pricing later

export const TRANSPORT_TRIP_PRICES = {
  1: { morning: 3500, afternoon: 3500, full_day: 3500 },
  2: { morning: 3200, afternoon: 3200, full_day: 3200 },
  3: { morning: 2800, afternoon: 2800, full_day: 2800 },
  4: { morning: 2500, afternoon: 2500, full_day: 2500 }
}
```

- [ ] **Step 2: Create transport service**

Create `src/services/transport/transportService.js`:

```javascript
import { supabase } from '../supabase/client'
import { CAR_COLORS, DEFAULT_FLEET } from './transportConstants'

// ── Get transport-eligible clients for a given weekday ──────────────────────

export async function getTransportClients() {
  const { data, error } = await supabase
    .from('clients_full')
    .select('*')

  if (error) throw new Error(error.message)

  // Filter to clients with hasTransport = true
  return data
    .filter(c => c.plan?.hasTransport)
    .map(c => ({
      ...c,
      // Ensure address coords are available
      latitude: c.address?.latitude || null,
      longitude: c.address?.longitude || null
    }))
}

// ── Get clients eligible for a specific shift on a specific weekday ─────────

export function filterClientsForShift(clients, shiftId, dayName) {
  return clients.filter(c => {
    if (!c.plan?.assignedDays?.includes(dayName)) return false

    const schedule = c.plan?.schedule
    switch (shiftId) {
      case 'morning_arrive':
        return schedule === 'morning' || schedule === 'full_day'
      case 'morning_leave':
        return schedule === 'morning'
      case 'afternoon_arrive':
        return schedule === 'afternoon'
      case 'afternoon_leave':
        return schedule === 'afternoon' || schedule === 'full_day'
      default:
        return false
    }
  })
}

// ── Load saved arrangement for a date ───────────────────────────────────────

export async function getArrangementForDate(dateStr) {
  const { data: arrangement, error: arrError } = await supabase
    .from('transport_day_arrangements')
    .select('id, date')
    .eq('date', dateStr)
    .maybeSingle()

  if (arrError) throw new Error(arrError.message)
  if (!arrangement) return null

  // Load all cars with their assignments for this arrangement
  const { data: cars, error: carsError } = await supabase
    .from('transport_shift_cars')
    .select(`
      id,
      shift,
      name,
      seat_count,
      color,
      position,
      transport_shift_assignments (
        client_id,
        position
      )
    `)
    .eq('arrangement_id', arrangement.id)
    .order('position', { ascending: true })

  if (carsError) throw new Error(carsError.message)

  // Organize by shift
  const shifts = {
    morning_arrive: { cars: [] },
    morning_leave: { cars: [] },
    afternoon_arrive: { cars: [] },
    afternoon_leave: { cars: [] }
  }

  for (const car of (cars || [])) {
    const shiftData = shifts[car.shift]
    if (!shiftData) continue

    shiftData.cars.push({
      id: car.id,
      name: car.name,
      seatCount: car.seat_count,
      color: car.color,
      position: car.position,
      memberIds: (car.transport_shift_assignments || [])
        .sort((a, b) => a.position - b.position)
        .map(a => a.client_id)
    })
  }

  return { id: arrangement.id, date: arrangement.date, shifts }
}

// ── Save entire day atomically via RPC ──────────────────────────────────────

export async function saveTransportDay(dateStr, shifts) {
  const payload = {
    date: dateStr,
    shifts: {}
  }

  for (const [shiftId, shiftData] of Object.entries(shifts)) {
    payload.shifts[shiftId] = {
      cars: shiftData.cars.map((car, i) => ({
        name: car.name,
        seatCount: car.seatCount,
        color: car.color,
        position: i,
        memberIds: car.memberIds || []
      }))
    }
  }

  const { data, error } = await supabase.rpc('save_transport_day', {
    p_data: payload
  })

  if (error) throw new Error(error.message)
  return data
}

// ── Find most recent same-weekday arrangement ───────────────────────────────

export async function findLastWeekdayArrangement(dateStr) {
  const date = new Date(dateStr + 'T12:00:00')
  const dow = date.getDay() // 0=Sunday, 1=Monday, ...

  const { data, error } = await supabase
    .from('transport_day_arrangements')
    .select('id, date')
    .lt('date', dateStr)
    .order('date', { ascending: false })
    .limit(20) // Scan recent ones

  if (error) throw new Error(error.message)

  // Find first match with same DOW
  for (const arr of (data || [])) {
    const arrDate = new Date(arr.date + 'T12:00:00')
    if (arrDate.getDay() === dow) {
      return arr
    }
  }

  return null
}

// ── Copy arrangement from a previous date ───────────────────────────────────

export async function copyArrangementFromDate(sourceDateStr) {
  return getArrangementForDate(sourceDateStr)
}

// ── Build default fleet for a shift ─────────────────────────────────────────

export function buildDefaultFleet() {
  return DEFAULT_FLEET.map((car, i) => ({
    id: `temp-${Date.now()}-${i}`,
    name: car.name,
    seatCount: car.seatCount,
    color: CAR_COLORS[i] || CAR_COLORS[0],
    position: i,
    memberIds: []
  }))
}

// ── Get next available car color ────────────────────────────────────────────

export function getNextCarColor(existingCars) {
  const usedColors = new Set(existingCars.map(c => c.color))
  return CAR_COLORS.find(c => !usedColors.has(c)) || CAR_COLORS[existingCars.length % CAR_COLORS.length]
}
```

- [ ] **Step 3: Add transport re-exports to api.js**

Add to `src/services/api.js` after the expenses section:

```javascript
// ============================================
// TRANSPORT API
// ============================================
export {
  getTransportClients,
  filterClientsForShift,
  getArrangementForDate,
  saveTransportDay,
  findLastWeekdayArrangement,
  copyArrangementFromDate,
  buildDefaultFleet,
  getNextCarColor
} from './transport/transportService'
```

- [ ] **Step 4: Commit**

```bash
git add src/services/transport/transportConstants.js src/services/transport/transportService.js src/services/api.js
git commit -m "feat: add transport service layer and constants"
```

---

## Task 3: Cleanup Old Transport Pricing (Frontend)

**Files:**
- Modify: `src/services/pricing/pricingService.js`
- Modify: `src/pages/Clients/AddClient.jsx`

- [ ] **Step 1: Remove hasTransport from pricingService.js**

In `src/services/pricing/pricingService.js`:

1. **Lines 26-31**: Update JSDoc — remove `@param {boolean} hasTransport`
2. **Line 32**: Change `export async function calculatePlanPrice(frequency, schedule, hasTransport = false)` → `export async function calculatePlanPrice(frequency, schedule)`
3. **Lines 34-37**: Remove `p_has_transport: hasTransport` from the RPC params. New params:
   ```javascript
   const { data, error } = await supabase
     .rpc('get_plan_price', {
       p_frequency: frequency,
       p_schedule: schedule
     })
   ```
4. **Lines 47-54**: Update JSDoc — remove `@param {boolean} hasTransport`
5. **Line 56**: Change `export function calculatePlanPriceSync(pricingData, frequency, schedule, hasTransport = false)` → `export function calculatePlanPriceSync(pricingData, frequency, schedule)`

- [ ] **Step 2: Clean up AddClient.jsx transport text**

In `src/pages/Clients/AddClient.jsx`:

1. **Lines 543-545**: Remove the `<p>` tag with "El transporte tiene un costo adicional del 20%":
   ```
   REMOVE: <p className="text-sm text-gray-500 mt-1 ml-6">
   REMOVE:   El transporte tiene un costo adicional del 20%
   REMOVE: </p>
   ```

2. **Lines 252-257**: Remove `hasTransport` from `calculatePlanPriceSync` call:
   ```javascript
   // Before:
   const estimatedPrice = calculatePlanPriceSync(
     pricingData,
     parseInt(formData.frequency),
     formData.schedule,
     formData.hasTransport
   )
   // After:
   const estimatedPrice = calculatePlanPriceSync(
     pricingData,
     parseInt(formData.frequency),
     formData.schedule
   )
   ```

- [ ] **Step 3: Remove hasTransport from ClientDetail.jsx**

In `src/pages/Clients/ClientDetail.jsx`, find the `calculatePlanPriceSync` call (around line 569):
```javascript
// Before:
const monthlyRate = calculatePlanPriceSync(pricingData, client.plan.frequency, client.plan.schedule, client.plan.hasTransport)
// After:
const monthlyRate = calculatePlanPriceSync(pricingData, client.plan.frequency, client.plan.schedule)
```

- [ ] **Step 4: Commit**

```bash
git add src/services/pricing/pricingService.js src/pages/Clients/AddClient.jsx src/pages/Clients/ClientDetail.jsx
git commit -m "fix: remove old transport pricing surcharge from frontend"
```

---

## Task 4: Routing + Navigation

**Files:**
- Modify: `src/App.js`
- Modify: `src/components/Layout/Navbar.jsx`
- Create: `src/pages/Transport/TransportScheduler.jsx` (placeholder)

- [ ] **Step 1: Create placeholder TransportScheduler**

Create `src/pages/Transport/TransportScheduler.jsx`:

```javascript
export default function TransportScheduler() {
  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Transporte</h1>
      <p className="text-sm text-gray-500 mt-1">En construcción</p>
    </div>
  )
}
```

- [ ] **Step 2: Add route to App.js**

In `src/App.js`, add the import and route. Look at the existing route structure (routes are children of the `<Route element={<Layout />}>` wrapper). Add after the `/grupos` route:

```javascript
// Import at top:
import TransportScheduler from './pages/Transport/TransportScheduler'

// Route (after grupos):
<Route path="transporte" element={<TransportScheduler />} />
```

- [ ] **Step 3: Add nav item to Navbar.jsx**

In `src/components/Layout/Navbar.jsx`:

1. Add import: `import { Bus } from 'iconoir-react'` (or `DeliveryTruck` — check iconoir-react for best transport icon available)
2. In the `navItems` array (around line 23-29), add after the Grupos item:
   ```javascript
   { to: '/transporte', label: 'Transporte', icon: Bus, access: 'clients' },
   ```

**Note:** Check `iconoir-react` exports — if `Bus` doesn't exist, use `Car`, `Truck`, or `DeliveryTruck`. Run `grep -r "export" node_modules/iconoir-react/dist/index.d.ts | grep -i -E "bus|truck|car|van|delivery"` to find available transport icons.

- [ ] **Step 4: Verify navigation works**

Run: `npm start`
Expected: App loads, "Transporte" appears in navbar, clicking it shows the placeholder page.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Transport/TransportScheduler.jsx src/App.js src/components/Layout/Navbar.jsx
git commit -m "feat: add transport route and navbar item"
```

---

## Task 5: Install Google Maps + ClientChip Component

**Files:**
- Create: `src/pages/Transport/ClientChip.jsx`

- [ ] **Step 1: Install @react-google-maps/api**

```bash
npm install @react-google-maps/api
```

- [ ] **Step 2: Create ClientChip component**

Create `src/pages/Transport/ClientChip.jsx`. This is the draggable chip used in the unassigned pool and inside car cards:

```javascript
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const COLOR_SCHEMES = {
  '#ef4444': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800' },
  '#3b82f6': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800' },
  '#22c55e': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800' },
  '#eab308': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800' },
  '#8b5cf6': { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800' },
  '#f97316': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800' },
  '#ec4899': { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-800' },
  '#06b6d4': { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-800' }
}

const UNASSIGNED_SCHEME = { bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-700' }

function ChipContent({ client, color, isOverlay, noAddress }) {
  const scheme = COLOR_SCHEMES[color] || UNASSIGNED_SCHEME

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium cursor-grab select-none transition-shadow
        ${scheme.bg} ${scheme.border} ${scheme.text}
        ${isOverlay ? 'shadow-lg ring-2 ring-indigo-300 rotate-1' : 'hover:shadow-sm'}`}
    >
      <span>{client.firstName} {client.lastName}</span>
      {noAddress && (
        <span className="text-amber-500" title="Sin dirección">⚠</span>
      )}
    </div>
  )
}

export function SortableClientChip({ client, color, noAddress }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: client.id,
    data: { type: 'client' }
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ChipContent client={client} color={color} noAddress={noAddress} />
    </div>
  )
}

export function DragOverlayChip({ client, color }) {
  return <ChipContent client={client} color={color} isOverlay />
}

export default ChipContent
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Transport/ClientChip.jsx package.json package-lock.json
git commit -m "feat: add ClientChip component and install @react-google-maps/api"
```

---

## Task 6: CarCard Component

**Files:**
- Create: `src/pages/Transport/CarCard.jsx`

- [ ] **Step 1: Create CarCard component**

Create `src/pages/Transport/CarCard.jsx`:

```javascript
import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { Trash, Minus, Plus } from 'iconoir-react'
import { SortableClientChip } from './ClientChip'

export default function CarCard({
  car,
  clients,       // Map<id, client>
  onNameChange,
  onSeatCountChange,
  onDelete
}) {
  const [editingName, setEditingName] = useState(false)
  const [localName, setLocalName] = useState(car.name)

  const { setNodeRef, isOver } = useDroppable({
    id: `car-${car.id}`,
    data: { type: 'car', carId: car.id }
  })

  const members = (car.memberIds || []).map(id => clients.get(id)).filter(Boolean)
  const isFull = members.length >= car.seatCount

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg bg-white transition-colors ${
        isOver && !isFull ? 'border-indigo-300 bg-indigo-50/30' :
        isOver && isFull ? 'border-red-300 bg-red-50/30' : 'border-gray-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        {/* Color dot */}
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: car.color }}
        />

        {/* Name — click to edit */}
        {editingName ? (
          <input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => {
              setEditingName(false)
              if (localName.trim() && localName !== car.name) {
                onNameChange(car.id, localName.trim())
              } else {
                setLocalName(car.name)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur()
              if (e.key === 'Escape') { setLocalName(car.name); setEditingName(false) }
            }}
            autoFocus
            className="flex-1 text-sm font-semibold bg-transparent border-b border-dashed border-gray-400 focus:outline-none focus:border-indigo-500 text-gray-800"
          />
        ) : (
          <span
            onClick={() => setEditingName(true)}
            className="flex-1 text-sm font-semibold text-gray-800 cursor-pointer hover:text-indigo-600 transition-colors"
            title="Click para editar nombre"
          >
            {car.name}
          </span>
        )}

        {/* Seat count with +/- */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSeatCountChange(car.id, Math.max(1, car.seatCount - 1))}
            className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
            disabled={car.seatCount <= 1}
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-xs text-gray-500 min-w-[4rem] text-center">
            {members.length}/{car.seatCount} asientos
          </span>
          <button
            onClick={() => onSeatCountChange(car.id, car.seatCount + 1)}
            className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Delete */}
        <button
          onClick={() => onDelete(car.id)}
          className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
          title="Eliminar auto"
        >
          <Trash className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Members */}
      <div className="p-2 min-h-[40px]">
        <SortableContext items={car.memberIds || []} strategy={rectSortingStrategy}>
          <div className="flex flex-wrap gap-1.5">
            {members.map(client => (
              <SortableClientChip
                key={client.id}
                client={client}
                color={car.color}
                noAddress={!client.latitude && !client.longitude}
              />
            ))}
          </div>
        </SortableContext>

        {members.length === 0 && (
          <div className="border border-dashed border-gray-200 rounded-md py-3 text-center text-xs text-gray-400">
            Arrastrá asistentes aquí
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Transport/CarCard.jsx
git commit -m "feat: add CarCard component with inline editing and seat management"
```

---

## Task 7: CarAssignmentPanel (DnD Panel)

**Files:**
- Create: `src/pages/Transport/CarAssignmentPanel.jsx`

- [ ] **Step 1: Create the right-side assignment panel**

Create `src/pages/Transport/CarAssignmentPanel.jsx`:

```javascript
import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'iconoir-react'
import CarCard from './CarCard'
import { SortableClientChip, DragOverlayChip } from './ClientChip'
import { UNASSIGNED_COLOR } from '../../services/transport/transportConstants'
import { getNextCarColor } from '../../services/transport/transportService'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'

function UnassignedPool({ clientIds, clients }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'unassigned',
    data: { type: 'unassigned' }
  })

  const unassignedClients = clientIds.map(id => clients.get(id)).filter(Boolean)

  return (
    <div
      ref={setNodeRef}
      className={`p-3 border-b border-gray-200 sticky top-0 bg-white z-10 transition-colors ${
        isOver ? 'bg-gray-50' : ''
      }`}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Sin asignar ({clientIds.length})
      </p>
      <SortableContext items={clientIds} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-1.5">
          {unassignedClients.map(client => (
            <SortableClientChip
              key={client.id}
              client={client}
              color={UNASSIGNED_COLOR}
              noAddress={!client.latitude && !client.longitude}
            />
          ))}
        </div>
      </SortableContext>
      {clientIds.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-1">Todos asignados</p>
      )}
    </div>
  )
}

export default function CarAssignmentPanel({
  shiftState,          // { cars: [], unassigned: [] }
  onStateChange,       // (updater) => void
  clientsById          // Map<id, client>
}) {
  const [activeClient, setActiveClient] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // carId

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  // ── Find which container a client belongs to ────────────────────────────────

  function findContainer(clientId) {
    if (shiftState.unassigned.includes(clientId)) return 'unassigned'
    for (const car of shiftState.cars) {
      if ((car.memberIds || []).includes(clientId)) return car.id
    }
    return null
  }

  function getCarById(carId) {
    return shiftState.cars.find(c => c.id === carId)
  }

  // ── DnD handlers ──────────────────────────────────────────────────────────

  function onDragStart({ active }) {
    const client = clientsById.get(active.id)
    if (client) setActiveClient(client)
  }

  function onDragOver({ active, over }) {
    if (!over) return

    const activeContainer = findContainer(active.id)

    // Determine target container
    let targetContainer
    const overData = over.data.current

    if (overData?.type === 'client') {
      targetContainer = findContainer(over.id)
    } else if (overData?.type === 'car') {
      targetContainer = overData.carId
    } else if (overData?.type === 'unassigned' || over.id === 'unassigned') {
      targetContainer = 'unassigned'
    }

    if (!targetContainer || activeContainer === targetContainer) return

    // Check seat limit if moving to a car
    if (targetContainer !== 'unassigned') {
      const targetCar = getCarById(targetContainer)
      if (targetCar && (targetCar.memberIds || []).length >= targetCar.seatCount) {
        return // Reject — car is full
      }
    }

    // Move client between containers
    onStateChange(prev => {
      const next = JSON.parse(JSON.stringify(prev))

      // Remove from source
      if (activeContainer === 'unassigned') {
        next.unassigned = next.unassigned.filter(id => id !== active.id)
      } else {
        const srcCar = next.cars.find(c => c.id === activeContainer)
        if (srcCar) srcCar.memberIds = srcCar.memberIds.filter(id => id !== active.id)
      }

      // Add to target
      if (targetContainer === 'unassigned') {
        next.unassigned.push(active.id)
      } else {
        const destCar = next.cars.find(c => c.id === targetContainer)
        if (destCar) destCar.memberIds.push(active.id)
      }

      return next
    })
  }

  function onDragEnd() {
    setActiveClient(null)
  }

  // ── Car operations ────────────────────────────────────────────────────────

  function handleAddCar() {
    onStateChange(prev => ({
      ...prev,
      cars: [...prev.cars, {
        id: `temp-${Date.now()}`,
        name: `Auto ${prev.cars.length + 1}`,
        seatCount: 4,
        color: getNextCarColor(prev.cars),
        position: prev.cars.length,
        memberIds: []
      }]
    }))
  }

  function handleCarNameChange(carId, name) {
    onStateChange(prev => ({
      ...prev,
      cars: prev.cars.map(c => c.id === carId ? { ...c, name } : c)
    }))
  }

  function handleSeatCountChange(carId, seatCount) {
    onStateChange(prev => ({
      ...prev,
      cars: prev.cars.map(c => c.id === carId ? { ...c, seatCount } : c)
    }))
  }

  function handleDeleteCar(carId) {
    setDeleteConfirm(carId)
  }

  function confirmDeleteCar() {
    const carId = deleteConfirm
    setDeleteConfirm(null)

    onStateChange(prev => {
      const car = prev.cars.find(c => c.id === carId)
      const returnedMembers = car ? (car.memberIds || []) : []

      return {
        ...prev,
        cars: prev.cars.filter(c => c.id !== carId),
        unassigned: [...prev.unassigned, ...returnedMembers]
      }
    })
  }

  // ── Get active client's color for drag overlay ────────────────────────────

  function getClientColor(clientId) {
    for (const car of shiftState.cars) {
      if ((car.memberIds || []).includes(clientId)) return car.color
    }
    return UNASSIGNED_COLOR
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-[340px] bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        {/* Unassigned pool */}
        <UnassignedPool
          clientIds={shiftState.unassigned}
          clients={clientsById}
        />

        {/* Car list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {shiftState.cars.map(car => (
            <CarCard
              key={car.id}
              car={car}
              clients={clientsById}
              onNameChange={handleCarNameChange}
              onSeatCountChange={handleSeatCountChange}
              onDelete={handleDeleteCar}
            />
          ))}

          {/* Add car button */}
          <button
            onClick={handleAddCar}
            className="w-full border border-dashed border-gray-300 rounded-lg py-2.5 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Agregar auto
          </button>
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={null}>
          {activeClient && (
            <DragOverlayChip
              client={activeClient}
              color={getClientColor(activeClient.id)}
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* Delete confirmation */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Eliminar auto"
        size="sm"
      >
        <p className="text-gray-600 mb-6">
          Los asistentes de este auto volverán a "Sin asignar". ¿Continuar?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={confirmDeleteCar}>Eliminar</Button>
        </div>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Transport/CarAssignmentPanel.jsx
git commit -m "feat: add CarAssignmentPanel with DnD, car CRUD, and seat enforcement"
```

---

## Task 8: TransportMap Component

**Files:**
- Create: `src/pages/Transport/TransportMap.jsx`

- [ ] **Step 1: Create the Google Maps panel**

Create `src/pages/Transport/TransportMap.jsx`:

```javascript
import { useCallback, useEffect, useRef } from 'react'
import { GoogleMap, useJsApiLoader, MarkerF } from '@react-google-maps/api'
import { UNASSIGNED_COLOR } from '../../services/transport/transportConstants'

const MAP_CONTAINER_STYLE = {
  width: '100%',
  height: '100%'
}

// Buenos Aires default center
const DEFAULT_CENTER = { lat: -34.6037, lng: -58.3816 }

const MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false
}

function createPinIcon(color) {
  // SVG pin as data URL
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="white"/>
  </svg>`
  return {
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    scaledSize: { width: 24, height: 36 }
  }
}

export default function TransportMap({
  shiftClients,     // clients for current shift (with lat/lng)
  shiftState,       // { cars: [], unassigned: [] }
  onPinClick,       // (clientId) => void
  highlightedClient // clientId or null
}) {
  const mapRef = useRef(null)

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || ''
  })

  // Build client → color mapping
  const clientColorMap = {}
  for (const car of (shiftState?.cars || [])) {
    for (const id of (car.memberIds || [])) {
      clientColorMap[id] = car.color
    }
  }

  // Clients with valid coordinates
  const mappableClients = shiftClients.filter(c => c.latitude && c.longitude)

  // Auto-fit bounds when clients change
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

  // ── Legend ─────────────────────────────────────────────────────────────────

  const legendItems = [
    ...(shiftState?.cars || []).map(car => ({ name: car.name, color: car.color })),
    { name: 'Sin asignar', color: UNASSIGNED_COLOR }
  ]

  // ── Render ────────────────────────────────────────────────────────────────

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

      {/* Legend overlay */}
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
```

**NOTE:** The map will show zero pins until client addresses have latitude/longitude values. Geocoding integration (Google Places Autocomplete on the AddClient address field) is deferred to a follow-up task. For testing, manually set lat/lng values in the `client_addresses` table.

- [ ] **Step 2: Commit**

```bash
git add src/pages/Transport/TransportMap.jsx
git commit -m "feat: add TransportMap component with color-coded pins and legend"
```

---

## Task 9: TransportScheduler — Full Page Assembly

**Files:**
- Modify: `src/pages/Transport/TransportScheduler.jsx` (replace placeholder)

- [ ] **Step 1: Implement the full TransportScheduler page**

Replace the placeholder `src/pages/Transport/TransportScheduler.jsx` with the full implementation. This is the main orchestrator — it manages date navigation, shift tabs, state, save, and repeat-last-weekday.

```javascript
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { format, addDays, subDays, isWeekend, nextMonday, previousFriday } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowLeft, NavArrowRight, Refresh } from 'iconoir-react'
import {
  getTransportClients,
  filterClientsForShift,
  getArrangementForDate,
  saveTransportDay,
  findLastWeekdayArrangement,
  copyArrangementFromDate,
  buildDefaultFleet
} from '../../services/transport/transportService'
import { SHIFTS, DAY_NAMES, DAY_LABELS_ES } from '../../services/transport/transportConstants'
import TransportMap from './TransportMap'
import CarAssignmentPanel from './CarAssignmentPanel'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'

function getDateStr(date) {
  return format(date, 'yyyy-MM-dd')
}

function skipWeekend(date, direction) {
  const next = direction === 'next' ? addDays(date, 1) : subDays(date, 1)
  if (isWeekend(next)) {
    return direction === 'next' ? nextMonday(next) : previousFriday(next)
  }
  return next
}

function buildEmptyShifts() {
  return {
    morning_arrive: { cars: buildDefaultFleet(), unassigned: [] },
    morning_leave: { cars: buildDefaultFleet(), unassigned: [] },
    afternoon_arrive: { cars: buildDefaultFleet(), unassigned: [] },
    afternoon_leave: { cars: buildDefaultFleet(), unassigned: [] }
  }
}

export default function TransportScheduler() {
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date()
    return isWeekend(today) ? nextMonday(today) : today
  })
  const [activeShift, setActiveShift] = useState('morning_arrive')
  const [shifts, setShifts] = useState(buildEmptyShifts)
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [allClients, setAllClients] = useState([])
  const [lastWeekdayAvailable, setLastWeekdayAvailable] = useState(false)
  const [showRepeatConfirm, setShowRepeatConfirm] = useState(false)
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(null) // target date or null
  const [showSaveWarning, setShowSaveWarning] = useState(false)
  const [highlightedClient, setHighlightedClient] = useState(null)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null) // { type: 'success'|'error', message }

  const dateStr = getDateStr(currentDate)
  const dayName = DAY_NAMES[currentDate.getDay()]
  const dayLabelEs = DAY_LABELS_ES[dayName] || dayName

  // Client lookup map
  const clientsById = useMemo(() => {
    const map = new Map()
    allClients.forEach(c => map.set(c.id, c))
    return map
  }, [allClients])

  // Clients for current shift
  const shiftClients = useMemo(() => {
    return filterClientsForShift(allClients, activeShift, dayName)
  }, [allClients, activeShift, dayName])

  // Total unique transport clients for the day
  const totalDayClients = useMemo(() => {
    const ids = new Set()
    SHIFTS.forEach(s => {
      filterClientsForShift(allClients, s.id, dayName).forEach(c => ids.add(c.id))
    })
    return ids.size
  }, [allClients, dayName])

  // Shift attendee counts
  const shiftCounts = useMemo(() => {
    const counts = {}
    SHIFTS.forEach(s => {
      counts[s.id] = filterClientsForShift(allClients, s.id, dayName).length
    })
    return counts
  }, [allClients, dayName])

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadDay = useCallback(async (date) => {
    setLoading(true)
    setError(null)
    try {
      const dStr = getDateStr(date)
      const dName = DAY_NAMES[date.getDay()]

      // Load clients and saved arrangement in parallel
      const [clients, arrangement, lastWeekday] = await Promise.all([
        getTransportClients(),
        getArrangementForDate(dStr),
        findLastWeekdayArrangement(dStr)
      ])

      setAllClients(clients)
      setLastWeekdayAvailable(!!lastWeekday)

      if (arrangement) {
        // Build state from saved data, reconcile with current clients
        const newShifts = {}
        for (const shift of SHIFTS) {
          const shiftClients = filterClientsForShift(clients, shift.id, dName)
          const shiftClientIds = new Set(shiftClients.map(c => c.id))
          const savedShift = arrangement.shifts[shift.id] || { cars: [] }

          // Reconcile: only keep assigned clients that still belong to this shift
          const cars = savedShift.cars.map(car => ({
            ...car,
            memberIds: (car.memberIds || []).filter(id => shiftClientIds.has(id))
          }))

          const assignedIds = new Set(cars.flatMap(c => c.memberIds))
          const unassigned = shiftClients
            .filter(c => !assignedIds.has(c.id))
            .map(c => c.id)

          newShifts[shift.id] = { cars, unassigned }
        }
        setShifts(newShifts)
      } else {
        // No saved data — default fleet, all clients unassigned
        const newShifts = {}
        for (const shift of SHIFTS) {
          const eligible = filterClientsForShift(clients, shift.id, dName)
          newShifts[shift.id] = {
            cars: buildDefaultFleet(),
            unassigned: eligible.map(c => c.id)
          }
        }
        setShifts(newShifts)
      }

      setIsDirty(false)
    } catch (err) {
      console.error('Error loading transport day:', err)
      setError('Error al cargar los datos de transporte')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDay(currentDate)
  }, [currentDate, loadDay])

  // ── Navigation ────────────────────────────────────────────────────────────

  function navigateDay(direction) {
    const target = skipWeekend(currentDate, direction)
    if (isDirty) {
      setShowUnsavedConfirm(target)
    } else {
      setCurrentDate(target)
    }
  }

  function confirmNavigate() {
    const target = showUnsavedConfirm
    setShowUnsavedConfirm(null)
    setIsDirty(false)
    setCurrentDate(target)
  }

  // ── Shift state change (ref to avoid stale closure during DnD) ─────────

  const activeShiftRef = useRef(activeShift)
  activeShiftRef.current = activeShift

  const handleShiftStateChange = useCallback((updater) => {
    setShifts(prev => {
      const activeKey = activeShiftRef.current
      const newShiftState = typeof updater === 'function'
        ? updater(prev[activeKey])
        : updater
      return { ...prev, [activeKey]: newShiftState }
    })
    setIsDirty(true)
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    // Check for unassigned clients across all shifts
    const totalUnassigned = Object.values(shifts).reduce((sum, s) => sum + s.unassigned.length, 0)

    if (totalUnassigned > 0) {
      setShowSaveWarning(true)
      return
    }

    await doSave()
  }

  async function doSave() {
    setShowSaveWarning(false)
    setSaving(true)
    try {
      await saveTransportDay(dateStr, shifts)
      setIsDirty(false)
      setToast({ type: 'success', message: `Transporte del ${format(currentDate, "d 'de' MMMM", { locale: es })} guardado` })
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      console.error('Error saving transport day:', err)
      setToast({ type: 'error', message: 'Error al guardar. Intentá nuevamente.' })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  // ── Repeat last weekday ───────────────────────────────────────────────────

  async function handleRepeatLastWeekday() {
    setShowRepeatConfirm(true)
  }

  async function confirmRepeat() {
    setShowRepeatConfirm(false)
    setLoading(true)
    try {
      const lastArrangement = await findLastWeekdayArrangement(dateStr)
      if (!lastArrangement) return

      const sourceData = await copyArrangementFromDate(lastArrangement.date)
      if (!sourceData) return

      // Reconcile with current clients
      const newShifts = {}
      for (const shift of SHIFTS) {
        const eligible = filterClientsForShift(allClients, shift.id, dayName)
        const eligibleIds = new Set(eligible.map(c => c.id))
        const savedShift = sourceData.shifts[shift.id] || { cars: [] }

        const cars = savedShift.cars.map(car => ({
          ...car,
          id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          memberIds: (car.memberIds || []).filter(id => eligibleIds.has(id))
        }))

        const assignedIds = new Set(cars.flatMap(c => c.memberIds))
        const unassigned = eligible.filter(c => !assignedIds.has(c.id)).map(c => c.id)

        newShifts[shift.id] = { cars, unassigned }
      }

      setShifts(newShifts)
      setIsDirty(true)
    } catch (err) {
      console.error('Error repeating arrangement:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Pin click → highlight in panel ────────────────────────────────────────

  function handlePinClick(clientId) {
    setHighlightedClient(clientId)
    setTimeout(() => setHighlightedClient(null), 2000)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateDay('prev')}
            className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <NavArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-bold text-gray-900 capitalize">
              {format(currentDate, "EEEE d 'de' MMMM, yyyy", { locale: es })}
            </h1>
            <p className="text-xs text-gray-500">
              {totalDayClients} asistente{totalDayClients !== 1 ? 's' : ''} con transporte
            </p>
          </div>
          <button
            onClick={() => navigateDay('next')}
            className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <NavArrowRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRepeatLastWeekday}
            disabled={!lastWeekdayAvailable || loading}
            title={lastWeekdayAvailable ? undefined : `No hay datos previos para ${dayLabelEs}`}
          >
            <Refresh className="w-4 h-4" />
            Repetir último {dayLabelEs}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            loading={saving}
            disabled={loading}
          >
            Guardar día
          </Button>
        </div>
      </div>

      {/* Shift Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 flex">
        {SHIFTS.map(shift => (
          <button
            key={shift.id}
            onClick={() => setActiveShift(shift.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeShift === shift.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {shift.label} · {shift.time}
            <span className={`ml-2 inline-flex items-center justify-center px-1.5 py-0.5 text-xs rounded-full ${
              activeShift === shift.id
                ? 'bg-indigo-100 text-indigo-600'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {shiftCounts[shift.id] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
          <p className="text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => { setError(null); loadDay(currentDate) }}>
            Reintentar
          </Button>
        </div>
      ) : shiftClients.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          No hay asistentes con transporte para este turno
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <TransportMap
            shiftClients={shiftClients}
            shiftState={shifts[activeShift]}
            onPinClick={handlePinClick}
            highlightedClient={highlightedClient}
          />
          <CarAssignmentPanel
            shiftState={shifts[activeShift]}
            onStateChange={handleShiftStateChange}
            clientsById={clientsById}
          />
        </div>
      )}

      {/* Unsaved changes modal */}
      <Modal isOpen={!!showUnsavedConfirm} onClose={() => setShowUnsavedConfirm(null)} title="Cambios sin guardar" size="sm">
        <p className="text-gray-600 mb-6">Tenés cambios sin guardar. ¿Querés descartarlos?</p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowUnsavedConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={confirmNavigate}>Descartar</Button>
        </div>
      </Modal>

      {/* Repeat confirm modal */}
      <Modal isOpen={showRepeatConfirm} onClose={() => setShowRepeatConfirm(false)} title="Repetir configuración" size="sm">
        <p className="text-gray-600 mb-6">
          Esto reemplazará la configuración actual de todos los turnos del día. ¿Continuar?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowRepeatConfirm(false)}>Cancelar</Button>
          <Button onClick={confirmRepeat}>Confirmar</Button>
        </div>
      </Modal>

      {/* Save with unassigned warning */}
      <Modal isOpen={showSaveWarning} onClose={() => setShowSaveWarning(false)} title="Asistentes sin asignar" size="sm">
        <p className="text-gray-600 mb-6">
          Hay asistentes sin asignar a un auto. ¿Guardar de todos modos?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowSaveWarning(false)}>Cancelar</Button>
          <Button onClick={doSave}>Guardar</Button>
        </div>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Compile Tailwind**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
```

- [ ] **Step 3: Verify the page loads**

Run `npm start`, navigate to `/transporte`. Expected:
- Day navigation works (skips weekends)
- Shift tabs render with correct labels
- Map loads (or shows API key error if key not configured)
- Car panel shows default fleet with unassigned clients
- DnD works between unassigned pool and cars
- Save button calls RPC (will fail if migration not applied — that's ok for now)

- [ ] **Step 4: Commit**

```bash
git add src/pages/Transport/TransportScheduler.jsx src/tailwind.output.css
git commit -m "feat: implement full TransportScheduler page with day nav, shifts, map, and DnD"
```

---

## Task 10: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update transport references in CLAUDE.md**

1. In the **Precios** section (under "Reglas de Negocio"), replace:
   ```
   - Transporte agrega +20% al precio base
   ```
   with:
   ```
   - El transporte se factura por separado, por viaje realizado
   - El precio por viaje depende de la frecuencia del plan del cliente
   ```

2. In the **Estructura de Archivos** section, add under `src/pages/`:
   ```
   │   ├── Transport/
   │   │   ├── TransportScheduler.jsx  # Planificación diaria de transporte
   │   │   ├── TransportMap.jsx        # Mapa con Google Maps
   │   │   ├── CarAssignmentPanel.jsx  # Panel DnD de autos
   │   │   ├── CarCard.jsx             # Card de auto individual
   │   │   └── ClientChip.jsx          # Chip de cliente arrastrable
   ```

3. Add under `src/services/`:
   ```
   │   ├── transport/
   │   │   ├── transportService.js     # CRUD transporte
   │   │   └── transportConstants.js   # Turnos, colores, flota default
   ```

4. In the **DB Migrations** or **Modelo de Datos** section, add a note about `transport_day_arrangements`, `transport_shift_cars`, `transport_shift_assignments`, and `transport_trip_counts`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with transport module and remove old pricing references"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | DB migration: tables, RPC, RLS, pricing cleanup | `012_transport_scheduling.sql` |
| 2 | Service layer + constants | `transportService.js`, `transportConstants.js` |
| 3 | Frontend pricing cleanup | `pricingService.js`, `AddClient.jsx` |
| 4 | Route + nav + placeholder | `App.js`, `Navbar.jsx` |
| 5 | Install Maps + ClientChip | `ClientChip.jsx`, `package.json` |
| 6 | CarCard component | `CarCard.jsx` |
| 7 | CarAssignmentPanel with DnD | `CarAssignmentPanel.jsx` |
| 8 | Google Maps panel | `TransportMap.jsx` |
| 9 | Full page assembly | `TransportScheduler.jsx` |
| 10 | Docs update | `CLAUDE.md` |

**Dependencies between tasks:**
- Task 1 (DB) can run in parallel with Tasks 2-8 (frontend)
- Tasks 2, 3 have no frontend dependencies — can run early
- Task 4 creates the route — needed before Task 9
- Tasks 5, 6, 7, 8 are independent components — can run in parallel
- Task 9 depends on Tasks 2, 5, 6, 7, 8 (assembles everything)
- Task 10 runs last
