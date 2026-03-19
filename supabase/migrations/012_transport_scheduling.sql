-- ============================================
-- 012: Transport Scheduling
-- Adds transport tables, updates clients_full view with lat/lng,
-- save_transport_day RPC, and removes old transport pricing from get_plan_price
-- ============================================

-- ============================================
-- Step 1 — Transport tables
-- ============================================

CREATE TABLE transport_day_arrangements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  saved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

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

CREATE TABLE transport_shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID NOT NULL REFERENCES transport_shift_cars(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (car_id, client_id)
);

CREATE TABLE transport_trip_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  trip_count INTEGER NOT NULL DEFAULT 0 CHECK (trip_count BETWEEN 0 AND 2),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, date)
);

ALTER TABLE client_addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE client_addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE client_addresses ADD COLUMN IF NOT EXISTS distance_range TEXT
  CHECK (distance_range IN ('under_1km', '1_to_5km', '5_to_10km', 'over_10km'));

-- ============================================
-- Step 2 — Update clients_full view to include lat/lng
-- ============================================

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

  -- Plan as nested object
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

  -- Emergency contact as nested object
  CASE
    WHEN ec.id IS NOT NULL THEN
      jsonb_build_object(
        'name', ec.name,
        'relationship', ec.relationship,
        'phone', ec.phone
      )
    ELSE NULL
  END AS "emergencyContact",

  -- Address as nested object
  CASE
    WHEN ca.id IS NOT NULL THEN
      jsonb_build_object(
        'street', ca.street,
        'accessNotes', ca.access_notes,
        'doorbell', ca.doorbell,
        'concierge', ca.concierge,
        'latitude', ca.latitude,
        'longitude', ca.longitude,
        'distanceRange', ca.distance_range
      )
    ELSE NULL
  END AS address,

  -- Medical info as nested object
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

-- ============================================
-- Step 3 — Indexes
-- ============================================

CREATE INDEX idx_transport_shift_cars_arrangement ON transport_shift_cars(arrangement_id);
CREATE INDEX idx_transport_assignments_car ON transport_shift_assignments(car_id);
CREATE INDEX idx_transport_assignments_client ON transport_shift_assignments(client_id);
CREATE INDEX idx_transport_trip_counts_date ON transport_trip_counts(date);

-- ============================================
-- Step 4 — Updated_at trigger
-- ============================================

CREATE TRIGGER set_transport_arrangements_updated_at
  BEFORE UPDATE ON transport_day_arrangements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Step 5 — RLS policies
-- ============================================

ALTER TABLE transport_day_arrangements ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_shift_cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_trip_counts ENABLE ROW LEVEL SECURITY;

-- transport_day_arrangements
CREATE POLICY "Transport day arrangements are viewable by authenticated users"
  ON transport_day_arrangements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Transport day arrangements are insertable by authenticated users"
  ON transport_day_arrangements FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Transport day arrangements are updatable by authenticated users"
  ON transport_day_arrangements FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Transport day arrangements are deletable by authenticated users"
  ON transport_day_arrangements FOR DELETE
  TO authenticated
  USING (true);

-- transport_shift_cars
CREATE POLICY "Transport shift cars are viewable by authenticated users"
  ON transport_shift_cars FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Transport shift cars are insertable by authenticated users"
  ON transport_shift_cars FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Transport shift cars are updatable by authenticated users"
  ON transport_shift_cars FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Transport shift cars are deletable by authenticated users"
  ON transport_shift_cars FOR DELETE
  TO authenticated
  USING (true);

-- transport_shift_assignments
CREATE POLICY "Transport shift assignments are viewable by authenticated users"
  ON transport_shift_assignments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Transport shift assignments are insertable by authenticated users"
  ON transport_shift_assignments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Transport shift assignments are updatable by authenticated users"
  ON transport_shift_assignments FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Transport shift assignments are deletable by authenticated users"
  ON transport_shift_assignments FOR DELETE
  TO authenticated
  USING (true);

-- transport_trip_counts
CREATE POLICY "Transport trip counts are viewable by authenticated users"
  ON transport_trip_counts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Transport trip counts are insertable by authenticated users"
  ON transport_trip_counts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Transport trip counts are updatable by authenticated users"
  ON transport_trip_counts FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Transport trip counts are deletable by authenticated users"
  ON transport_trip_counts FOR DELETE
  TO authenticated
  USING (true);

