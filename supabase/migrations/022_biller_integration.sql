-- 022_biller_integration.sql
-- Integración con Biller (eFactura Uruguay): datos fiscales del cliente,
-- mapeo de receptor, y resultado de emisión por comprobante.

-- ── clients: datos fiscales + mapeo Biller ───────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'ci'
    CHECK (document_type IN ('ci', 'rut', 'dni', 'pasaporte', 'otro')),
  ADD COLUMN IF NOT EXISTS document_number TEXT,
  ADD COLUMN IF NOT EXISTS biller_client_id BIGINT,
  ADD COLUMN IF NOT EXISTS biller_branch_id BIGINT,
  ADD COLUMN IF NOT EXISTS biller_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS biller_sync_error TEXT;

-- ── monthly_invoices: resultado de emisión ───────────────────────────────────
ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS biller_id BIGINT,
  ADD COLUMN IF NOT EXISTS biller_serie TEXT,
  ADD COLUMN IF NOT EXISTS biller_numero TEXT,
  ADD COLUMN IF NOT EXISTS biller_hash TEXT,
  ADD COLUMN IF NOT EXISTS dgi_status TEXT
    CHECK (dgi_status IN ('pending_dgi', 'accepted', 'rejected')),
  ADD COLUMN IF NOT EXISTS dgi_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS emit_error TEXT;

-- Idempotencia/upsert por cliente-mes (defensivo: ensure_client_months ya asume unicidad).
CREATE UNIQUE INDEX IF NOT EXISTS monthly_invoices_client_year_month_uniq
  ON monthly_invoices (client_id, year, month);

