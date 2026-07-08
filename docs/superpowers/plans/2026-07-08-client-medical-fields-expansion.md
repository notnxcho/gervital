# Ampliación de campos de la ficha de cliente — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ampliar la ficha de cliente con campos personales y médicos nuevos (todos opcionales), modelando de forma relacional medicamentos, diagnósticos y antecedentes, migrando datos existentes y descartando campos de texto viejos sin destino.

**Architecture:** Enfoque normalizado (spec 2026-07-08). Nuevas tablas 1:N (`client_medications`, `client_diagnoses`, `client_medical_history`) + columnas nuevas en `clients` y `medical_info`. Todo se lee vía la vista `clients_full` (jsonb) y se escribe vía los RPC `create_client_full`/`update_client_full`, pasando los arrays como jsonb (patrón `emergency_contacts`).

**Tech Stack:** PostgreSQL (Supabase, migración SQL), React 19, servicios en `src/services/clients/`, Jest (craco test) para lógica pura.

**Spec:** `docs/superpowers/specs/2026-07-08-client-medical-fields-expansion-design.md`

**Convenciones del repo:** variables/código en inglés, textos UI en español, sin `;` en JS/JSX. Recompilar Tailwind tras cambios de estilo.

---

## Enums / condiciones canónicas (valores DB ⇄ etiquetas UI)

- **maritalStatus**: `soltero`→Soltero/a · `viudo`→Viudo/a · `casado`→Casado/a · `divorciado`→Divorciado/a · `concubinato`→Concubinato
- **residenceType**: `residencial`→Residencial · `propio`→Propio · `familiar`→Familiar · `otro`→Otro
- **character**: `introvertido`→Introvertido · `extrovertido`→Extrovertido
- **diagnosisType**: `sin`→Sin declive · `declive_cognitivo`→Declive cognitivo · `deterioro_cognitivo`→Deterioro cognitivo · `demencia`→Demencia
- **medicalHistory condition** (17): `diabetes`→Diabético · `celiaquia`→Celíaco · `hipertension`→Hipertenso · `intolerancia_lactosa`→Intolerante a la lactosa · `dislipidemia`→Dislipidemia (colesterol/triglicéridos altos) · `cardiovascular`→Enfermedades cardiovasculares · `acv`→ACV · `demencia`→Demencia · `cancer`→Cáncer · `caidas`→Caídas · `fracturas`→Fracturas · `cirugia`→Intervención quirúrgica · `hospitalizacion`→Hospitalizaciones · `tuberculosis`→Tuberculosis · `hepatitis`→Hepatitis · `alergias`→Alergias · `restriccion_alimenticia`→Restricciones alimenticias

**Formas de datos en el frontend (objeto cliente):**
- `client.maritalStatus`, `client.residenceType`, `client.livesWith` (strings a nivel raíz)
- `client.medicalInfo.{healthEmergencyService, healthProvider, healthNotes, medicationNotes, historyNotes, educationLevel, occupation, significantInterests, significantBonds, musicTaste, favoriteFoods, character, personalResources, vulnerabilities}`
- `client.medications`: `[{name, schedule, dose, indicatedFor}]`
- `client.diagnoses`: `[{diagnosisType, behaviorDisorder}]`
- `client.medicalHistory`: `[{condition, comment}]`

---

## Task 1: Migración 047 (esquema + datos + vista + RPC)

**Files:**
- Create: `supabase/migrations/047_client_medical_fields_expansion.sql`
- Apply: vía `mcp__supabase__apply_migration` (name: `client_medical_fields_expansion`)

- [ ] **Step 1: Escribir el archivo de migración**

Contenido exacto de `supabase/migrations/047_client_medical_fields_expansion.sql`:

```sql
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
```

- [ ] **Step 2: Aplicar la migración**

Aplicar con `mcp__supabase__apply_migration` (name `client_medical_fields_expansion`, query = contenido del archivo sin cambios).
Expected: sin error.

- [ ] **Step 3: Verificar esquema y datos migrados**

