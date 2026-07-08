-- ════════════════════════════════════════════════════════════════════════════
-- 047_client_medical_fields_expansion.sql
-- Amplia la ficha de cliente: campos personales (estado civil, domicilio),
-- servicio de salud, tratamiento farmacologico (tabla), antecedentes (tabla),
-- diagnosticos (tabla) e historia de vida. Migra datos existentes de medical_info
-- y dropea columnas viejas sin destino. Recrea clients_full y los RPC.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas nuevas en clients ───────────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS marital_status TEXT,
  ADD COLUMN IF NOT EXISTS residence_type TEXT,
  ADD COLUMN IF NOT EXISTS lives_with     TEXT;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_marital_status_check;
ALTER TABLE clients ADD CONSTRAINT clients_marital_status_check
  CHECK (marital_status IS NULL OR marital_status IN ('soltero','viudo','casado','divorciado','concubinato'));
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_residence_type_check;
ALTER TABLE clients ADD CONSTRAINT clients_residence_type_check
  CHECK (residence_type IS NULL OR residence_type IN ('residencial','propio','familiar','otro'));

-- ── 2. Columnas nuevas en medical_info ──────────────────────────────────────
ALTER TABLE medical_info
  ADD COLUMN IF NOT EXISTS health_emergency_service TEXT,
  ADD COLUMN IF NOT EXISTS health_provider          TEXT,
  ADD COLUMN IF NOT EXISTS health_notes             TEXT,
  ADD COLUMN IF NOT EXISTS medication_notes         TEXT,
  ADD COLUMN IF NOT EXISTS history_notes            TEXT,
  ADD COLUMN IF NOT EXISTS education_level          TEXT,
  ADD COLUMN IF NOT EXISTS occupation               TEXT,
  ADD COLUMN IF NOT EXISTS significant_interests    TEXT,
  ADD COLUMN IF NOT EXISTS significant_bonds        TEXT,
  ADD COLUMN IF NOT EXISTS music_taste              TEXT,
  ADD COLUMN IF NOT EXISTS favorite_foods           TEXT,
  ADD COLUMN IF NOT EXISTS personality_type         TEXT,
  ADD COLUMN IF NOT EXISTS personal_resources       TEXT,
  ADD COLUMN IF NOT EXISTS vulnerabilities          TEXT;

ALTER TABLE medical_info DROP CONSTRAINT IF EXISTS medical_info_personality_type_check;
ALTER TABLE medical_info ADD CONSTRAINT medical_info_personality_type_check
  CHECK (personality_type IS NULL OR personality_type IN ('introvertido','extrovertido'));

-- ── 3. Tablas nuevas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_medications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          TEXT,
  schedule      TEXT,
  dose          TEXT,
  indicated_for TEXT,
  position      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_medications_client ON client_medications(client_id);

CREATE TABLE IF NOT EXISTS client_diagnoses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  diagnosis_type    TEXT CHECK (diagnosis_type IS NULL OR diagnosis_type IN ('sin','declive_cognitivo','deterioro_cognitivo','demencia')),
  behavior_disorder TEXT,
  position          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_diagnoses_client ON client_diagnoses(client_id);

CREATE TABLE IF NOT EXISTS client_medical_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  condition  TEXT NOT NULL CHECK (condition IN (
    'diabetes','celiaquia','hipertension','intolerancia_lactosa','dislipidemia',
    'cardiovascular','acv','demencia','cancer','caidas','fracturas','cirugia',
    'hospitalizacion','tuberculosis','hepatitis','alergias','restriccion_alimenticia')),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, condition)
);
CREATE INDEX IF NOT EXISTS idx_client_medical_history_client ON client_medical_history(client_id);

-- ── 4. RLS (espeja emergency_contacts: is_authenticated()) ──────────────────
ALTER TABLE client_medications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_diagnoses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_medical_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmed_select ON client_medications;
DROP POLICY IF EXISTS cmed_insert ON client_medications;
DROP POLICY IF EXISTS cmed_update ON client_medications;
DROP POLICY IF EXISTS cmed_delete ON client_medications;
CREATE POLICY cmed_select ON client_medications FOR SELECT USING (is_authenticated());
CREATE POLICY cmed_insert ON client_medications FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY cmed_update ON client_medications FOR UPDATE USING (is_authenticated());
CREATE POLICY cmed_delete ON client_medications FOR DELETE USING (is_authenticated());