-- ── RPC: persistir emisión exitosa (upsert) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_invoice_emitted(
  p_client_id uuid, p_year integer, p_month integer,
  p_biller_id bigint, p_serie text, p_numero text, p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  INSERT INTO monthly_invoices (
    client_id, year, month, invoice_status, invoiced_at, invoice_number,
    biller_id, biller_serie, biller_numero, biller_hash, dgi_status, emit_error, updated_at
  ) VALUES (
    p_client_id, p_year, p_month, 'invoiced', NOW(), p_serie || '-' || p_numero,
    p_biller_id, p_serie, p_numero, p_hash, 'pending_dgi', NULL, NOW()
  )
  ON CONFLICT (client_id, year, month) DO UPDATE SET
    invoice_status = 'invoiced', invoiced_at = NOW(),
    invoice_number = EXCLUDED.invoice_number, biller_id = EXCLUDED.biller_id,
    biller_serie = EXCLUDED.biller_serie, biller_numero = EXCLUDED.biller_numero,
    biller_hash = EXCLUDED.biller_hash, dgi_status = 'pending_dgi',
    emit_error = NULL, updated_at = NOW();
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── RPC: persistir error de emisión ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_invoice_emit_error(
  p_client_id uuid, p_year integer, p_month integer, p_error text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  INSERT INTO monthly_invoices (client_id, year, month, emit_error, updated_at)
  VALUES (p_client_id, p_year, p_month, p_error, NOW())
  ON CONFLICT (client_id, year, month) DO UPDATE SET
    emit_error = EXCLUDED.emit_error, updated_at = NOW();
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── RPC: anular (revertir a pending) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_invoice_voided(
  p_client_id uuid, p_year integer, p_month integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE monthly_invoices SET
    invoice_status = 'pending', invoiced_at = NULL, invoice_number = NULL,
    biller_id = NULL, biller_serie = NULL, biller_numero = NULL, biller_hash = NULL,
    dgi_status = NULL, dgi_checked_at = NULL, updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── RPC: actualizar estado DGI ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_invoice_dgi_status(
  p_client_id uuid, p_year integer, p_month integer, p_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE monthly_invoices SET dgi_status = p_status, dgi_checked_at = NOW(), updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── RPC: guardar mapeo de receptor Biller ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_client_biller_sync(
  p_client_id uuid, p_biller_client_id bigint, p_biller_branch_id bigint, p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE clients SET
    biller_client_id = COALESCE(p_biller_client_id, biller_client_id),
    biller_branch_id = COALESCE(p_biller_branch_id, biller_branch_id),
    biller_synced_at = CASE WHEN p_error IS NULL THEN NOW() ELSE biller_synced_at END,
    biller_sync_error = p_error,
    updated_at = NOW()
  WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── Recrear create_client_full / update_client_full con documento ─────────────
DROP FUNCTION IF EXISTS public.create_client_full(text, text, text, text, date, text, date, integer, text, boolean, text[], text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.update_client_full(uuid, text, text, text, text, date, text, date, integer, text, boolean, text[], text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean, boolean);

CREATE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT false,
  p_plan_assigned_days text[] DEFAULT '{}', p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_med_dietary text DEFAULT NULL, p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL,
  p_med_medication text DEFAULT NULL, p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL,
  p_med_is_diabetic boolean DEFAULT false, p_med_is_celiac boolean DEFAULT false, p_med_is_hypertensive boolean DEFAULT false,
  p_document_type text DEFAULT 'ci', p_document_number text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date, document_type, document_number)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date, COALESCE(p_document_type,'ci'), p_document_number)
  RETURNING id INTO v_client_id;
  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, effective_from, frequency, schedule, has_transport, assigned_days, distance_range)
    VALUES (v_client_id, date_trunc('month', p_start_date)::date, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days, p_addr_distance_range);
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

CREATE FUNCTION public.update_client_full(
  p_client_id uuid, p_first_name text DEFAULT NULL, p_last_name text DEFAULT NULL, p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT NULL,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT NULL,
  p_plan_assigned_days text[] DEFAULT NULL, p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_med_dietary text DEFAULT NULL, p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL,
  p_med_medication text DEFAULT NULL, p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL,
  p_med_is_diabetic boolean DEFAULT NULL, p_med_is_celiac boolean DEFAULT NULL, p_med_is_hypertensive boolean DEFAULT NULL,
  p_document_type text DEFAULT NULL, p_document_number text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $function$
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
    updated_at = NOW()
  WHERE id = p_client_id;

  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (p_client_id, p_ec_name, p_ec_relationship, p_ec_phone)
    ON CONFLICT (client_id) DO UPDATE SET name = EXCLUDED.name, relationship = EXCLUDED.relationship, phone = EXCLUDED.phone, updated_at = NOW();
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
     OR p_med_is_diabetic IS NOT NULL OR p_med_is_celiac IS NOT NULL OR p_med_is_hypertensive IS NOT NULL THEN
    INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive)
    VALUES (p_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, COALESCE(p_med_is_diabetic,FALSE), COALESCE(p_med_is_celiac,FALSE), COALESCE(p_med_is_hypertensive,FALSE))
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
$function$;

-- ── clients_full: exponer documento + estado Biller ──────────────────────────
-- DROP requerido: las columnas nuevas se insertan antes de columnas existentes,
-- y CREATE OR REPLACE VIEW no permite reordenar/insertar columnas (solo append).
DROP VIEW IF EXISTS public.clients_full;
CREATE OR REPLACE VIEW public.clients_full WITH (security_invoker = true) AS
 SELECT c.id, c.first_name AS "firstName", c.last_name AS "lastName", c.email, c.phone,
    c.birth_date AS "birthDate", c.cognitive_level AS "cognitiveLevel", c.start_date AS "startDate",
    c.document_type AS "documentType", c.document_number AS "documentNumber",
    c.biller_client_id AS "billerClientId", c.biller_branch_id AS "billerBranchId",
    c.biller_synced_at AS "billerSyncedAt", c.biller_sync_error AS "billerSyncError",
    ( SELECT count(*)::integer FROM recovery_credits rc
        WHERE rc.client_id = c.id AND rc.status = 'available' AND rc.expires_at >= CURRENT_DATE) AS "recoveryDaysAvailable",
    c.avatar_url AS "avatarUrl", c.deleted_at AS "deletedAt",
    c.deactivation_reason AS "deactivationReason", c.deactivation_notes AS "deactivationNotes",
    c.created_at AS "createdAt",
    CASE WHEN cp.id IS NOT NULL THEN jsonb_build_object('frequency', cp.frequency, 'schedule', cp.schedule, 'hasTransport', cp.has_transport, 'assignedDays', cp.assigned_days) ELSE NULL::jsonb END AS plan,
    CASE WHEN ec.id IS NOT NULL THEN jsonb_build_object('name', ec.name, 'relationship', ec.relationship, 'phone', ec.phone) ELSE NULL::jsonb END AS "emergencyContact",
    CASE WHEN ca.id IS NOT NULL THEN jsonb_build_object('street', ca.street, 'accessNotes', ca.access_notes, 'doorbell', ca.doorbell, 'concierge', ca.concierge, 'latitude', ca.latitude, 'longitude', ca.longitude, 'distanceRange', ca.distance_range) ELSE NULL::jsonb END AS address,
    CASE WHEN mi.id IS NOT NULL THEN jsonb_build_object('dietaryRestrictions', mi.dietary_restrictions, 'medicalRestrictions', mi.medical_restrictions, 'mobilityRestrictions', mi.mobility_restrictions, 'medication', mi.medication, 'medicationSchedule', mi.medication_schedule, 'notes', mi.notes, 'isDiabetic', mi.is_diabetic, 'isCeliac', mi.is_celiac, 'isHypertensive', mi.is_hypertensive) ELSE NULL::jsonb END AS "medicalInfo"
   FROM clients c
     LEFT JOIN LATERAL (
       SELECT cp2.id, cp2.frequency, cp2.schedule, cp2.has_transport, cp2.assigned_days
       FROM client_plans cp2 WHERE cp2.client_id = c.id AND cp2.effective_from <= date_trunc('month', CURRENT_DATE)::date
       ORDER BY cp2.effective_from DESC LIMIT 1
     ) cp ON true
     LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- ── invoices_view: exponer campos Biller/DGI ─────────────────────────────────
DROP VIEW IF EXISTS invoices_view;
CREATE VIEW invoices_view AS
SELECT mi.id, mi.client_id AS "clientId", mi.year, mi.month,
  mi.planned_days AS "plannedDays", mi.chargeable_days AS "chargeableDays",
  mi.chargeable_amount AS "chargeableAmount", mi.monthly_rate AS "monthlyRate",
  mi.attendance_monthly_rate_net AS "attendanceMonthlyRateNet", mi.attendance_monthly_rate_gross AS "attendanceMonthlyRateGross",
  mi.attendance_chargeable_net AS "attendanceChargeableNet", mi.attendance_chargeable_gross AS "attendanceChargeableGross",
  mi.transport_monthly_rate_net AS "transportMonthlyRateNet", mi.transport_monthly_rate_gross AS "transportMonthlyRateGross",
  mi.transport_chargeable_net AS "transportChargeableNet", mi.transport_chargeable_gross AS "transportChargeableGross",
  mi.is_amount_overridden AS "isAmountOverridden", mi.original_chargeable_amount AS "originalChargeableAmount",
  mi.invoice_status AS "invoiceStatus", mi.invoiced_at AS "invoicedAt",
  mi.invoice_number AS "invoiceNumber", mi.invoice_url AS "invoiceUrl",
  mi.biller_id AS "billerId", mi.biller_serie AS "billerSerie", mi.biller_numero AS "billerNumero",
  mi.biller_hash AS "billerHash", mi.dgi_status AS "dgiStatus", mi.dgi_checked_at AS "dgiCheckedAt",
  mi.emit_error AS "emitError",
  mi.payment_status AS "paymentStatus", mi.paid_at AS "paidAt", mi.paid_date AS "paidDate",
  mi.paid_amount AS "paidAmount", mi.payment_method AS "paymentMethod", mi.payment_notes AS "paymentNotes",
  mi.created_at AS "createdAt", mi.updated_at AS "updatedAt"
FROM monthly_invoices mi;
ALTER VIEW invoices_view SET (security_invoker = on);