Ejecutar con `mcp__supabase__execute_sql`:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='medical_info' AND column_name IN ('dietary_restrictions','notes','is_diabetic','health_provider','character');
SELECT (SELECT count(*) FROM client_medical_history) AS hist, (SELECT count(*) FROM client_medications) AS meds;
SELECT jsonb_typeof(to_jsonb(cf.medications)) med_t, jsonb_typeof(to_jsonb(cf."medicalHistory")) hist_t FROM clients_full cf LIMIT 1;
```
Expected: la primera query devuelve solo `health_provider` y `character` (las viejas no existen); `hist`/`meds` reflejan los flags/medicación migrados; `med_t`/`hist_t` = `array`.

- [ ] **Step 4: Verificar RPC round-trip**

```sql
SELECT create_client_full(
  p_first_name := 'Test', p_last_name := 'MedFields',
  p_emergency_contacts := '[{"name":"C1","phone":"099"}]'::jsonb,
  p_marital_status := 'casado', p_residence_type := 'familiar', p_lives_with := 'Hija',
  p_health_provider := 'ASSE',
  p_medications := '[{"name":"Aspirina","schedule":"mañana","dose":"100mg","indicatedFor":"corazón"}]'::jsonb,
  p_diagnoses := '[{"diagnosisType":"deterioro_cognitivo","behaviorDisorder":"ansiedad"}]'::jsonb,
  p_medical_history := '[{"condition":"cancer","comment":"2019"},{"condition":"caidas","comment":""}]'::jsonb
) AS new_id;
```
Luego:
```sql
SELECT "maritalStatus","livesWith", medicalInfo->>'healthProvider' AS prov, medications, diagnoses, "medicalHistory"
FROM clients_full WHERE "firstName"='Test' AND "lastName"='MedFields';
```
Expected: los valores coinciden; `medications`/`diagnoses`/`medicalHistory` son arrays con los objetos esperados.
Cleanup:
```sql
DELETE FROM clients WHERE first_name='Test' AND last_name='MedFields';
```
Expected: cascada borra tablas hijas sin error.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/047_client_medical_fields_expansion.sql
git commit -m "feat(db): migracion 047 - ampliacion campos ficha cliente (medico + personal)"
```

---

## Task 2: Constantes de opciones médicas (JS compartido)

**Files:**
- Create: `src/services/clients/medicalConstants.js`
- Test: `src/services/clients/medicalConstants.test.js`

- [ ] **Step 1: Escribir test**

```javascript
import { MARITAL_STATUS_OPTIONS, RESIDENCE_TYPE_OPTIONS, CHARACTER_OPTIONS, DIAGNOSIS_TYPE_OPTIONS, MEDICAL_HISTORY_CONDITIONS } from './medicalConstants'

test('every option has value and label', () => {
  const all = [...MARITAL_STATUS_OPTIONS, ...RESIDENCE_TYPE_OPTIONS, ...CHARACTER_OPTIONS, ...DIAGNOSIS_TYPE_OPTIONS, ...MEDICAL_HISTORY_CONDITIONS]
  all.forEach(o => {
    expect(typeof o.value).toBe('string')
    expect(o.value.length).toBeGreaterThan(0)
    expect(typeof o.label).toBe('string')
    expect(o.label.length).toBeGreaterThan(0)
  })
})

test('medical history has the 17 canonical conditions', () => {
  expect(MEDICAL_HISTORY_CONDITIONS.map(c => c.value)).toEqual([
    'diabetes','celiaquia','hipertension','intolerancia_lactosa','dislipidemia',
    'cardiovascular','acv','demencia','cancer','caidas','fracturas','cirugia',
    'hospitalizacion','tuberculosis','hepatitis','alergias','restriccion_alimenticia'
  ])
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `CI=true npx craco test src/services/clients/medicalConstants.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar el módulo**

```javascript
// Opciones canónicas de la ficha médica. value = valor DB, label = texto UI.
export const MARITAL_STATUS_OPTIONS = [
  { value: 'soltero', label: 'Soltero/a' },
  { value: 'viudo', label: 'Viudo/a' },
  { value: 'casado', label: 'Casado/a' },
  { value: 'divorciado', label: 'Divorciado/a' },
  { value: 'concubinato', label: 'Concubinato' }
]

export const RESIDENCE_TYPE_OPTIONS = [
  { value: 'residencial', label: 'Residencial' },
  { value: 'propio', label: 'Propio' },
  { value: 'familiar', label: 'Familiar' },
  { value: 'otro', label: 'Otro' }
]

export const CHARACTER_OPTIONS = [
  { value: 'introvertido', label: 'Introvertido' },
  { value: 'extrovertido', label: 'Extrovertido' }
]

export const DIAGNOSIS_TYPE_OPTIONS = [
  { value: 'sin', label: 'Sin declive' },
  { value: 'declive_cognitivo', label: 'Declive cognitivo' },
  { value: 'deterioro_cognitivo', label: 'Deterioro cognitivo' },
  { value: 'demencia', label: 'Demencia' }
]

export const MEDICAL_HISTORY_CONDITIONS = [
  { value: 'diabetes', label: 'Diabético' },
  { value: 'celiaquia', label: 'Celíaco' },
  { value: 'hipertension', label: 'Hipertenso' },
  { value: 'intolerancia_lactosa', label: 'Intolerante a la lactosa' },
  { value: 'dislipidemia', label: 'Dislipidemia (colesterol/triglicéridos altos)' },
  { value: 'cardiovascular', label: 'Enfermedades cardiovasculares' },
  { value: 'acv', label: 'ACV' },
  { value: 'demencia', label: 'Demencia' },
  { value: 'cancer', label: 'Cáncer' },
  { value: 'caidas', label: 'Caídas' },
  { value: 'fracturas', label: 'Fracturas' },
  { value: 'cirugia', label: 'Intervención quirúrgica' },
  { value: 'hospitalizacion', label: 'Hospitalizaciones' },
  { value: 'tuberculosis', label: 'Tuberculosis' },
  { value: 'hepatitis', label: 'Hepatitis' },
  { value: 'alergias', label: 'Alergias' },
  { value: 'restriccion_alimenticia', label: 'Restricciones alimenticias' }
]
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `CI=true npx craco test src/services/clients/medicalConstants.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/medicalConstants.js src/services/clients/medicalConstants.test.js
git commit -m "feat(clients): constantes de opciones medicas (estado civil, domicilio, antecedentes, diagnostico)"
```

---

## Task 3: Transformers (frontend ⇄ RPC)

**Files:**
- Modify: `src/services/clients/clientTransformers.js`
- Test: `src/services/clients/clientTransformers.test.js` (crear)

- [ ] **Step 1: Escribir test**

```javascript
import { transformClientToDb, transformUpdateToDb, transformClientFromDb } from './clientTransformers'

