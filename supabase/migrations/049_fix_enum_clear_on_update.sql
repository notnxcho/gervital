-- ════════════════════════════════════════════════════════════════════════════
-- 049_fix_enum_clear_on_update.sql
-- Fix: limpiar un enum al editar cliente rompia el guardado.
-- Las columnas con CHECK "x IS NULL OR x IN (...)" (clients.marital_status,
-- clients.residence_type, medical_info.personality_type via p_character) se
-- asignaban con COALESCE(p_x, existing). Cuando el front manda '' (usuario elige
-- "Seleccionar…"), COALESCE guardaba '' -> viola el CHECK -> aborta todo el RPC.
-- Semantica correcta: NULL = no tocar; '' = limpiar a NULL; valor = setear.
-- Se recrea update_client_full VERBATIM sobre la definicion viva (post 048_client_type,
-- firma termina en p_client_type text) cambiando SOLO esas tres asignaciones.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_client_full(
  p_client_id uuid,
  p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text,
  p_birth_date date DEFAULT NULL::date, p_cognitive_level text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date,
  p_document_type text DEFAULT NULL::text, p_document_number text DEFAULT NULL::text,
  p_marital_status text DEFAULT NULL::text, p_residence_type text DEFAULT NULL::text, p_lives_with text DEFAULT NULL::text,
  p_plan_frequency integer DEFAULT NULL::integer, p_plan_schedule text DEFAULT NULL::text,
  p_plan_has_transport boolean DEFAULT NULL::boolean, p_plan_assigned_days text[] DEFAULT NULL::text[],
  p_emergency_contacts jsonb DEFAULT NULL::jsonb, p_transfer_responsible text DEFAULT NULL::text,
  p_addr_street text DEFAULT NULL::text, p_addr_access_notes text DEFAULT NULL::text, p_addr_doorbell text DEFAULT NULL::text,
  p_addr_concierge text DEFAULT NULL::text, p_addr_distance_range text DEFAULT NULL::text,
  p_health_emergency_service text DEFAULT NULL::text, p_health_provider text DEFAULT NULL::text, p_health_notes text DEFAULT NULL::text,
  p_medication_notes text DEFAULT NULL::text, p_history_notes text DEFAULT NULL::text,
  p_education_level text DEFAULT NULL::text, p_occupation text DEFAULT NULL::text, p_significant_interests text DEFAULT NULL::text,
  p_significant_bonds text DEFAULT NULL::text, p_music_taste text DEFAULT NULL::text, p_favorite_foods text DEFAULT NULL::text,
  p_character text DEFAULT NULL::text, p_personal_resources text DEFAULT NULL::text, p_vulnerabilities text DEFAULT NULL::text,
  p_medications jsonb DEFAULT NULL::jsonb, p_diagnoses jsonb DEFAULT NULL::jsonb, p_medical_history jsonb DEFAULT NULL::jsonb,
  p_client_type text DEFAULT NULL::text)
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
    marital_status = CASE WHEN p_marital_status IS NULL THEN marital_status WHEN p_marital_status = '' THEN NULL ELSE p_marital_status END,
    residence_type = CASE WHEN p_residence_type IS NULL THEN residence_type WHEN p_residence_type = '' THEN NULL ELSE p_residence_type END,
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

  INSERT INTO medical_info (client_id, health_emergency_service, health_provider, health_notes, medication_notes, history_notes, education_level, occupation, significant_interests, significant_bonds, music_taste, favorite_foods, personality_type, personal_resources, vulnerabilities)
  VALUES (p_client_id, p_health_emergency_service, p_health_provider, p_health_notes, p_medication_notes, p_history_notes, p_education_level, p_occupation, p_significant_interests, p_significant_bonds, p_music_taste, p_favorite_foods, NULLIF(p_character, ''), p_personal_resources, p_vulnerabilities)
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
    personality_type = CASE WHEN p_character IS NULL THEN medical_info.personality_type WHEN p_character = '' THEN NULL ELSE p_character END,
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
