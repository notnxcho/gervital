-- ════════════════════════════════════════════════════════════════════════════
-- 048_client_type.sql
-- Reemplaza el booleano clients.is_charity por client_type (regular|charity|trial).
-- 'charity' (beneficencia) y 'trial' (a prueba) son operativos: participan de la
-- operativa pero NO facturan ni cuentan en los agregadores de dinero. Se comportan
-- igual entre si; solo difieren en la etiqueta visual (frontend).
-- Backfill: is_charity = true  ->  client_type = 'charity'.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Nueva columna + backfill ─────────────────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_client_type_check;
ALTER TABLE clients ADD CONSTRAINT clients_client_type_check
  CHECK (client_type IN ('regular','charity','trial'));
UPDATE clients SET client_type = 'charity' WHERE is_charity;

-- ── 2. Agregadores de dinero: excluir no-facturables (charity + trial) ──────
-- Misma definicion viva de la migracion 042, cambiando `NOT c.is_charity`
-- por `c.client_type = 'regular'` (excluye charity Y trial).

CREATE OR REPLACE FUNCTION public.get_dashboard_finance_series(p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer)
 RETURNS TABLE(year integer, month integer, att_net numeric, att_gross numeric, trans_net numeric, trans_gross numeric, paid_att_net numeric, paid_att_gross numeric, paid_trans_net numeric, paid_trans_gross numeric, expenses_total numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH bounds AS (
    SELECT p_from_year * 12 + p_from_month AS lo,
           p_to_year   * 12 + p_to_month   AS hi
  ),
  months AS (
    SELECT (i / 12) AS year, (i % 12) AS month
    FROM bounds, generate_series(bounds.lo, bounds.hi) AS i
  ),
  live AS (
    SELECT m.year, m.month,
      COALESCE(SUM((b->>'attendanceChargeableNet')::numeric), 0)   AS att_net,
      COALESCE(SUM((b->>'attendanceChargeableGross')::numeric), 0) AS att_gross,
      COALESCE(SUM((b->>'transportChargeableNet')::numeric), 0)    AS trans_net,
      COALESCE(SUM((b->>'transportChargeableGross')::numeric), 0)  AS trans_gross
    FROM months m
    JOIN clients c
      ON c.deleted_at IS NULL
     AND c.client_type = 'regular'
     AND date_trunc('month', c.start_date) <= make_date(m.year, m.month + 1, 1)
    CROSS JOIN LATERAL calculate_month_billing(c.id, m.year, m.month) AS b
    WHERE (b->>'error') IS NULL
    GROUP BY m.year, m.month
  ),
  paid AS (
    SELECT mi.year, mi.month,
      COALESCE(SUM(mi.attendance_chargeable_net), 0)   AS paid_att_net,
      COALESCE(SUM(mi.attendance_chargeable_gross), 0) AS paid_att_gross,
      COALESCE(SUM(mi.transport_chargeable_net), 0)    AS paid_trans_net,
      COALESCE(SUM(mi.transport_chargeable_gross), 0)  AS paid_trans_gross
    FROM monthly_invoices mi, bounds
    WHERE mi.payment_status = 'paid'
      AND mi.year * 12 + mi.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY mi.year, mi.month
  ),
  exp AS (
    SELECT e.year, e.month, COALESCE(SUM(e.amount), 0) AS expenses_total
    FROM expenses e, bounds
    WHERE e.year * 12 + e.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY e.year, e.month
  )
  SELECT
    m.year,
    m.month,
    COALESCE(live.att_net, 0),
    COALESCE(live.att_gross, 0),
    COALESCE(live.trans_net, 0),
    COALESCE(live.trans_gross, 0),
    COALESCE(paid.paid_att_net, 0),
    COALESCE(paid.paid_att_gross, 0),
    COALESCE(paid.paid_trans_net, 0),
    COALESCE(paid.paid_trans_gross, 0),
    COALESCE(exp.expenses_total, 0)
  FROM months m
  LEFT JOIN live ON live.year = m.year AND live.month = m.month
  LEFT JOIN paid ON paid.year = m.year AND paid.month = m.month
  LEFT JOIN exp  ON exp.year  = m.year AND exp.month  = m.month
  ORDER BY 1, 2;
$function$;

CREATE OR REPLACE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(client_id uuid, attendance_net numeric, attendance_gross numeric, transport_net numeric, transport_gross numeric, payment_status text, invoice_status text, paid_amount numeric, paid_date date, invoice_number text, invoiced_at timestamp with time zone, invoice_date date, invoiced_amount numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    c.id,
    (b->>'attendanceChargeableNet')::numeric,
    (b->>'attendanceChargeableGross')::numeric,
    (b->>'transportChargeableNet')::numeric,
    (b->>'transportChargeableGross')::numeric,
    COALESCE(mi.payment_status, 'pending'),
    COALESCE(mi.invoice_status, 'pending'),
    mi.paid_amount,
    mi.paid_date,
    mi.invoice_number,
    mi.invoiced_at,
    mi.invoice_date,
    mi.chargeable_amount
  FROM clients c
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  LEFT JOIN monthly_invoices mi
    ON mi.client_id = c.id AND mi.year = p_year AND mi.month = p_month
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND c.client_type = 'regular'
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_billing_breakdown_rows(p_year integer, p_month integer)
 RETURNS TABLE(client_id uuid, frequency integer, schedule text, cognitive_level text, has_transport boolean, is_deactivated boolean, attendance_net numeric, attendance_gross numeric, transport_net numeric, transport_gross numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    c.id, cp.frequency, cp.schedule, c.cognitive_level,
    cp.has_transport, (c.deleted_at IS NOT NULL),
    (b->>'attendanceChargeableNet')::numeric,
    (b->>'attendanceChargeableGross')::numeric,
    (b->>'transportChargeableNet')::numeric,
    (b->>'transportChargeableGross')::numeric
  FROM clients c
  LEFT JOIN LATERAL (
    SELECT cp.frequency, cp.schedule, cp.has_transport
    FROM client_plans cp
    WHERE cp.client_id = c.id AND cp.effective_from <= make_date(p_year, p_month + 1, 1)
    ORDER BY cp.effective_from DESC LIMIT 1
  ) cp ON true
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND c.client_type = 'regular'
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

-- ── 3. Recrear clients_full (isCharity -> clientType) y dropear la columna ──
-- La vista referencia c.is_charity; hay que dropearla antes de dropear la columna.
DROP VIEW IF EXISTS clients_full;
ALTER TABLE clients DROP COLUMN IF EXISTS is_charity;

CREATE VIEW clients_full WITH (security_invoker = true) AS
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
    c.marital_status AS "maritalStatus",
    c.residence_type AS "residenceType",
    c.lives_with AS "livesWith",
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
            WHEN mi.id IS NOT NULL THEN jsonb_build_object(
              'healthEmergencyService', mi.health_emergency_service,
              'healthProvider', mi.health_provider,
              'healthNotes', mi.health_notes,
              'medicationNotes', mi.medication_notes,
              'historyNotes', mi.history_notes,
              'educationLevel', mi.education_level,
              'occupation', mi.occupation,
              'significantInterests', mi.significant_interests,
              'significantBonds', mi.significant_bonds,
              'musicTaste', mi.music_taste,
              'favoriteFoods', mi.favorite_foods,
              'character', mi.personality_type,
              'personalResources', mi.personal_resources,
              'vulnerabilities', mi.vulnerabilities)
            ELSE NULL::jsonb
        END AS "medicalInfo",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', m.name, 'schedule', m.schedule, 'dose', m.dose, 'indicatedFor', m.indicated_for) ORDER BY m."position", m.created_at)
           FROM client_medications m WHERE m.client_id = c.id), '[]'::jsonb) AS "medications",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('diagnosisType', d.diagnosis_type, 'behaviorDisorder', d.behavior_disorder) ORDER BY d."position", d.created_at)
           FROM client_diagnoses d WHERE d.client_id = c.id), '[]'::jsonb) AS "diagnoses",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('condition', h.condition, 'comment', h.comment) ORDER BY h.created_at)
           FROM client_medical_history h WHERE h.client_id = c.id), '[]'::jsonb) AS "medicalHistory",
    c.transfer_responsible AS "transferResponsible",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', ec2.name, 'relationship', ec2.relationship, 'phone', ec2.phone) ORDER BY ec2."position", ec2.created_at) AS jsonb_agg
           FROM emergency_contacts ec2
          WHERE ec2.client_id = c.id), '[]'::jsonb) AS "emergencyContacts",
    c.deactivation_date AS "deactivationDate",
    c.client_type AS "clientType"
   FROM clients c
     LEFT JOIN LATERAL ( SELECT cp2.id, cp2.frequency, cp2.schedule, cp2.has_transport, cp2.assigned_days
           FROM client_plans cp2
          WHERE cp2.client_id = c.id AND cp2.effective_from <= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date
          ORDER BY cp2.effective_from DESC
         LIMIT 1) cp ON true
     LEFT JOIN LATERAL ( SELECT ec1.id, ec1.name, ec1.relationship, ec1.phone
           FROM emergency_contacts ec1
          WHERE ec1.client_id = c.id
          ORDER BY ec1."position", ec1.created_at
         LIMIT 1) ec ON true
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

