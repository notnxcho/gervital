-- ============================================
-- Database Functions
-- ============================================

-- ============================================
-- create_client_full: Atomic insert across all client tables
-- ============================================
CREATE OR REPLACE FUNCTION create_client_full(
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_birth_date DATE DEFAULT NULL,
  p_cognitive_level TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT CURRENT_DATE,
  -- Plan
  p_plan_frequency INTEGER DEFAULT NULL,
  p_plan_schedule TEXT DEFAULT NULL,
  p_plan_has_transport BOOLEAN DEFAULT FALSE,
  p_plan_assigned_days TEXT[] DEFAULT '{}',
  -- Emergency contact
  p_ec_name TEXT DEFAULT NULL,
  p_ec_relationship TEXT DEFAULT NULL,
  p_ec_phone TEXT DEFAULT NULL,
  -- Address
  p_addr_street TEXT DEFAULT NULL,
  p_addr_access_notes TEXT DEFAULT NULL,
  p_addr_doorbell TEXT DEFAULT NULL,
  p_addr_concierge TEXT DEFAULT NULL,
  -- Medical info
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
  -- Insert client
  INSERT INTO clients (
    first_name, last_name, email, phone, birth_date,
    cognitive_level, start_date, recovery_days_available
  ) VALUES (
    p_first_name, p_last_name, p_email, p_phone, p_birth_date,
    p_cognitive_level, p_start_date, 0
  ) RETURNING id INTO v_client_id;

  -- Insert plan if frequency is provided
  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (v_client_id, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days);
  END IF;

  -- Insert emergency contact if name is provided
  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (v_client_id, p_ec_name, p_ec_relationship, p_ec_phone);
  END IF;

  -- Insert address if street is provided
  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge);
  END IF;

  -- Insert medical info (always create record even if empty)
  INSERT INTO medical_info (
    client_id, dietary_restrictions, medical_restrictions,
    mobility_restrictions, medication, medication_schedule, notes
  ) VALUES (
    v_client_id, p_med_dietary, p_med_medical,
    p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes
  );

  RETURN v_client_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- update_client_full: Atomic update across all client tables
