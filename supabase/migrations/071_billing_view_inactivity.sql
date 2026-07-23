-- 071_billing_view_inactivity.sql
-- (a) calculate_month_billing: elige la versión de plan vigente para el mes objetivo
--     (068 había regresado esto a una fila arbitraria) y excluye días dentro de
--     cualquier período de inactividad.
-- (b) clients_full: expone inactivityPeriods y scheduledReactivationDate.

-- ── (a) calculate_month_billing ─────────────────────────────────────────────
-- Base: migración 068. Cambios marcados con CHANGED.
CREATE OR REPLACE FUNCTION calculate_month_billing(
  p_client_id UUID, p_year INTEGER, p_month INTEGER
) RETURNS JSONB AS $$
DECLARE
  v_client RECORD; v_plan RECORD; v_address RECORD;
  v_plan_price RECORD; v_transport_price RECORD;
  v_month_start DATE; v_month_end DATE; v_effective_start DATE; v_effective_end DATE;
  v_full_month_days INTEGER := 0; v_planned_days INTEGER := 0; v_vacation_days INTEGER := 0;
  v_recovery_days INTEGER := 0; v_chargeable_days INTEGER; v_days_per_month INTEGER; v_billed_days INTEGER;
  v_att_rate_net NUMERIC(12,2); v_att_rate_gross NUMERIC(12,2);
  v_att_charge_net NUMERIC(12,2) := 0; v_att_charge_gross NUMERIC(12,2) := 0;
  v_trans_rate_net NUMERIC(12,2) := 0; v_trans_rate_gross NUMERIC(12,2) := 0;
  v_trans_charge_net NUMERIC(12,2) := 0; v_trans_charge_gross NUMERIC(12,2) := 0;
  v_has_transport BOOLEAN := FALSE;
  v_day DATE; v_day_of_week INTEGER; v_day_name TEXT;
  v_proration_factor NUMERIC; v_discount NUMERIC := 0; v_discount_factor NUMERIC := 1;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client IS NULL THEN RETURN jsonb_build_object('error', 'Cliente no encontrado'); END IF;

  -- CHANGED: versión de plan vigente para el mes objetivo (antes tomaba una fila arbitraria)
  SELECT * INTO v_plan FROM client_plans
  WHERE client_id = p_client_id
    AND effective_from <= _month_start(p_year, p_month)
  ORDER BY effective_from DESC LIMIT 1;
  IF v_plan IS NULL THEN RETURN jsonb_build_object('error', 'Plan no encontrado'); END IF;

  SELECT price_net, price_gross INTO v_plan_price FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule
    AND (effective_year * 12 + effective_month) <= (p_year * 12 + p_month)
  ORDER BY (effective_year * 12 + effective_month) DESC LIMIT 1;
  IF v_plan_price IS NULL THEN RETURN jsonb_build_object('error', 'Precio de plan no encontrado'); END IF;
  v_att_rate_net := v_plan_price.price_net; v_att_rate_gross := v_plan_price.price_gross;

  IF v_plan.has_transport THEN
    SELECT * INTO v_address FROM client_addresses WHERE client_id = p_client_id;
    IF v_address IS NULL OR v_address.distance_range IS NULL THEN
      RETURN jsonb_build_object('error', 'Cliente con transporte requiere distancia definida');
    END IF;
    SELECT price_net, price_gross INTO v_transport_price FROM transport_pricing
    WHERE frequency = v_plan.frequency AND distance_range = v_address.distance_range
      AND (effective_year * 12 + effective_month) <= (p_year * 12 + p_month)
    ORDER BY (effective_year * 12 + effective_month) DESC LIMIT 1;
    IF v_transport_price IS NULL THEN RETURN jsonb_build_object('error', 'Precio de transporte no encontrado'); END IF;
    v_trans_rate_net := v_transport_price.price_net; v_trans_rate_gross := v_transport_price.price_gross;
    v_has_transport := TRUE;
  END IF;

  SELECT COALESCE(discount_percent, 0) INTO v_discount FROM monthly_invoices
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;
  v_discount := COALESCE(v_discount, 0);
  v_discount_factor := 1 - (v_discount / 100.0);

  v_month_start := _month_start(p_year, p_month);
  v_month_end := _month_end(p_year, p_month);
  v_effective_start := GREATEST(v_client.start_date, v_month_start);
  v_effective_end := LEAST(COALESCE(v_client.deactivation_date - 1, v_month_end), v_month_end);

  v_day := v_month_start;
  WHILE v_day <= v_month_end LOOP
    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
      WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' ELSE NULL END;

    IF v_day_name IS NOT NULL AND v_day_name = ANY(v_plan.assigned_days) THEN
      v_full_month_days := v_full_month_days + 1;
      -- CHANGED: excluye días dentro de cualquier período de inactividad [from, to)
      IF v_day >= v_effective_start AND v_day <= v_effective_end
         AND NOT EXISTS (
           SELECT 1 FROM client_inactivity_periods p
           WHERE p.client_id = p_client_id
             AND v_day >= p.from_date
             AND (p.to_date IS NULL OR v_day < p.to_date)
         ) THEN
        v_planned_days := v_planned_days + 1;
        IF EXISTS (
          SELECT 1 FROM attendance_records
          WHERE client_id = p_client_id AND date = v_day AND status = 'absent' AND is_chargeable = false
        ) THEN
          v_vacation_days := v_vacation_days + 1;
        END IF;
      END IF;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;

  SELECT COUNT(*) INTO v_recovery_days FROM attendance_records
  WHERE client_id = p_client_id AND date BETWEEN v_month_start AND v_month_end AND status = 'recovery';

  v_chargeable_days := v_planned_days - v_vacation_days;
  v_days_per_month := 4 * v_plan.frequency;
  v_billed_days := LEAST(GREATEST(v_chargeable_days, 0), v_days_per_month);

  IF v_days_per_month > 0 THEN
    v_proration_factor := v_billed_days::NUMERIC / v_days_per_month::NUMERIC;
    v_att_charge_gross := ROUND(v_proration_factor * v_att_rate_gross * v_discount_factor);
    v_att_charge_net := ROUND(v_proration_factor * v_att_rate_net * v_discount_factor);
    IF v_has_transport THEN
      v_trans_charge_gross := ROUND(v_proration_factor * v_trans_rate_gross);
      v_trans_charge_net := ROUND(v_proration_factor * v_trans_rate_net);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'fullMonthDays', v_full_month_days, 'plannedDays', v_planned_days,
    'vacationDays', v_vacation_days, 'recoveryDays', v_recovery_days,
    'daysPerMonth', v_days_per_month, 'chargeableDays', v_billed_days,
    'rawChargeableDays', v_chargeable_days, 'isProrated', v_billed_days < v_days_per_month,
    'effectiveEnd', v_effective_end, 'hasTransport', v_has_transport, 'discountPercent', v_discount,
    'attendanceMonthlyRateNet', v_att_rate_net, 'attendanceMonthlyRateGross', v_att_rate_gross,
    'attendanceChargeableNet', v_att_charge_net, 'attendanceChargeableGross', v_att_charge_gross,
    'transportMonthlyRateNet', v_trans_rate_net, 'transportMonthlyRateGross', v_trans_rate_gross,
    'transportChargeableNet', v_trans_charge_net, 'transportChargeableGross', v_trans_charge_gross,
    'totalChargeableGross', v_att_charge_gross + v_trans_charge_gross,
    'totalMonthlyRateGross', v_att_rate_gross + v_trans_rate_gross,
    'monthlyRate', v_att_rate_gross, 'chargeableAmount', v_att_charge_gross + v_trans_charge_gross
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── (b) clients_full: + inactivityPeriods + scheduledReactivationDate ───────
-- Base: migración 050 (transcrita verbatim), se agregan 2 columnas al final.
CREATE OR REPLACE VIEW clients_full AS
 SELECT c.id,
    c.first_name AS "firstName", c.last_name AS "lastName", c.email, c.phone,
    c.birth_date AS "birthDate", c.cognitive_level AS "cognitiveLevel", c.start_date AS "startDate",
    c.document_type AS "documentType", c.document_number AS "documentNumber",
    c.marital_status AS "maritalStatus", c.residence_type AS "residenceType", c.lives_with AS "livesWith",
    c.biller_client_id AS "billerClientId", c.biller_branch_id AS "billerBranchId",
    c.biller_synced_at AS "billerSyncedAt", c.biller_sync_error AS "billerSyncError",
    ( SELECT count(*)::integer FROM recovery_credits rc
       WHERE rc.client_id = c.id AND rc.status = 'available'::text AND rc.expires_at >= CURRENT_DATE) AS "recoveryDaysAvailable",
    c.avatar_url AS "avatarUrl", c.deleted_at AS "deletedAt",
    c.deactivation_reason AS "deactivationReason", c.deactivation_notes AS "deactivationNotes",
    c.created_at AS "createdAt",
    CASE WHEN cp.id IS NOT NULL THEN jsonb_build_object('frequency', cp.frequency, 'schedule', cp.schedule, 'hasTransport', cp.has_transport, 'assignedDays', cp.assigned_days) ELSE NULL::jsonb END AS plan,
    CASE WHEN ec.id IS NOT NULL THEN jsonb_build_object('name', ec.name, 'relationship', ec.relationship, 'phone', ec.phone) ELSE NULL::jsonb END AS "emergencyContact",
    CASE WHEN ca.id IS NOT NULL THEN jsonb_build_object('street', ca.street, 'accessNotes', ca.access_notes, 'doorbell', ca.doorbell, 'concierge', ca.concierge, 'latitude', ca.latitude, 'longitude', ca.longitude, 'distanceRange', ca.distance_range) ELSE NULL::jsonb END AS address,
    CASE WHEN mi.id IS NOT NULL THEN jsonb_build_object('healthEmergencyService', mi.health_emergency_service, 'healthProvider', mi.health_provider, 'healthNotes', mi.health_notes, 'medicationNotes', mi.medication_notes, 'historyNotes', mi.history_notes, 'educationLevel', mi.education_level, 'occupation', mi.occupation, 'significantInterests', mi.significant_interests, 'significantBonds', mi.significant_bonds, 'musicTaste', mi.music_taste, 'favoriteFoods', mi.favorite_foods, 'character', mi.personality_type, 'personalResources', mi.personal_resources, 'vulnerabilities', mi.vulnerabilities) ELSE NULL::jsonb END AS "medicalInfo",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', m.name, 'schedule', m.schedule, 'dose', m.dose, 'indicatedFor', m.indicated_for) ORDER BY m."position", m.created_at) FROM client_medications m WHERE m.client_id = c.id), '[]'::jsonb) AS medications,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('diagnosisType', d.diagnosis_type, 'behaviorDisorder', d.behavior_disorder) ORDER BY d."position", d.created_at) FROM client_diagnoses d WHERE d.client_id = c.id), '[]'::jsonb) AS diagnoses,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('condition', h.condition, 'comment', h.comment) ORDER BY h.created_at) FROM client_medical_history h WHERE h.client_id = c.id), '[]'::jsonb) AS "medicalHistory",
    c.transfer_responsible AS "transferResponsible",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', ec2.name, 'relationship', ec2.relationship, 'phone', ec2.phone) ORDER BY ec2."position", ec2.created_at) FROM emergency_contacts ec2 WHERE ec2.client_id = c.id), '[]'::jsonb) AS "emergencyContacts",
    c.deactivation_date AS "deactivationDate",
    c.client_type AS "clientType",
    EXISTS ( SELECT 1 FROM monthly_invoices minv WHERE minv.client_id = c.id AND minv.discount_percent > 0 AND minv.year = EXTRACT(YEAR FROM CURRENT_DATE)::int AND minv.month = (EXTRACT(MONTH FROM CURRENT_DATE)::int - 1)) AS "hasActiveDiscount",
    -- NEW: períodos de inactividad (para calendario / billing preview)
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('fromDate', p.from_date, 'toDate', p.to_date) ORDER BY p.from_date) FROM client_inactivity_periods p WHERE p.client_id = c.id), '[]'::jsonb) AS "inactivityPeriods",
    -- NEW: reintegro programado a futuro (máximo to_date > hoy)
    ( SELECT max(p.to_date) FROM client_inactivity_periods p WHERE p.client_id = c.id AND p.to_date > CURRENT_DATE) AS "scheduledReactivationDate"
   FROM clients c
     LEFT JOIN LATERAL ( SELECT cp2.id, cp2.frequency, cp2.schedule, cp2.has_transport, cp2.assigned_days
           FROM client_plans cp2 WHERE cp2.client_id = c.id AND cp2.effective_from <= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date
          ORDER BY cp2.effective_from DESC LIMIT 1) cp ON true
     LEFT JOIN LATERAL ( SELECT ec1.id, ec1.name, ec1.relationship, ec1.phone
           FROM emergency_contacts ec1 WHERE ec1.client_id = c.id ORDER BY ec1."position", ec1.created_at LIMIT 1) ec ON true
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

ALTER VIEW clients_full SET (security_invoker = on);