-- ============================================
-- Step 6 — save_transport_day RPC function
-- ============================================

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

  INSERT INTO transport_day_arrangements (date, saved_by)
  VALUES (v_date, auth.uid())
  ON CONFLICT (date) DO UPDATE SET updated_at = now(), saved_by = auth.uid()
  RETURNING id INTO v_arrangement_id;

  DELETE FROM transport_shift_cars WHERE arrangement_id = v_arrangement_id;
  DELETE FROM transport_trip_counts WHERE date = v_date;

  FOR v_shift IN SELECT unnest(ARRAY['morning_arrive', 'morning_leave', 'afternoon_arrive', 'afternoon_leave'])
  LOOP
    v_shift_data := p_data->'shifts'->v_shift;
    IF v_shift_data IS NULL THEN CONTINUE; END IF;

    FOR v_car IN SELECT * FROM jsonb_array_elements(v_shift_data->'cars')
    LOOP
      INSERT INTO transport_shift_cars (arrangement_id, shift, name, seat_count, color, position)
      VALUES (
        v_arrangement_id, v_shift,
        v_car->>'name', (v_car->>'seatCount')::INTEGER,
        v_car->>'color', (v_car->>'position')::INTEGER
      )
      RETURNING id INTO v_car_id;

      v_position := 0;
      FOR v_member_id IN SELECT * FROM jsonb_array_elements_text(v_car->'memberIds')
      LOOP
        v_client_id := v_member_id::UUID;
        INSERT INTO transport_shift_assignments (car_id, client_id, position)
        VALUES (v_car_id, v_client_id, v_position);
        v_position := v_position + 1;

        IF v_trip_counts ? v_member_id THEN
          v_trip_counts := jsonb_set(v_trip_counts, ARRAY[v_member_id], to_jsonb((v_trip_counts->>v_member_id)::INTEGER + 1));
        ELSE
          v_trip_counts := jsonb_set(v_trip_counts, ARRAY[v_member_id], '1'::JSONB);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOR v_member_id IN SELECT * FROM jsonb_object_keys(v_trip_counts)
  LOOP
    INSERT INTO transport_trip_counts (client_id, date, trip_count)
    VALUES (v_member_id::UUID, v_date, LEAST((v_trip_counts->>v_member_id)::INTEGER, 2));
  END LOOP;

  RETURN v_arrangement_id;
END;
$$;

-- ============================================
-- Step 7 — Cleanup old transport pricing from get_plan_price
-- ============================================