-- ============================================
CREATE OR REPLACE FUNCTION update_client_full(
  p_client_id UUID,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_birth_date DATE DEFAULT NULL,
  p_cognitive_level TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  -- Plan
  p_plan_frequency INTEGER DEFAULT NULL,
  p_plan_schedule TEXT DEFAULT NULL,
  p_plan_has_transport BOOLEAN DEFAULT NULL,
  p_plan_assigned_days TEXT[] DEFAULT NULL,
  -- Emergency contact
  p_ec_name TEXT DEFAULT NULL,
  p_ec_relationship TEXT DEFAULT NULL,
  p_ec_phone TEXT DEFAULT NULL,
  -- Address
  p_addr_street TEXT DEFAULT NULL,
  p_addr_access_notes TEXT DEFAULT NULL,
  p_addr_doorbell TEXT DEFAULT NULL,
  p_addr_concierge TEXT DEFAULT NULL,
  -- Medical info
  p_med_dietary TEXT DEFAULT NULL,
  p_med_medical TEXT DEFAULT NULL,
  p_med_mobility TEXT DEFAULT NULL,
  p_med_medication TEXT DEFAULT NULL,
  p_med_medication_schedule TEXT DEFAULT NULL,
  p_med_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Update client
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

  -- Update or insert plan
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

  -- Update or insert emergency contact
  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (p_client_id, p_ec_name, p_ec_relationship, p_ec_phone)
    ON CONFLICT (client_id) DO UPDATE SET
      name = EXCLUDED.name,
      relationship = EXCLUDED.relationship,
      phone = EXCLUDED.phone,
      updated_at = NOW();
  END IF;

  -- Update or insert address
  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge)
    VALUES (p_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge)
    ON CONFLICT (client_id) DO UPDATE SET
      street = EXCLUDED.street,
      access_notes = EXCLUDED.access_notes,
      doorbell = EXCLUDED.doorbell,
      concierge = EXCLUDED.concierge,
      updated_at = NOW();
  END IF;

  -- Update or insert medical info
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

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- consume_recovery_day: Validates and decrements recovery days
-- ============================================
CREATE OR REPLACE FUNCTION consume_recovery_day(
  p_client_id UUID,
  p_date DATE,
  p_shift TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_recovery_days INTEGER;
  v_attendance_record RECORD;
BEGIN
  -- Get current recovery days
  SELECT recovery_days_available INTO v_recovery_days
  FROM clients WHERE id = p_client_id;

  IF v_recovery_days IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Cliente no encontrado');
  END IF;

  IF v_recovery_days <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'No hay días de recupero disponibles');
  END IF;

  -- Decrement recovery days
  UPDATE clients
  SET recovery_days_available = recovery_days_available - 1,
      updated_at = NOW()
  WHERE id = p_client_id;

  -- Insert or update attendance record
  INSERT INTO attendance_records (client_id, date, shift, status)
  VALUES (p_client_id, p_date, p_shift, 'recovered')
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'recovered',
    shift = EXCLUDED.shift,
    updated_at = NOW()
  RETURNING * INTO v_attendance_record;

  RETURN jsonb_build_object(
    'success', TRUE,
    'attendance', jsonb_build_object(
      'date', v_attendance_record.date::TEXT,
      'status', v_attendance_record.status,
      'shift', v_attendance_record.shift
    ),
    'recoveryDaysAvailable', v_recovery_days - 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- increment_recovery_days: Increments recovery days for justified_recovered
-- ============================================
CREATE OR REPLACE FUNCTION increment_recovery_days(
  p_client_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_new_days INTEGER;
BEGIN
  UPDATE clients
  SET recovery_days_available = recovery_days_available + 1,
      updated_at = NOW()
  WHERE id = p_client_id
  RETURNING recovery_days_available INTO v_new_days;

  RETURN v_new_days;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- get_plan_price: Calculate price for a plan
-- ============================================
CREATE OR REPLACE FUNCTION get_plan_price(
  p_frequency INTEGER,
  p_schedule TEXT,
  p_has_transport BOOLEAN DEFAULT FALSE
)
RETURNS NUMERIC AS $$
DECLARE
  v_base_price NUMERIC;
BEGIN
  SELECT price INTO v_base_price
  FROM plan_pricing
  WHERE frequency = p_frequency AND schedule = p_schedule;

  IF v_base_price IS NULL THEN
    RETURN 0;
  END IF;

  -- Transport adds 20%
  IF p_has_transport THEN
    RETURN ROUND(v_base_price * 1.2);
  END IF;

  RETURN v_base_price;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- upsert_attendance: Insert or update attendance record
-- ============================================
CREATE OR REPLACE FUNCTION upsert_attendance(
  p_client_id UUID,
  p_date DATE,
  p_status TEXT,
  p_shift TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_old_status TEXT;
  v_record RECORD;
BEGIN
  -- Get old status if exists
  SELECT status INTO v_old_status
  FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date;

  -- Handle recovery day logic
  IF v_old_status IS NOT NULL AND v_old_status = 'justified_recovered' AND p_status != 'justified_recovered' THEN
    -- Decrement recovery days if changing FROM justified_recovered
    UPDATE clients SET recovery_days_available = recovery_days_available - 1
    WHERE id = p_client_id AND recovery_days_available > 0;
  END IF;

  IF (v_old_status IS NULL OR v_old_status != 'justified_recovered') AND p_status = 'justified_recovered' THEN
    -- Increment recovery days if changing TO justified_recovered
    UPDATE clients SET recovery_days_available = recovery_days_available + 1
    WHERE id = p_client_id;
  END IF;

  -- Insert or update attendance record
  INSERT INTO attendance_records (client_id, date, status, shift, notes)
  VALUES (p_client_id, p_date, p_status, p_shift, p_notes)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = EXCLUDED.status,
    shift = COALESCE(EXCLUDED.shift, attendance_records.shift),
    notes = COALESCE(EXCLUDED.notes, attendance_records.notes),
    updated_at = NOW()
  RETURNING * INTO v_record;

  RETURN jsonb_build_object(
    'date', v_record.date::TEXT,
    'status', v_record.status,
    'shift', v_record.shift,
    'notes', v_record.notes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- get_expenses_summary: Monthly expenses summary
-- ============================================
CREATE OR REPLACE FUNCTION get_expenses_summary(
  p_year INTEGER,
  p_month INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_expenses RECORD;
  v_total NUMERIC;
  v_recurring_count INTEGER;
  v_recurring_total NUMERIC;
  v_extraordinary_count INTEGER;
  v_extraordinary_total NUMERIC;
  v_pending NUMERIC;
  v_paid NUMERIC;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE type = 'recurring'),
    COALESCE(SUM(amount) FILTER (WHERE type = 'recurring'), 0),
    COUNT(*) FILTER (WHERE type = 'extraordinary'),
    COALESCE(SUM(amount) FILTER (WHERE type = 'extraordinary'), 0),
    COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0),
    COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0),
    COALESCE(SUM(amount), 0)
  INTO
    v_recurring_count,
    v_recurring_total,
    v_extraordinary_count,
    v_extraordinary_total,
    v_pending,
    v_paid,
    v_total
  FROM expenses
  WHERE year = p_year AND month = p_month;

  RETURN jsonb_build_object(
    'total', v_total,
    'recurring', jsonb_build_object(
      'count', v_recurring_count,
      'total', v_recurring_total
    ),
    'extraordinary', jsonb_build_object(
      'count', v_extraordinary_count,
      'total', v_extraordinary_total
    ),
    'pending', v_pending,
    'paid', v_paid
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