ALTER VIEW public.clients_full SET (security_invoker = on);

-- ── 4. RPCs: drop firmas viejas (p_is_charity) + recrear con p_client_type ──
-- La firma vieja (migracion 047) termina en p_is_charity boolean. Se dropea por
-- firma completa (nombre+tipo) para evitar acumulacion de overloads.
DROP FUNCTION IF EXISTS public.create_client_full(p_first_name text, p_last_name text, p_email text, p_phone text, p_birth_date date, p_cognitive_level text, p_start_date date, p_document_type text, p_document_number text, p_marital_status text, p_residence_type text, p_lives_with text, p_plan_frequency integer, p_plan_schedule text, p_plan_has_transport boolean, p_plan_assigned_days text[], p_emergency_contacts jsonb, p_transfer_responsible text, p_addr_street text, p_addr_access_notes text, p_addr_doorbell text, p_addr_concierge text, p_addr_distance_range text, p_health_emergency_service text, p_health_provider text, p_health_notes text, p_medication_notes text, p_history_notes text, p_education_level text, p_occupation text, p_significant_interests text, p_significant_bonds text, p_music_taste text, p_favorite_foods text, p_character text, p_personal_resources text, p_vulnerabilities text, p_medications jsonb, p_diagnoses jsonb, p_medical_history jsonb, p_is_charity boolean);
DROP FUNCTION IF EXISTS public.update_client_full(p_client_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text, p_birth_date date, p_cognitive_level text, p_start_date date, p_document_type text, p_document_number text, p_marital_status text, p_residence_type text, p_lives_with text, p_plan_frequency integer, p_plan_schedule text, p_plan_has_transport boolean, p_plan_assigned_days text[], p_emergency_contacts jsonb, p_transfer_responsible text, p_addr_street text, p_addr_access_notes text, p_addr_doorbell text, p_addr_concierge text, p_addr_distance_range text, p_health_emergency_service text, p_health_provider text, p_health_notes text, p_medication_notes text, p_history_notes text, p_education_level text, p_occupation text, p_significant_interests text, p_significant_bonds text, p_music_taste text, p_favorite_foods text, p_character text, p_personal_resources text, p_vulnerabilities text, p_medications jsonb, p_diagnoses jsonb, p_medical_history jsonb, p_is_charity boolean);