DROP POLICY IF EXISTS cdiag_select ON client_diagnoses;
DROP POLICY IF EXISTS cdiag_insert ON client_diagnoses;
DROP POLICY IF EXISTS cdiag_update ON client_diagnoses;
DROP POLICY IF EXISTS cdiag_delete ON client_diagnoses;
CREATE POLICY cdiag_select ON client_diagnoses FOR SELECT USING (is_authenticated());
CREATE POLICY cdiag_insert ON client_diagnoses FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY cdiag_update ON client_diagnoses FOR UPDATE USING (is_authenticated());
CREATE POLICY cdiag_delete ON client_diagnoses FOR DELETE USING (is_authenticated());

DROP POLICY IF EXISTS chist_select ON client_medical_history;
DROP POLICY IF EXISTS chist_insert ON client_medical_history;
DROP POLICY IF EXISTS chist_update ON client_medical_history;
DROP POLICY IF EXISTS chist_delete ON client_medical_history;
CREATE POLICY chist_select ON client_medical_history FOR SELECT USING (is_authenticated());
CREATE POLICY chist_insert ON client_medical_history FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY chist_update ON client_medical_history FOR UPDATE USING (is_authenticated());
CREATE POLICY chist_delete ON client_medical_history FOR DELETE USING (is_authenticated());

-- ── 5. Migracion de datos (ANTES de dropear columnas) ───────────────────────
INSERT INTO client_medical_history (client_id, condition)
SELECT client_id, 'diabetes' FROM medical_info WHERE is_diabetic
ON CONFLICT (client_id, condition) DO NOTHING;
INSERT INTO client_medical_history (client_id, condition)
SELECT client_id, 'celiaquia' FROM medical_info WHERE is_celiac
ON CONFLICT (client_id, condition) DO NOTHING;
INSERT INTO client_medical_history (client_id, condition)
SELECT client_id, 'hipertension' FROM medical_info WHERE is_hypertensive
ON CONFLICT (client_id, condition) DO NOTHING;
INSERT INTO client_medical_history (client_id, condition)
SELECT client_id, 'intolerancia_lactosa' FROM medical_info WHERE is_lactose_intolerant
ON CONFLICT (client_id, condition) DO NOTHING;

INSERT INTO client_medical_history (client_id, condition, comment)
SELECT client_id, 'restriccion_alimenticia', dietary_restrictions
FROM medical_info WHERE NULLIF(btrim(dietary_restrictions), '') IS NOT NULL
ON CONFLICT (client_id, condition) DO UPDATE SET comment = EXCLUDED.comment;

INSERT INTO client_medications (client_id, name, schedule, position)
SELECT client_id, medication, medication_schedule, 0
FROM medical_info WHERE NULLIF(btrim(medication), '') IS NOT NULL;

-- ── 6. Drop de columnas viejas (perdida irreversible de lo no migrado) ──────
-- La vista clients_full referencia estas columnas viejas; hay que dropearla
-- primero (se recrea en el paso 7 con la nueva forma de medicalInfo).
DROP VIEW IF EXISTS clients_full;
ALTER TABLE medical_info
  DROP COLUMN IF EXISTS dietary_restrictions,
  DROP COLUMN IF EXISTS medical_restrictions,
  DROP COLUMN IF EXISTS mobility_restrictions,
  DROP COLUMN IF EXISTS medication,
  DROP COLUMN IF EXISTS medication_schedule,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS is_diabetic,
  DROP COLUMN IF EXISTS is_celiac,
  DROP COLUMN IF EXISTS is_hypertensive,
  DROP COLUMN IF EXISTS is_lactose_intolerant;

-- ── 7. Recrear clients_full ─────────────────────────────────────────────────
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
    c.is_charity AS "isCharity"
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

-- ── 8. Drop firmas viejas de los RPC (evitar overload accumulation) ─────────
DROP FUNCTION IF EXISTS public.create_client_full(text,text,text,text,date,text,date,integer,text,boolean,text[],text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text,jsonb,text,boolean,boolean);
DROP FUNCTION IF EXISTS public.update_client_full(uuid,text,text,text,text,date,text,date,integer,text,boolean,text[],text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text,jsonb,text,boolean,boolean);

-- ── 9. Recrear create_client_full ───────────────────────────────────────────
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
  p_is_charity boolean DEFAULT false)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_client_id UUID;
  v_contact_count INTEGER;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date, document_type, document_number, transfer_responsible, marital_status, residence_type, lives_with, is_charity)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date, COALESCE(p_document_type,'ci'), p_document_number, p_transfer_responsible, p_marital_status, p_residence_type, p_lives_with,
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

-- ── 10. Recrear update_client_full ──────────────────────────────────────────
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
  p_is_charity boolean DEFAULT NULL)
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

-- ── 11. Preservar security_invoker en la vista (idempotente) ────────────────
ALTER VIEW public.clients_full SET (security_invoker = on);
