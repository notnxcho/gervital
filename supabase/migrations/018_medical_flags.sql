-- ════════════════════════════════════════════════════════════════════════════
-- 018_medical_flags.sql
-- Adds three boolean medical conditions to medical_info and threads them through
-- the clients_full view and the create/update RPCs.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE medical_info
  ADD COLUMN IF NOT EXISTS is_diabetic     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_celiac       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_hypertensive BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. clients_full view (from 017) + flag fields ──────────────────────────────
CREATE OR REPLACE VIEW clients_full AS
 SELECT c.id,
    c.first_name AS "firstName",
    c.last_name AS "lastName",
    c.email,
    c.phone,
    c.birth_date AS "birthDate",
    c.cognitive_level AS "cognitiveLevel",
    c.start_date AS "startDate",
    ( SELECT count(*)::int FROM recovery_credits rc
      WHERE rc.client_id = c.id
        AND rc.status = 'available'
        AND rc.expires_at >= CURRENT_DATE ) AS "recoveryDaysAvailable",
    c.avatar_url AS "avatarUrl",
    c.deleted_at AS "deletedAt",
    c.deactivation_reason AS "deactivationReason",
    c.deactivation_notes AS "deactivationNotes",
    c.created_at AS "createdAt",
        CASE
            WHEN cp.id IS NOT NULL THEN jsonb_build_object('frequency', cp.frequency, 'schedule', cp.schedule, 'hasTransport', cp.has_transport, 'assignedDays', cp.assigned_days)
            ELSE NULL::jsonb
        END AS plan,
        CASE
            WHEN ec.id IS NOT NULL THEN jsonb_build_object('name', ec.name, 'relationship', ec.relationship, 'phone', ec.phone)
            ELSE NULL::jsonb
        END AS "emergencyContact",
        CASE
            WHEN ca.id IS NOT NULL THEN jsonb_build_object('street', ca.street, 'accessNotes', ca.access_notes, 'doorbell', ca.doorbell, 'concierge', ca.concierge, 'latitude', ca.latitude, 'longitude', ca.longitude, 'distanceRange', ca.distance_range)
            ELSE NULL::jsonb
        END AS address,
        CASE
            WHEN mi.id IS NOT NULL THEN jsonb_build_object('dietaryRestrictions', mi.dietary_restrictions, 'medicalRestrictions', mi.medical_restrictions, 'mobilityRestrictions', mi.mobility_restrictions, 'medication', mi.medication, 'medicationSchedule', mi.medication_schedule, 'notes', mi.notes, 'isDiabetic', mi.is_diabetic, 'isCeliac', mi.is_celiac, 'isHypertensive', mi.is_hypertensive)
            ELSE NULL::jsonb
        END AS "medicalInfo"
   FROM clients c
     LEFT JOIN client_plans cp ON c.id = cp.client_id
     LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- ── 3. create_client_full overload A (no distance_range, from 017) + flags ─────
CREATE OR REPLACE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT false,
  p_plan_assigned_days text[] DEFAULT '{}', p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_med_dietary text DEFAULT NULL,
  p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL, p_med_medication text DEFAULT NULL,
  p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL,
  p_med_is_diabetic boolean DEFAULT false, p_med_is_celiac boolean DEFAULT false, p_med_is_hypertensive boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date)
  RETURNING id INTO v_client_id;
  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (v_client_id, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days);
  END IF;
  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (v_client_id, p_ec_name, p_ec_relationship, p_ec_phone);
  END IF;
  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge);
  END IF;
  INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive)
  VALUES (v_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, p_med_is_diabetic, p_med_is_celiac, p_med_is_hypertensive);
  RETURN v_client_id;
END;
$function$;

-- ── 4. create_client_full overload B (with distance_range, from 017) + flags ───
CREATE OR REPLACE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT false,
  p_plan_assigned_days text[] DEFAULT '{}', p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_med_dietary text DEFAULT NULL, p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL,
  p_med_medication text DEFAULT NULL, p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL,
  p_med_is_diabetic boolean DEFAULT false, p_med_is_celiac boolean DEFAULT false, p_med_is_hypertensive boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date)
  RETURNING id INTO v_client_id;
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
  INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive)
  VALUES (v_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, p_med_is_diabetic, p_med_is_celiac, p_med_is_hypertensive);
  RETURN v_client_id;
END;
$function$;

-- ── 5. update_client_full (from 012) + flags ───────────────────────────────────
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
  p_med_notes TEXT DEFAULT NULL,
  p_med_is_diabetic BOOLEAN DEFAULT NULL,
  p_med_is_celiac BOOLEAN DEFAULT NULL,
  p_med_is_hypertensive BOOLEAN DEFAULT NULL
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
     OR p_med_medication IS NOT NULL OR p_med_medication_schedule IS NOT NULL OR p_med_notes IS NOT NULL
     OR p_med_is_diabetic IS NOT NULL OR p_med_is_celiac IS NOT NULL OR p_med_is_hypertensive IS NOT NULL THEN
    INSERT INTO medical_info (
      client_id, dietary_restrictions, medical_restrictions,
      mobility_restrictions, medication, medication_schedule, notes,
      is_diabetic, is_celiac, is_hypertensive
    ) VALUES (
      p_client_id, p_med_dietary, p_med_medical,
      p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes,
      COALESCE(p_med_is_diabetic, FALSE), COALESCE(p_med_is_celiac, FALSE), COALESCE(p_med_is_hypertensive, FALSE)
    )
    ON CONFLICT (client_id) DO UPDATE SET
      dietary_restrictions = COALESCE(EXCLUDED.dietary_restrictions, medical_info.dietary_restrictions),
      medical_restrictions = COALESCE(EXCLUDED.medical_restrictions, medical_info.medical_restrictions),
      mobility_restrictions = COALESCE(EXCLUDED.mobility_restrictions, medical_info.mobility_restrictions),
      medication = COALESCE(EXCLUDED.medication, medical_info.medication),
      medication_schedule = COALESCE(EXCLUDED.medication_schedule, medical_info.medication_schedule),
      notes = COALESCE(EXCLUDED.notes, medical_info.notes),
      is_diabetic = COALESCE(p_med_is_diabetic, medical_info.is_diabetic),
      is_celiac = COALESCE(p_med_is_celiac, medical_info.is_celiac),
      is_hypertensive = COALESCE(p_med_is_hypertensive, medical_info.is_hypertensive),
      updated_at = NOW();
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