-- Drop old 3-parameter overload so it cannot be called accidentally
DROP FUNCTION IF EXISTS get_plan_price(INTEGER, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION get_plan_price(p_frequency INTEGER, p_schedule TEXT)
RETURNS NUMERIC AS $$
DECLARE v_base_price NUMERIC;
BEGIN
  SELECT price INTO v_base_price FROM plan_pricing
  WHERE frequency = p_frequency AND schedule = p_schedule;
  IF v_base_price IS NULL THEN
    RAISE EXCEPTION 'No pricing found for frequency % and schedule %', p_frequency, p_schedule;
  END IF;
  RETURN v_base_price;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- Step 8 — Add distance_range to create_client_full and update_client_full
-- ============================================

-- Recreate create_client_full with p_addr_distance_range parameter
CREATE OR REPLACE FUNCTION create_client_full(
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_birth_date DATE DEFAULT NULL,
  p_cognitive_level TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT CURRENT_DATE,
  p_plan_frequency INTEGER DEFAULT NULL,
  p_plan_schedule TEXT DEFAULT NULL,
  p_plan_has_transport BOOLEAN DEFAULT FALSE,
  p_plan_assigned_days TEXT[] DEFAULT '{}',
  p_ec_name TEXT DEFAULT NULL,
  p_ec_relationship TEXT DEFAULT NULL,
  p_ec_phone TEXT DEFAULT NULL,
  p_addr_street TEXT DEFAULT NULL,
  p_addr_access_notes TEXT DEFAULT NULL,
  p_addr_doorbell TEXT DEFAULT NULL,
  p_addr_concierge TEXT DEFAULT NULL,
  p_addr_distance_range TEXT DEFAULT NULL,
  p_med_dietary TEXT DEFAULT NULL,
  p_med_medical TEXT DEFAULT NULL,
  p_med_mobility TEXT DEFAULT NULL,
  p_med_medication TEXT DEFAULT NULL,
  p_med_medication_schedule TEXT DEFAULT NULL,
  p_med_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_client_id UUID;
BEGIN
  INSERT INTO clients (
    first_name, last_name, email, phone, birth_date,
    cognitive_level, start_date, recovery_days_available
  ) VALUES (
    p_first_name, p_last_name, p_email, p_phone, p_birth_date,
    p_cognitive_level, p_start_date, 0
  ) RETURNING id INTO v_client_id;

  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (v_client_id, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days);
  END IF;

  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (v_client_id, p_ec_name, p_ec_relationship, p_ec_phone);
  END IF;

  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range);
  END IF;

  INSERT INTO medical_info (
    client_id, dietary_restrictions, medical_restrictions,
    mobility_restrictions, medication, medication_schedule, notes
  ) VALUES (
    p_client_id, p_med_dietary, p_med_medical,
    p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes
  );

  RETURN v_client_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate update_client_full with p_addr_distance_range parameter
CREATE OR REPLACE FUNCTION update_client_full(
  p_client_id UUID,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_birth_date DATE DEFAULT NULL,
  p_cognitive_level TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_plan_frequency INTEGER DEFAULT NULL,
  p_plan_schedule TEXT DEFAULT NULL,
  p_plan_has_transport BOOLEAN DEFAULT NULL,
  p_plan_assigned_days TEXT[] DEFAULT NULL,
  p_ec_name TEXT DEFAULT NULL,
  p_ec_relationship TEXT DEFAULT NULL,
  p_ec_phone TEXT DEFAULT NULL,
  p_addr_street TEXT DEFAULT NULL,
  p_addr_access_notes TEXT DEFAULT NULL,
  p_addr_doorbell TEXT DEFAULT NULL,
  p_addr_concierge TEXT DEFAULT NULL,
  p_addr_distance_range TEXT DEFAULT NULL,
  p_med_dietary TEXT DEFAULT NULL,
  p_med_medical TEXT DEFAULT NULL,
  p_med_mobility TEXT DEFAULT NULL,
  p_med_medication TEXT DEFAULT NULL,
  p_med_medication_schedule TEXT DEFAULT NULL,
  p_med_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE clients SET
    first_name = COALESCE(p_first_name, first_name),
    last_name = COALESCE(p_last_name, last_name),
    email = COALESCE(p_email, email),
    phone = COALESCE(p_phone, phone),
    birth_date = COALESCE(p_birth_date, birth_date),
    cognitive_level = COALESCE(p_cognitive_level, cognitive_level),
    start_date = COALESCE(p_start_date, start_date),
    updated_at = NOW()
  WHERE id = p_client_id;

  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (p_client_id, p_plan_frequency, p_plan_schedule, COALESCE(p_plan_has_transport, FALSE), COALESCE(p_plan_assigned_days, '{}'))
    ON CONFLICT (client_id) DO UPDATE SET
      frequency = EXCLUDED.frequency,
      schedule = EXCLUDED.schedule,
      has_transport = EXCLUDED.has_transport,
      assigned_days = EXCLUDED.assigned_days,
      updated_at = NOW();
  END IF;

  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (p_client_id, p_ec_name, p_ec_relationship, p_ec_phone)
    ON CONFLICT (client_id) DO UPDATE SET
      name = EXCLUDED.name,
      relationship = EXCLUDED.relationship,
      phone = EXCLUDED.phone,
      updated_at = NOW();
  END IF;

  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (p_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range)
    ON CONFLICT (client_id) DO UPDATE SET
      street = EXCLUDED.street,
      access_notes = EXCLUDED.access_notes,
      doorbell = EXCLUDED.doorbell,
      concierge = EXCLUDED.concierge,
      distance_range = COALESCE(EXCLUDED.distance_range, client_addresses.distance_range),
      updated_at = NOW();
  END IF;

  IF p_med_dietary IS NOT NULL OR p_med_medical IS NOT NULL OR p_med_mobility IS NOT NULL
     OR p_med_medication IS NOT NULL OR p_med_medication_schedule IS NOT NULL OR p_med_notes IS NOT NULL THEN
    INSERT INTO medical_info (
      client_id, dietary_restrictions, medical_restrictions,
      mobility_restrictions, medication, medication_schedule, notes
    ) VALUES (
      p_client_id, p_med_dietary, p_med_medical,
      p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes
    )
    ON CONFLICT (client_id) DO UPDATE SET
      dietary_restrictions = COALESCE(EXCLUDED.dietary_restrictions, medical_info.dietary_restrictions),
      medical_restrictions = COALESCE(EXCLUDED.medical_restrictions, medical_info.medical_restrictions),
      mobility_restrictions = COALESCE(EXCLUDED.mobility_restrictions, medical_info.mobility_restrictions),
      medication = COALESCE(EXCLUDED.medication, medical_info.medication),
      medication_schedule = COALESCE(EXCLUDED.medication_schedule, medical_info.medication_schedule),
      notes = COALESCE(EXCLUDED.notes, medical_info.notes),
      updated_at = NOW();
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