test('transformClientToDb maps new personal + medical + arrays', () => {
  const p = transformClientToDb({
    firstName: 'A', lastName: 'B',
    maritalStatus: 'casado', residenceType: 'familiar', livesWith: 'Hija',
    medicalInfo: { healthProvider: 'ASSE', character: 'introvertido', occupation: 'Docente' },
    medications: [{ name: 'X', schedule: 'AM', dose: '1', indicatedFor: 'y' }],
    diagnoses: [{ diagnosisType: 'demencia', behaviorDisorder: 'z' }],
    medicalHistory: [{ condition: 'cancer', comment: '2019' }]
  })
  expect(p.p_marital_status).toBe('casado')
  expect(p.p_residence_type).toBe('familiar')
  expect(p.p_lives_with).toBe('Hija')
  expect(p.p_health_provider).toBe('ASSE')
  expect(p.p_character).toBe('introvertido')
  expect(p.p_occupation).toBe('Docente')
  expect(p.p_medications).toEqual([{ name: 'X', schedule: 'AM', dose: '1', indicatedFor: 'y' }])
  expect(p.p_diagnoses).toEqual([{ diagnosisType: 'demencia', behaviorDisorder: 'z' }])
  expect(p.p_medical_history).toEqual([{ condition: 'cancer', comment: '2019' }])
})

test('transformClientToDb defaults arrays to empty and has no legacy medical params', () => {
  const p = transformClientToDb({ firstName: 'A', lastName: 'B' })
  expect(p.p_medications).toEqual([])
  expect(p.p_diagnoses).toEqual([])
  expect(p.p_medical_history).toEqual([])
  expect('p_med_dietary' in p).toBe(false)
  expect('p_med_is_diabetic' in p).toBe(false)
})

test('transformUpdateToDb includes arrays and new medical scalars when present', () => {
  const p = transformUpdateToDb('id-1', {
    maritalStatus: 'viudo',
    medicalInfo: { healthNotes: 'nota' },
    medications: [], diagnoses: [], medicalHistory: [{ condition: 'caidas', comment: '' }]
  })
  expect(p.p_marital_status).toBe('viudo')
  expect(p.p_health_notes).toBe('nota')
  expect(p.p_medications).toEqual([])
  expect(p.p_medical_history).toEqual([{ condition: 'caidas', comment: '' }])
})

