-- 041_charity_clients.sql
-- Charity/beneficence clients: operational-only, excluded from billing & accounting.
-- Adds clients.is_charity, surfaces it in clients_full, threads p_is_charity through the
-- client RPCs (admin-only write guard), and adds void_pending_invoices.

-- 1. Flag ------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN is_charity BOOLEAN NOT NULL DEFAULT false;

-- 2. clients_full view: append "isCharity" ---------------------------------
CREATE OR REPLACE VIEW clients_full AS
 SELECT c.id,
    c.first_name AS "firstName",
    c.last_name AS "lastName",
    c.email,
    c.phone,
    c.birth_date AS "birthDate",
    c.cognitive_level AS "cognitiveLevel",
    c.start_date AS "startDate",
    c.document_type AS "documentType",
    c.document_number AS "documentNumber",
    c.biller_client_id AS "billerClientId",
    c.biller_branch_id AS "billerBranchId",
    c.biller_synced_at AS "billerSyncedAt",
    c.biller_sync_error AS "billerSyncError",
    ( SELECT count(*)::integer AS count
           FROM recovery_credits rc
          WHERE rc.client_id = c.id AND rc.status = 'available'::text AND rc.expires_at >= CURRENT_DATE) AS "recoveryDaysAvailable",
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
            WHEN mi.id IS NOT NULL THEN jsonb_build_object('dietaryRestrictions', mi.dietary_restrictions, 'medicalRestrictions', mi.medical_restrictions, 'mobilityRestrictions', mi.mobility_restrictions, 'medication', mi.medication, 'medicationSchedule', mi.medication_schedule, 'notes', mi.notes, 'isDiabetic', mi.is_diabetic, 'isCeliac', mi.is_celiac, 'isHypertensive', mi.is_hypertensive, 'isLactoseIntolerant', mi.is_lactose_intolerant)
            ELSE NULL::jsonb
        END AS "medicalInfo",
    c.transfer_responsible AS "transferResponsible",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', ec2.name, 'relationship', ec2.relationship, 'phone', ec2.phone) ORDER BY ec2."position", ec2.created_at) AS jsonb_agg
           FROM emergency_contacts ec2
          WHERE ec2.client_id = c.id), '[]'::jsonb) AS "emergencyContacts",
    c.deactivation_date AS "deactivationDate",
    c.is_charity AS "isCharity"
   FROM clients c
     LEFT JOIN LATERAL ( SELECT cp2.id,
            cp2.frequency,
            cp2.schedule,
            cp2.has_transport,
            cp2.assigned_days
           FROM client_plans cp2
          WHERE cp2.client_id = c.id AND cp2.effective_from <= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date
          ORDER BY cp2.effective_from DESC
         LIMIT 1) cp ON true
     LEFT JOIN LATERAL ( SELECT ec1.id,
            ec1.name,
            ec1.relationship,
            ec1.phone
           FROM emergency_contacts ec1
          WHERE ec1.client_id = c.id
          ORDER BY ec1."position", ec1.created_at
         LIMIT 1) ec ON true
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- 3. Client RPCs: drop old signatures, recreate with p_is_charity ----------
DROP FUNCTION IF EXISTS public.create_client_full(text,text,text,text,date,text,date,integer,text,boolean,text[],text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text,jsonb,text,boolean);
DROP FUNCTION IF EXISTS public.update_client_full(uuid,text,text,text,text,date,text,date,integer,text,boolean,text[],text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text,jsonb,text,boolean);