CREATE OR REPLACE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_document_type text DEFAULT 'ci', p_document_number text DEFAULT NULL,
  p_marital_status text DEFAULT NULL, p_residence_type text DEFAULT NULL, p_lives_with text DEFAULT NULL,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL,
  p_plan_has_transport boolean DEFAULT false, p_plan_assigned_days text[] DEFAULT '{}',
  p_emergency_contacts jsonb DEFAULT NULL, p_transfer_responsible text DEFAULT NULL,
  p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL, p_addr_doorbell text DEFAULT NULL,
  p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_health_emergency_service text DEFAULT NULL, p_health_provider text DEFAULT NULL, p_health_notes text DEFAULT NULL,
  p_medication_notes text DEFAULT NULL, p_history_notes text DEFAULT NULL,
  p_education_level text DEFAULT NULL, p_occupation text DEFAULT NULL, p_significant_interests text DEFAULT NULL,
  p_significant_bonds text DEFAULT NULL, p_music_taste text DEFAULT NULL, p_favorite_foods text DEFAULT NULL,
  p_character text DEFAULT NULL, p_personal_resources text DEFAULT NULL, p_vulnerabilities text DEFAULT NULL,
  p_medications jsonb DEFAULT NULL, p_diagnoses jsonb DEFAULT NULL, p_medical_history jsonb DEFAULT NULL,
  p_client_type text DEFAULT 'regular')
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_client_id UUID;
  v_contact_count INTEGER;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date, document_type, document_number, transfer_responsible, marital_status, residence_type, lives_with, client_type)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date, COALESCE(p_document_type,'ci'), p_document_number, p_transfer_responsible, p_marital_status, p_residence_type, p_lives_with,
          CASE WHEN is_admin_or_superadmin() THEN COALESCE(p_client_type, 'regular') ELSE 'regular' END)
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

  INSERT INTO medical_info (client_id, health_emergency_service, health_provider, health_notes, medication_notes, history_notes, education_level, occupation, significant_interests, significant_bonds, music_taste, favorite_foods, personality_type, personal_resources, vulnerabilities)
  VALUES (v_client_id, p_health_emergency_service, p_health_provider, p_health_notes, p_medication_notes, p_history_notes, p_education_level, p_occupation, p_significant_interests, p_significant_bonds, p_music_taste, p_favorite_foods, p_character, p_personal_resources, p_vulnerabilities);

  INSERT INTO client_medications (client_id, name, schedule, dose, indicated_for, position)
  SELECT v_client_id, NULLIF(trim(e->>'name'),''), NULLIF(trim(e->>'schedule'),''), NULLIF(trim(e->>'dose'),''), NULLIF(trim(e->>'indicatedFor'),''), (ord - 1)::int
  FROM jsonb_array_elements(COALESCE(p_medications, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
  WHERE NULLIF(trim(e->>'name'),'') IS NOT NULL OR NULLIF(trim(e->>'schedule'),'') IS NOT NULL OR NULLIF(trim(e->>'dose'),'') IS NOT NULL OR NULLIF(trim(e->>'indicatedFor'),'') IS NOT NULL;

  INSERT INTO client_diagnoses (client_id, diagnosis_type, behavior_disorder, position)
  SELECT v_client_id, NULLIF(trim(e->>'diagnosisType'),''), NULLIF(trim(e->>'behaviorDisorder'),''), (ord - 1)::int
  FROM jsonb_array_elements(COALESCE(p_diagnoses, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
  WHERE NULLIF(trim(e->>'diagnosisType'),'') IS NOT NULL OR NULLIF(trim(e->>'behaviorDisorder'),'') IS NOT NULL;

  INSERT INTO client_medical_history (client_id, condition, comment)
  SELECT v_client_id, e->>'condition', NULLIF(trim(e->>'comment'),'')
  FROM jsonb_array_elements(COALESCE(p_medical_history, '[]'::jsonb)) AS e
  WHERE NULLIF(trim(e->>'condition'),'') IS NOT NULL
  ON CONFLICT (client_id, condition) DO NOTHING;

  RETURN v_client_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_client_full(
  p_client_id uuid,
  p_first_name text DEFAULT NULL, p_last_name text DEFAULT NULL, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT NULL,
  p_document_type text DEFAULT NULL, p_document_number text DEFAULT NULL,
  p_marital_status text DEFAULT NULL, p_residence_type text DEFAULT NULL, p_lives_with text DEFAULT NULL,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL,
  p_plan_has_transport boolean DEFAULT NULL, p_plan_assigned_days text[] DEFAULT NULL,
  p_emergency_contacts jsonb DEFAULT NULL, p_transfer_responsible text DEFAULT NULL,
  p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL, p_addr_doorbell text DEFAULT NULL,
  p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_health_emergency_service text DEFAULT NULL, p_health_provider text DEFAULT NULL, p_health_notes text DEFAULT NULL,
  p_medication_notes text DEFAULT NULL, p_history_notes text DEFAULT NULL,
  p_education_level text DEFAULT NULL, p_occupation text DEFAULT NULL, p_significant_interests text DEFAULT NULL,
  p_significant_bonds text DEFAULT NULL, p_music_taste text DEFAULT NULL, p_favorite_foods text DEFAULT NULL,
  p_character text DEFAULT NULL, p_personal_resources text DEFAULT NULL, p_vulnerabilities text DEFAULT NULL,
  p_medications jsonb DEFAULT NULL, p_diagnoses jsonb DEFAULT NULL, p_medical_history jsonb DEFAULT NULL,
  p_client_type text DEFAULT NULL)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
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
    marital_status = COALESCE(p_marital_status, marital_status),
    residence_type = COALESCE(p_residence_type, residence_type),
    lives_with = COALESCE(p_lives_with, lives_with),
    client_type = CASE WHEN is_admin_or_superadmin() THEN COALESCE(p_client_type, client_type) ELSE client_type END,
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

  -- medical_info scalars: upsert. COALESCE preserva si NULL; '' explicito borra.
  INSERT INTO medical_info (client_id, health_emergency_service, health_provider, health_notes, medication_notes, history_notes, education_level, occupation, significant_interests, significant_bonds, music_taste, favorite_foods, personality_type, personal_resources, vulnerabilities)
  VALUES (p_client_id, p_health_emergency_service, p_health_provider, p_health_notes, p_medication_notes, p_history_notes, p_education_level, p_occupation, p_significant_interests, p_significant_bonds, p_music_taste, p_favorite_foods, p_character, p_personal_resources, p_vulnerabilities)
  ON CONFLICT (client_id) DO UPDATE SET
    health_emergency_service = COALESCE(EXCLUDED.health_emergency_service, medical_info.health_emergency_service),
    health_provider = COALESCE(EXCLUDED.health_provider, medical_info.health_provider),
    health_notes = COALESCE(EXCLUDED.health_notes, medical_info.health_notes),
    medication_notes = COALESCE(EXCLUDED.medication_notes, medical_info.medication_notes),
    history_notes = COALESCE(EXCLUDED.history_notes, medical_info.history_notes),
    education_level = COALESCE(EXCLUDED.education_level, medical_info.education_level),
    occupation = COALESCE(EXCLUDED.occupation, medical_info.occupation),
    significant_interests = COALESCE(EXCLUDED.significant_interests, medical_info.significant_interests),
    significant_bonds = COALESCE(EXCLUDED.significant_bonds, medical_info.significant_bonds),
    music_taste = COALESCE(EXCLUDED.music_taste, medical_info.music_taste),
    favorite_foods = COALESCE(EXCLUDED.favorite_foods, medical_info.favorite_foods),
    personality_type = COALESCE(EXCLUDED.personality_type, medical_info.personality_type),
    personal_resources = COALESCE(EXCLUDED.personal_resources, medical_info.personal_resources),
    vulnerabilities = COALESCE(EXCLUDED.vulnerabilities, medical_info.vulnerabilities),
    updated_at = NOW();

  IF p_medications IS NOT NULL THEN
    DELETE FROM client_medications WHERE client_id = p_client_id;
    INSERT INTO client_medications (client_id, name, schedule, dose, indicated_for, position)
    SELECT p_client_id, NULLIF(trim(e->>'name'),''), NULLIF(trim(e->>'schedule'),''), NULLIF(trim(e->>'dose'),''), NULLIF(trim(e->>'indicatedFor'),''), (ord - 1)::int
    FROM jsonb_array_elements(p_medications) WITH ORDINALITY AS t(e, ord)
    WHERE NULLIF(trim(e->>'name'),'') IS NOT NULL OR NULLIF(trim(e->>'schedule'),'') IS NOT NULL OR NULLIF(trim(e->>'dose'),'') IS NOT NULL OR NULLIF(trim(e->>'indicatedFor'),'') IS NOT NULL;
  END IF;

  IF p_diagnoses IS NOT NULL THEN
    DELETE FROM client_diagnoses WHERE client_id = p_client_id;
    INSERT INTO client_diagnoses (client_id, diagnosis_type, behavior_disorder, position)
    SELECT p_client_id, NULLIF(trim(e->>'diagnosisType'),''), NULLIF(trim(e->>'behaviorDisorder'),''), (ord - 1)::int
    FROM jsonb_array_elements(p_diagnoses) WITH ORDINALITY AS t(e, ord)
    WHERE NULLIF(trim(e->>'diagnosisType'),'') IS NOT NULL OR NULLIF(trim(e->>'behaviorDisorder'),'') IS NOT NULL;
  END IF;

  IF p_medical_history IS NOT NULL THEN
    DELETE FROM client_medical_history WHERE client_id = p_client_id;
    INSERT INTO client_medical_history (client_id, condition, comment)
    SELECT p_client_id, e->>'condition', NULLIF(trim(e->>'comment'),'')
    FROM jsonb_array_elements(p_medical_history) AS e
    WHERE NULLIF(trim(e->>'condition'),'') IS NOT NULL
    ON CONFLICT (client_id, condition) DO NOTHING;
  END IF;

  RETURN TRUE;
END;
$function$;