test('transformClientFromDb defaults new collections', () => {
  const c = transformClientFromDb({ firstName: 'A', lastName: 'B' })
  expect(c.medications).toEqual([])
  expect(c.diagnoses).toEqual([])
  expect(c.medicalHistory).toEqual([])
  expect(c.medicalInfo.healthProvider).toBe('')
  expect(c.maritalStatus).toBe('')
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `CI=true npx craco test src/services/clients/clientTransformers.test.js`
Expected: FAIL.

- [ ] **Step 3: Reescribir `transformClientToDb`**

Reemplazar el bloque `// Medical info` (líneas 35-45) y agregar personales + arrays. El objeto retornado debe quedar así (mantener todo lo existente de plan/address/emergency/document/charity, y REEMPLAZAR el bloque médico):

```javascript
    // Personal
    p_marital_status: clientData.maritalStatus || null,
    p_residence_type: clientData.residenceType || null,
    p_lives_with: clientData.livesWith || null,
    // Medical info (scalars)
    p_health_emergency_service: clientData.medicalInfo?.healthEmergencyService || null,
    p_health_provider: clientData.medicalInfo?.healthProvider || null,
    p_health_notes: clientData.medicalInfo?.healthNotes || null,
    p_medication_notes: clientData.medicalInfo?.medicationNotes || null,
    p_history_notes: clientData.medicalInfo?.historyNotes || null,
    p_education_level: clientData.medicalInfo?.educationLevel || null,
    p_occupation: clientData.medicalInfo?.occupation || null,
    p_significant_interests: clientData.medicalInfo?.significantInterests || null,
    p_significant_bonds: clientData.medicalInfo?.significantBonds || null,
    p_music_taste: clientData.medicalInfo?.musicTaste || null,
    p_favorite_foods: clientData.medicalInfo?.favoriteFoods || null,
    p_character: clientData.medicalInfo?.character || null,
    p_personal_resources: clientData.medicalInfo?.personalResources || null,
    p_vulnerabilities: clientData.medicalInfo?.vulnerabilities || null,
    // Medical collections (arrays -> jsonb)
    p_medications: clientData.medications || [],
    p_diagnoses: clientData.diagnoses || [],
    p_medical_history: clientData.medicalHistory || [],
    // Charity flag (write is admin-gated server-side)
    p_is_charity: clientData.isCharity || false
```

- [ ] **Step 4: Reescribir `transformClientFromDb` (bloque medicalInfo + nuevos defaults)**

Reemplazar el `medicalInfo: dbClient.medicalInfo || {...}` (líneas 92-103) y agregar defaults raíz:

```javascript
    maritalStatus: dbClient.maritalStatus || '',
    residenceType: dbClient.residenceType || '',
    livesWith: dbClient.livesWith || '',
    medications: dbClient.medications || [],
    diagnoses: dbClient.diagnoses || [],
    medicalHistory: dbClient.medicalHistory || [],
    medicalInfo: dbClient.medicalInfo || {
      healthEmergencyService: '', healthProvider: '', healthNotes: '',
      medicationNotes: '', historyNotes: '',
      educationLevel: '', occupation: '', significantInterests: '', significantBonds: '',
      musicTaste: '', favoriteFoods: '', character: '', personalResources: '', vulnerabilities: ''
    }
```
> Insertar estas claves dentro del objeto retornado por `transformClientFromDb` (junto a `emergencyContacts`, `address`, etc.). Mantener `...dbClient` y el resto de defaults intactos.

- [ ] **Step 5: Reescribir bloque médico de `transformUpdateToDb`**

Reemplazar el bloque `// Medical info` (líneas 144-156) por (mantener el resto: basic/emergency/address):

```javascript
  // Personal
  if (updateData.maritalStatus !== undefined) params.p_marital_status = updateData.maritalStatus
  if (updateData.residenceType !== undefined) params.p_residence_type = updateData.residenceType
  if (updateData.livesWith !== undefined) params.p_lives_with = updateData.livesWith

  // Medical info (scalars)
  if (updateData.medicalInfo) {
    const m = updateData.medicalInfo
    if (m.healthEmergencyService !== undefined) params.p_health_emergency_service = m.healthEmergencyService
    if (m.healthProvider !== undefined) params.p_health_provider = m.healthProvider
    if (m.healthNotes !== undefined) params.p_health_notes = m.healthNotes
    if (m.medicationNotes !== undefined) params.p_medication_notes = m.medicationNotes
    if (m.historyNotes !== undefined) params.p_history_notes = m.historyNotes
    if (m.educationLevel !== undefined) params.p_education_level = m.educationLevel
    if (m.occupation !== undefined) params.p_occupation = m.occupation
    if (m.significantInterests !== undefined) params.p_significant_interests = m.significantInterests
    if (m.significantBonds !== undefined) params.p_significant_bonds = m.significantBonds
    if (m.musicTaste !== undefined) params.p_music_taste = m.musicTaste
    if (m.favoriteFoods !== undefined) params.p_favorite_foods = m.favoriteFoods
    if (m.character !== undefined) params.p_character = m.character
    if (m.personalResources !== undefined) params.p_personal_resources = m.personalResources
    if (m.vulnerabilities !== undefined) params.p_vulnerabilities = m.vulnerabilities
  }

  // Medical collections
  if (updateData.medications !== undefined) params.p_medications = updateData.medications
  if (updateData.diagnoses !== undefined) params.p_diagnoses = updateData.diagnoses
  if (updateData.medicalHistory !== undefined) params.p_medical_history = updateData.medicalHistory
```

- [ ] **Step 6: Correr y ver que pasa**

Run: `CI=true npx craco test src/services/clients/clientTransformers.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/clients/clientTransformers.js src/services/clients/clientTransformers.test.js
git commit -m "feat(clients): transformers mapean campos personales/medicos nuevos y colecciones"
```

---

## Task 4: Componentes de fila repetible (medicamentos y diagnósticos)

**Files:**
- Create: `src/pages/Clients/medical/RepeatableRows.jsx`

Editor genérico de listas de objetos, reutilizable en `AddClient` y `ClientDetail`. Sin lógica de negocio: recibe `value` (array), `onChange`, y una definición de campos.

- [ ] **Step 1: Implementar el componente**

```javascript
import { Input, Select } from '../../../components/ui/Input'
import Button from '../../../components/ui/Button'
import { Plus, Trash } from 'iconoir-react'

// fields: [{ key, label, type: 'text'|'select', options?, placeholder? }]
// emptyRow: objeto con las keys en '' 
export function RepeatableRows({ value, onChange, fields, emptyRow, addLabel }) {
  const rows = value || []

  const updateRow = (idx, key, v) => {
    const next = rows.map((r, i) => i === idx ? { ...r, [key]: v } : r)
    onChange(next)
  }
  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx))
  const addRow = () => onChange([...rows, { ...emptyRow }])

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-gray-400">Sin registros. Usá "{addLabel}" para agregar.</p>
      )}
      {rows.map((row, idx) => (
        <div key={idx} className="flex flex-wrap items-end gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          {fields.map((f) => (
            <div key={f.key} className="flex-1 min-w-[140px]">
              {f.type === 'select' ? (
                <Select label={f.label} value={row[f.key] || ''} onChange={(e) => updateRow(idx, f.key, e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : (
                <Input label={f.label} value={row[f.key] || ''} placeholder={f.placeholder || ''} onChange={(e) => updateRow(idx, f.key, e.target.value)} />
              )}
            </div>
          ))}
          <button type="button" onClick={() => removeRow(idx)} className="p-2 text-gray-400 hover:text-red-600" aria-label="Quitar">
            <Trash width={18} height={18} />
          </button>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={addRow}>
        <Plus width={16} height={16} /> {addLabel}
      </Button>
    </div>
  )
}
```
> Verificar los imports reales: cómo se exportan `Input`/`Select` (named vs default) en `src/components/ui/Input.jsx` y `Button` en `src/components/ui/Button.jsx`, y el nombre de los iconos en `iconoir-react` (`Plus`, `Trash`). Ajustar si difiere. Consultar un uso existente (p.ej. el editor de contactos de emergencia en `AddClient.jsx`) para copiar el patrón exacto de imports y de `Select`.

- [ ] **Step 2: Verificar compilación**

Run: `CI=true npx craco test --watchAll=false --passWithNoTests src/pages/Clients/medical` (no hay test; sirve para detectar error de sintaxis/import vía build en Task 7). Alternativamente confiar en el arranque de `npm start` en Task 7.
Expected: sin error de import.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clients/medical/RepeatableRows.jsx
git commit -m "feat(clients): componente RepeatableRows para medicamentos y diagnosticos"
```

---

## Task 5: Wizard de alta (`AddClient.jsx`)

**Files:**
- Modify: `src/pages/Clients/AddClient.jsx`

Contexto: `AddClient` usa `formData` PLANO (no anidado). Al enviar arma el objeto anidado (`medicalInfo`, etc.) alrededor de la línea 358. Es la misma pantalla en modo alta y edición (`isEditMode`).

- [ ] **Step 1: Ampliar `initialFormData`**

Reemplazar el bloque médico plano actual (`dietaryRestrictions`…`isLactoseIntolerant`, líneas ~109-120) por los campos nuevos y agregar personales:

```javascript
  // Personal extra
  maritalStatus: '',
  residenceType: '',
  livesWith: '',
  // Servicio de salud
  healthEmergencyService: '',
  healthProvider: '',
  healthNotes: '',
  // Tratamiento farmacológico
  medications: [],
  medicationNotes: '',
  // Antecedentes
  medicalHistory: [], // [{condition, comment}]
  historyNotes: '',
  // Diagnóstico
  diagnoses: [], // [{diagnosisType, behaviorDisorder}]
  // Historia de vida
  educationLevel: '',
  occupation: '',
  significantInterests: '',
  significantBonds: '',
  musicTaste: '',
  favoriteFoods: '',
  character: '',
  personalResources: '',
  vulnerabilities: '',
```
> `isCharity` y todo lo previo (personal base, contacto, dirección, plan) queda igual.

- [ ] **Step 2: Cargar datos en modo edición**

En el efecto que hidrata `formData` desde el cliente cargado (donde hoy mapea `dietaryRestrictions: client.medicalInfo?.dietaryRestrictions || ''`, líneas ~197-206), reemplazar por:

```javascript
          maritalStatus: client.maritalStatus || '',
          residenceType: client.residenceType || '',
          livesWith: client.livesWith || '',
          healthEmergencyService: client.medicalInfo?.healthEmergencyService || '',
          healthProvider: client.medicalInfo?.healthProvider || '',
          healthNotes: client.medicalInfo?.healthNotes || '',
          medications: client.medications || [],
          medicationNotes: client.medicalInfo?.medicationNotes || '',
          medicalHistory: client.medicalHistory || [],
          historyNotes: client.medicalInfo?.historyNotes || '',
          diagnoses: client.diagnoses || [],
          educationLevel: client.medicalInfo?.educationLevel || '',
          occupation: client.medicalInfo?.occupation || '',
          significantInterests: client.medicalInfo?.significantInterests || '',
          significantBonds: client.medicalInfo?.significantBonds || '',
          musicTaste: client.medicalInfo?.musicTaste || '',
          favoriteFoods: client.medicalInfo?.favoriteFoods || '',
          character: client.medicalInfo?.character || '',
          personalResources: client.medicalInfo?.personalResources || '',
          vulnerabilities: client.medicalInfo?.vulnerabilities || '',
```

- [ ] **Step 3: Ajustar el payload de envío**

Donde arma el objeto para `createClient`/`updateClient` (línea ~358, `medicalInfo: {...}`), reemplazar el `medicalInfo` viejo y agregar personales + colecciones:

```javascript
        maritalStatus: formData.maritalStatus,
        residenceType: formData.residenceType,
        livesWith: formData.livesWith,
        medicalInfo: {
          healthEmergencyService: formData.healthEmergencyService,
          healthProvider: formData.healthProvider,
          healthNotes: formData.healthNotes,
          medicationNotes: formData.medicationNotes,
          historyNotes: formData.historyNotes,
          educationLevel: formData.educationLevel,
          occupation: formData.occupation,
          significantInterests: formData.significantInterests,
          significantBonds: formData.significantBonds,
          musicTaste: formData.musicTaste,
          favoriteFoods: formData.favoriteFoods,
          character: formData.character,
          personalResources: formData.personalResources,
          vulnerabilities: formData.vulnerabilities
        },
        medications: formData.medications,
        diagnoses: formData.diagnoses,
        medicalHistory: formData.medicalHistory,
```
> Mantener el resto del payload (nombre, plan, address, emergencyContacts, isCharity) sin cambios.

- [ ] **Step 4: Paso 1 — agregar campos personales**

En el render del Paso 1 (datos personales/contacto), agregar tres controles usando los componentes UI existentes y las constantes de Task 2 (importar `MARITAL_STATUS_OPTIONS`, `RESIDENCE_TYPE_OPTIONS`):

```jsx
<Select label="Estado civil" value={formData.maritalStatus} onChange={(e) => updateField('maritalStatus', e.target.value)}>
  <option value="">Seleccionar...</option>
  {MARITAL_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
</Select>
<Select label="Tipo de domicilio" value={formData.residenceType} onChange={(e) => updateField('residenceType', e.target.value)}>
  <option value="">Seleccionar...</option>
  {RESIDENCE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
</Select>
<Input label="Con quién vive" value={formData.livesWith} onChange={(e) => updateField('livesWith', e.target.value)} placeholder="Ej: Residencial Huertas" />
```
> Ubicarlos en una fila/grid coherente con el layout existente del Paso 1.

- [ ] **Step 5: Paso 3 — reescribir en 5 secciones**

Reemplazar TODO el contenido médico del Paso 3 (bloques "Restricciones" y "Condiciones", líneas ~956-1010 y lo que siga hasta el fin del paso) por 5 secciones. Importar `Textarea` (ya usado), `RepeatableRows`, y de `medicalConstants`: `DIAGNOSIS_TYPE_OPTIONS`, `MEDICAL_HISTORY_CONDITIONS`, `CHARACTER_OPTIONS`.

Estructura (cada sección con `<h3 className="text-lg font-medium text-gray-900 mb-4">`):

1. **Servicio de salud**: `Input` "Servicio de emergencia" (`healthEmergencyService`), `Input` "Prestador de salud" (`healthProvider`), `Textarea` "Notas generales" (`healthNotes`).
2. **Tratamiento farmacológico**:
   ```jsx
   <RepeatableRows
     value={formData.medications}
     onChange={(v) => updateField('medications', v)}
     addLabel="Agregar medicamento"
     emptyRow={{ name: '', schedule: '', dose: '', indicatedFor: '' }}
     fields={[
       { key: 'name', label: 'Nombre' },
       { key: 'schedule', label: 'Horario' },
       { key: 'dose', label: 'Dosis' },
       { key: 'indicatedFor', label: 'Indicado para' }
     ]}
   />
   ```
   + `Textarea` "Notas generales" (`medicationNotes`).
3. **Antecedentes**: lista de 17 checkboxes desde `MEDICAL_HISTORY_CONDITIONS`. Estado derivado de `formData.medicalHistory` (array de `{condition, comment}`). Al marcar, se agrega el objeto; al desmarcar, se quita; con comentario inline. Implementar con estos helpers dentro del componente:
   ```jsx
   const historyByCondition = Object.fromEntries((formData.medicalHistory || []).map(h => [h.condition, h]))
   const toggleCondition = (cond, checked) => {
     if (checked) updateField('medicalHistory', [...(formData.medicalHistory || []), { condition: cond, comment: '' }])
     else updateField('medicalHistory', (formData.medicalHistory || []).filter(h => h.condition !== cond))
   }
   const setConditionComment = (cond, comment) => {
     updateField('medicalHistory', (formData.medicalHistory || []).map(h => h.condition === cond ? { ...h, comment } : h))
   }
   ```
   Render:
   ```jsx
   <div className="space-y-2">
     {MEDICAL_HISTORY_CONDITIONS.map(c => {
       const active = Boolean(historyByCondition[c.value])
       return (
         <div key={c.value} className="flex flex-col gap-1 py-1">
           <Checkbox label={c.label} checked={active} onChange={(e) => toggleCondition(c.value, e.target.checked)} />
           {active && (
             <Input placeholder="Comentario (opcional)" value={historyByCondition[c.value].comment || ''} onChange={(e) => setConditionComment(c.value, e.target.value)} />
           )}
         </div>
       )
     })}
   </div>
   ```
   + `Textarea` "Notas generales" (`historyNotes`).
4. **Diagnóstico**:
   ```jsx
   <RepeatableRows
     value={formData.diagnoses}
     onChange={(v) => updateField('diagnoses', v)}
     addLabel="Agregar diagnóstico"
     emptyRow={{ diagnosisType: '', behaviorDisorder: '' }}
     fields={[
       { key: 'diagnosisType', label: 'Tipo', type: 'select', options: DIAGNOSIS_TYPE_OPTIONS },
       { key: 'behaviorDisorder', label: 'Tipo y trastorno de comportamiento' }
     ]}
   />
   ```
5. **Historia de vida**: `Input` "Nivel educativo" (`educationLevel`), `Input` "Trabajo / profesión" (`occupation`), `Textarea` "Intereses significativos (actuales y previos)" (`significantInterests`), `Textarea` "Vínculos significativos" (`significantBonds`), `Textarea` "Gustos musicales" (`musicTaste`), `Textarea` "Comidas favoritas" (`favoriteFoods`), `Select` "Carácter" (`character`, opciones `CHARACTER_OPTIONS` + opción vacía), `Textarea` "Recursos personales" (`personalResources`), `Textarea` "Vulnerabilidad, miedos o preocupaciones actuales" (`vulnerabilities`).

- [ ] **Step 6: Verificar alta y edición en la app** (ver Task 7 para arranque)

Crear un cliente nuevo llenando campos de cada sección; guardar; reabrir en edición y confirmar que todo persiste. Editar y confirmar update.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Clients/AddClient.jsx
git commit -m "feat(clients): wizard de alta con campos personales y 5 secciones medicas"
```

---

## Task 6: Detalle de cliente (`ClientDetail.jsx`)

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

Contexto: el tab "Información Médica" (view mode, líneas ~615-647) muestra hoy campos que dejan de existir (`dietaryRestrictions`, `medicalRestrictions`, `mobilityRestrictions`, `medication`, `medicationSchedule`, `notes`, flags). El tab "General"/"Contacto" no muestra los campos personales nuevos. La edición se hace navegando a `AddClient` en modo edición (`/clientes/:id/editar`) — **verificar** si `ClientDetail` tiene formulario de edición propio o si delega en `AddClient`. Si delega, Task 5 ya cubre la edición y acá solo cambia el **view mode**.

- [ ] **Step 1: Confirmar modelo de edición**

Buscar en `ClientDetail.jsx` cómo se edita (link a `/editar` vs formulario inline). Si hay edición inline con su propio estado, replicar los cambios de estado/payload de Task 5 aquí también. Si delega en `AddClient`, continuar solo con view mode.

Run: `grep -n "editar\|isEditing\|setIsEditing\|navigate" src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 2: Tab General — mostrar campos personales**

Agregar en el tab "general" (view mode) tres campos, usando `MARITAL_STATUS_OPTIONS`/`RESIDENCE_TYPE_OPTIONS` para traducir value→label:

```jsx
<div><p className="text-sm text-gray-500">Estado civil</p><p className="font-medium text-gray-900">{MARITAL_STATUS_OPTIONS.find(o => o.value === client.maritalStatus)?.label || '-'}</p></div>
<div><p className="text-sm text-gray-500">Tipo de domicilio</p><p className="font-medium text-gray-900">{RESIDENCE_TYPE_OPTIONS.find(o => o.value === client.residenceType)?.label || '-'}</p></div>
<div><p className="text-sm text-gray-500">Con quién vive</p><p className="font-medium text-gray-900">{client.livesWith || '-'}</p></div>
```

- [ ] **Step 3: Tab Médico — reescribir view mode en 5 secciones**

Reemplazar el contenido del bloque `activeTab === 'medical'` por 5 secciones de solo lectura. Importar de `medicalConstants`: `MEDICAL_HISTORY_CONDITIONS`, `DIAGNOSIS_TYPE_OPTIONS`, `CHARACTER_OPTIONS`.

Helper de label:
```jsx
const conditionLabel = (v) => MEDICAL_HISTORY_CONDITIONS.find(c => c.value === v)?.label || v
const diagnosisLabel = (v) => DIAGNOSIS_TYPE_OPTIONS.find(d => d.value === v)?.label || v
const characterLabel = (v) => CHARACTER_OPTIONS.find(c => c.value === v)?.label || (v || '-')
```

Render (usar `client.medicalInfo`, `client.medications`, `client.diagnoses`, `client.medicalHistory`):
1. **Servicio de salud**: emergencia (`healthEmergencyService`), prestador (`healthProvider`), notas (`healthNotes`).
2. **Tratamiento farmacológico**: lista de `client.medications` como filas ("Nombre — Horario — Dosis — Indicado para"); si vacío, "-". + notas (`medicationNotes`).
3. **Antecedentes**: chips/lista de `client.medicalHistory` con `conditionLabel(condition)` y, si hay, el `comment` entre paréntesis; si vacío, "-". + notas (`historyNotes`).
4. **Diagnóstico**: lista de `client.diagnoses` con `diagnosisLabel(diagnosisType)` y `behaviorDisorder`; si vacío, "-".
5. **Historia de vida**: los 9 campos con sus labels (los textarea como texto; carácter vía `characterLabel`). Mostrar "-" cuando estén vacíos.

> Seguir el estilo visual del view mode actual (`<div><p className="text-sm text-gray-500">Label</p><p className="font-medium text-gray-900">valor</p></div>` dentro de grids, y subtítulos con `<h4>`/`<h3>` por sección).

- [ ] **Step 4: Si hay edición inline (según Step 1), replicar estado y payload**

Aplicar los mismos cambios de `formData`/carga/payload de Task 5 Steps 1-3 al estado de edición de `ClientDetail`. Si delega en `AddClient`, omitir.

- [ ] **Step 5: Verificar en la app** (ver Task 7)

Abrir un cliente con datos migrados (que tenía flags/medicación) y confirmar que aparecen en Antecedentes/Tratamiento. Confirmar tab General.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(clients): detalle de cliente muestra campos personales y 5 secciones medicas"
```

---

## Task 7: Tailwind, verificación integral y limpieza

**Files:**
- Modify: `src/tailwind.output.css` (generado)

- [ ] **Step 1: Recompilar Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: sin error.

- [ ] **Step 2: Correr toda la suite de tests**

Run: `CI=true npx craco test --watchAll=false`
Expected: PASS (incluye los nuevos tests de Tasks 2 y 3).

- [ ] **Step 3: Arrancar la app y verificar flujo real**

Run: `npm start` (o usar la skill `run`).
Verificar como admin/superadmin:
1. Alta de cliente: llenar estado civil, domicilio, y al menos un ítem en cada sección médica (medicamento, antecedente con comentario, diagnóstico, historia de vida). Guardar.
2. Abrir el detalle: confirmar tab General (personales) y tab Médico (5 secciones con los datos).
3. Editar: cambiar/quitar un medicamento y un antecedente; vaciar un campo de texto (ej. prestador) y confirmar que se limpia al reabrir.
4. Abrir un cliente PRE-EXISTENTE (con datos migrados de flags/medicación): confirmar que sus antecedentes y medicación aparecen.
5. Como operador: confirmar que ve la info médica (no está gated por billing).

- [ ] **Step 4: Verificación de no-regresión de datos migrados (DB)**

`mcp__supabase__execute_sql`:
```sql
SELECT c.first_name, cf."medicalHistory" FROM clients_full cf JOIN clients c ON c.id=cf.id
WHERE jsonb_array_length(cf."medicalHistory") > 0 LIMIT 5;
```
Expected: clientes que antes tenían flags ahora muestran las condiciones correspondientes.

- [ ] **Step 5: Commit final**

```bash
git add src/tailwind.output.css
git commit -m "chore(clients): recompilar tailwind tras ampliacion de ficha"
```

---

## Notas de riesgo / gotchas

- **Overload accumulation**: la migración DROPea las firmas exactas actuales antes de recrear. Si `apply_migration` falla con "function is not unique", verificar firmas vivas con `SELECT pg_get_function_identity_arguments(oid)` y dropear la sobrante.
- **COALESCE en update**: para vaciar un campo de texto, el frontend debe mandar `''` (no `null`). El estado de formulario usa `''` para vacío → funciona. Los arrays (medications/diagnoses/medicalHistory) se mandan siempre en update → delete+reinsert (vaciar = enviar `[]`).
- **`clients_full` fidelidad**: la vista recreada preserva TODOS los campos actuales (biller, charity, deactivation, emergencyContacts agg). No quitar ninguno.
- **RLS**: la info médica es operativa (todos los roles autenticados la ven/editan), NO gated por `billing`.
- **Redundancia `livesWith` vs `significantBonds`**: intencional (aprobado en spec).
```