CREATE OR REPLACE FUNCTION public.create_client_full(p_first_name text, p_last_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_birth_date date DEFAULT NULL::date, p_cognitive_level text DEFAULT NULL::text, p_start_date date DEFAULT CURRENT_DATE, p_plan_frequency integer DEFAULT NULL::integer, p_plan_schedule text DEFAULT NULL::text, p_plan_has_transport boolean DEFAULT false, p_plan_assigned_days text[] DEFAULT '{}'::text[], p_addr_street text DEFAULT NULL::text, p_addr_access_notes text DEFAULT NULL::text, p_addr_doorbell text DEFAULT NULL::text, p_addr_concierge text DEFAULT NULL::text, p_addr_distance_range text DEFAULT NULL::text, p_med_dietary text DEFAULT NULL::text, p_med_medical text DEFAULT NULL::text, p_med_mobility text DEFAULT NULL::text, p_med_medication text DEFAULT NULL::text, p_med_medication_schedule text DEFAULT NULL::text, p_med_notes text DEFAULT NULL::text, p_med_is_diabetic boolean DEFAULT false, p_med_is_celiac boolean DEFAULT false, p_med_is_hypertensive boolean DEFAULT false, p_document_type text DEFAULT 'ci'::text, p_document_number text DEFAULT NULL::text, p_emergency_contacts jsonb DEFAULT NULL::jsonb, p_transfer_responsible text DEFAULT NULL::text, p_med_is_lactose_intolerant boolean DEFAULT false, p_is_charity boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_client_id UUID;
  v_contact_count INTEGER;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date, document_type, document_number, transfer_responsible, is_charity)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date, COALESCE(p_document_type,'ci'), p_document_number, p_transfer_responsible,
          CASE WHEN is_admin_or_superadmin() THEN COALESCE(p_is_charity, false) ELSE false END)
  RETURNING id INTO v_client_id;

  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, effective_from, frequency, schedule, has_transport, assigned_days, distance_range)
    VALUES (v_client_id, date_trunc('month', p_start_date)::date, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days, p_addr_distance_range);
  END IF;

  INSERT INTO emergency_contacts (client_id, name, relationship, phone, position)
  SELECT v_client_id, trim(e->>'name'), NULLIF(trim(e->>'relationship'), ''), trim(e->>'phone'), (ord - 1)::int
  FROM jsonb_array_elements(COALESCE(p_emergency_contacts, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
  WHERE NULLIF(trim(e->>'name'), '') IS NOT NULL AND NULLIF(trim(e->>'phone'), '') IS NOT NULL;

  SELECT count(*) INTO v_contact_count FROM emergency_contacts WHERE client_id = v_client_id;
  IF v_contact_count = 0 THEN
    RAISE EXCEPTION 'Se requiere al menos un contacto de emergencia con nombre y teléfono';
  END IF;

  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range);
  END IF;

  INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive, is_lactose_intolerant)
  VALUES (v_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, p_med_is_diabetic, p_med_is_celiac, p_med_is_hypertensive, p_med_is_lactose_intolerant);

  RETURN v_client_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_client_full(p_client_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_birth_date date DEFAULT NULL::date, p_cognitive_level text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_plan_frequency integer DEFAULT NULL::integer, p_plan_schedule text DEFAULT NULL::text, p_plan_has_transport boolean DEFAULT NULL::boolean, p_plan_assigned_days text[] DEFAULT NULL::text[], p_addr_street text DEFAULT NULL::text, p_addr_access_notes text DEFAULT NULL::text, p_addr_doorbell text DEFAULT NULL::text, p_addr_concierge text DEFAULT NULL::text, p_addr_distance_range text DEFAULT NULL::text, p_med_dietary text DEFAULT NULL::text, p_med_medical text DEFAULT NULL::text, p_med_mobility text DEFAULT NULL::text, p_med_medication text DEFAULT NULL::text, p_med_medication_schedule text DEFAULT NULL::text, p_med_notes text DEFAULT NULL::text, p_med_is_diabetic boolean DEFAULT NULL::boolean, p_med_is_celiac boolean DEFAULT NULL::boolean, p_med_is_hypertensive boolean DEFAULT NULL::boolean, p_document_type text DEFAULT NULL::text, p_document_number text DEFAULT NULL::text, p_emergency_contacts jsonb DEFAULT NULL::jsonb, p_transfer_responsible text DEFAULT NULL::text, p_med_is_lactose_intolerant boolean DEFAULT NULL::boolean, p_is_charity boolean DEFAULT NULL::boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_contact_count INTEGER;
BEGIN
  UPDATE clients SET
    first_name = COALESCE(p_first_name, first_name),
    last_name = COALESCE(p_last_name, last_name),
    email = COALESCE(p_email, email),
    phone = COALESCE(p_phone, phone),
    birth_date = COALESCE(p_birth_date, birth_date),
    cognitive_level = COALESCE(p_cognitive_level, cognitive_level),
    start_date = COALESCE(p_start_date, start_date),
    document_type = COALESCE(p_document_type, document_type),
    document_number = COALESCE(p_document_number, document_number),
    transfer_responsible = COALESCE(p_transfer_responsible, transfer_responsible),
    is_charity = CASE WHEN is_admin_or_superadmin() THEN COALESCE(p_is_charity, is_charity) ELSE is_charity END,
    updated_at = NOW()
  WHERE id = p_client_id;

  IF p_emergency_contacts IS NOT NULL THEN
    DELETE FROM emergency_contacts WHERE client_id = p_client_id;

    INSERT INTO emergency_contacts (client_id, name, relationship, phone, position)
    SELECT p_client_id, trim(e->>'name'), NULLIF(trim(e->>'relationship'), ''), trim(e->>'phone'), (ord - 1)::int
    FROM jsonb_array_elements(p_emergency_contacts) WITH ORDINALITY AS t(e, ord)
    WHERE NULLIF(trim(e->>'name'), '') IS NOT NULL AND NULLIF(trim(e->>'phone'), '') IS NOT NULL;

    SELECT count(*) INTO v_contact_count FROM emergency_contacts WHERE client_id = p_client_id;
    IF v_contact_count = 0 THEN
      RAISE EXCEPTION 'Se requiere al menos un contacto de emergencia con nombre y teléfono';
    END IF;
  END IF;

  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (p_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range)
    ON CONFLICT (client_id) DO UPDATE SET street = EXCLUDED.street, access_notes = EXCLUDED.access_notes,
      doorbell = EXCLUDED.doorbell, concierge = EXCLUDED.concierge,
      distance_range = COALESCE(EXCLUDED.distance_range, client_addresses.distance_range), updated_at = NOW();
  END IF;

  IF p_med_dietary IS NOT NULL OR p_med_medical IS NOT NULL OR p_med_mobility IS NOT NULL
     OR p_med_medication IS NOT NULL OR p_med_medication_schedule IS NOT NULL OR p_med_notes IS NOT NULL
     OR p_med_is_diabetic IS NOT NULL OR p_med_is_celiac IS NOT NULL OR p_med_is_hypertensive IS NOT NULL
     OR p_med_is_lactose_intolerant IS NOT NULL THEN
    INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive, is_lactose_intolerant)
    VALUES (p_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, COALESCE(p_med_is_diabetic,FALSE), COALESCE(p_med_is_celiac,FALSE), COALESCE(p_med_is_hypertensive,FALSE), COALESCE(p_med_is_lactose_intolerant,FALSE))
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
      is_lactose_intolerant = COALESCE(p_med_is_lactose_intolerant, medical_info.is_lactose_intolerant),
      updated_at = NOW();
  END IF;

  RETURN TRUE;
END;
$function$;

-- 4. Void pending, non-emitted invoices for a client (admin-only) ----------
CREATE OR REPLACE FUNCTION void_pending_invoices(p_client_id uuid)
RETURNS integer AS $$
DECLARE deleted_count integer;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM monthly_invoices
  WHERE client_id = p_client_id
    AND invoice_status = 'pending'
    AND invoiced_at IS NULL
    AND paid_at IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
