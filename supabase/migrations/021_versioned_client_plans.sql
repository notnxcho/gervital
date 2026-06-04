-- 021_versioned_client_plans.sql
-- Plan del cliente versionado por vigencia mensual (no retroactivo).
-- client_plans pasa de 1 fila/cliente a 1 fila/período de vigencia.

-- ── Schema ──────────────────────────────────────────────────────────────────
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS effective_from date;
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS distance_range text;
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS created_by text;

-- Backfill: versión 1 = 1° del mes de ingreso; distancia desde la dirección actual.
UPDATE client_plans cp
SET effective_from = date_trunc('month', c.start_date)::date
FROM clients c
WHERE cp.client_id = c.id AND cp.effective_from IS NULL;

UPDATE client_plans cp
SET distance_range = a.distance_range
FROM client_addresses a
WHERE cp.client_id = a.client_id AND cp.distance_range IS NULL;

ALTER TABLE client_plans ALTER COLUMN effective_from SET NOT NULL;

-- Reemplazar UNIQUE(client_id) por UNIQUE(client_id, effective_from).
-- Acotado a la constraint que sea exactamente UNIQUE (client_id) (cualquier nombre),
-- para no barrer otras constraints en re-aplicaciones del archivo.
DO $$
DECLARE v_con text;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'client_plans'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (client_id)'
  LOOP
    EXECUTE format('ALTER TABLE client_plans DROP CONSTRAINT %I', v_con);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'client_plans'::regclass
      AND conname = 'client_plans_client_effective_uniq'
  ) THEN
    ALTER TABLE client_plans
      ADD CONSTRAINT client_plans_client_effective_uniq UNIQUE (client_id, effective_from);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_plans_client_effective
  ON client_plans (client_id, effective_from DESC);

-- ── set_client_plan_version ───────────────────────────────────────────────────
-- Crea o actualiza la versión de plan vigente desde el mes de p_effective_from.
CREATE OR REPLACE FUNCTION public.set_client_plan_version(
  p_client_id uuid,
  p_effective_from date,
  p_frequency integer,
  p_schedule text,
  p_has_transport boolean,
  p_assigned_days text[],
  p_distance_range text DEFAULT NULL,
  p_created_by text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO client_plans (
    client_id, effective_from, frequency, schedule,
    has_transport, assigned_days, distance_range, created_by
  ) VALUES (
    p_client_id, date_trunc('month', p_effective_from)::date, p_frequency, p_schedule,
    COALESCE(p_has_transport, FALSE), COALESCE(p_assigned_days, '{}'), p_distance_range, p_created_by
  )
  ON CONFLICT (client_id, effective_from) DO UPDATE SET
    frequency     = EXCLUDED.frequency,
    schedule      = EXCLUDED.schedule,
    has_transport = EXCLUDED.has_transport,
    assigned_days = EXCLUDED.assigned_days,
    distance_range = EXCLUDED.distance_range,
    updated_at    = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- ── calculate_month_billing (version-aware) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_month_billing(p_client_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_client RECORD;
  v_plan RECORD;
  v_plan_price RECORD;
  v_transport_price RECORD;
  v_month_start DATE;
  v_month_end DATE;
  v_effective_start DATE;
  v_full_month_days INTEGER := 0;
  v_planned_days INTEGER := 0;
  v_vacation_days INTEGER := 0;
  v_recovery_days INTEGER := 0;
  v_chargeable_days INTEGER;
  v_att_rate_net NUMERIC(12,2);
  v_att_rate_gross NUMERIC(12,2);
  v_att_charge_net NUMERIC(12,2) := 0;
  v_att_charge_gross NUMERIC(12,2) := 0;
  v_trans_rate_net NUMERIC(12,2) := 0;
  v_trans_rate_gross NUMERIC(12,2) := 0;
  v_trans_charge_net NUMERIC(12,2) := 0;
  v_trans_charge_gross NUMERIC(12,2) := 0;
  v_has_transport BOOLEAN := FALSE;
  v_day DATE;
  v_day_of_week INTEGER;
  v_day_name TEXT;
  v_proration_factor NUMERIC;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'Cliente no encontrado');
  END IF;

  -- Resolver la versión del plan vigente para el mes objetivo.
  SELECT * INTO v_plan
  FROM client_plans
  WHERE client_id = p_client_id
    AND effective_from <= make_date(p_year, p_month + 1, 1)
  ORDER BY effective_from DESC
  LIMIT 1;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Plan no encontrado');
  END IF;

  SELECT price_net, price_gross INTO v_plan_price
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule;
  IF v_plan_price IS NULL THEN
    RETURN jsonb_build_object('error', 'Precio de plan no encontrado');
  END IF;
  v_att_rate_net := v_plan_price.price_net;
  v_att_rate_gross := v_plan_price.price_gross;

  IF v_plan.has_transport THEN
    IF v_plan.distance_range IS NULL THEN
      RETURN jsonb_build_object('error', 'Cliente con transporte requiere distancia definida');
    END IF;

    SELECT price_net, price_gross INTO v_transport_price
    FROM transport_pricing
    WHERE frequency = v_plan.frequency AND distance_range = v_plan.distance_range;
    IF v_transport_price IS NULL THEN
      RETURN jsonb_build_object('error', 'Precio de transporte no encontrado');
    END IF;

    v_trans_rate_net := v_transport_price.price_net;
    v_trans_rate_gross := v_transport_price.price_gross;
    v_has_transport := TRUE;
  END IF;

  v_month_start := _month_start(p_year, p_month);
  v_month_end := _month_end(p_year, p_month);
  v_effective_start := GREATEST(v_client.start_date, v_month_start);

  v_day := v_month_start;
  WHILE v_day <= v_month_end LOOP
    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday'
      WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
      WHEN 5 THEN 'friday' ELSE NULL
    END;

    IF v_day_name IS NOT NULL AND v_day_name = ANY(v_plan.assigned_days) THEN
      v_full_month_days := v_full_month_days + 1;
      IF v_day >= v_effective_start THEN
        v_planned_days := v_planned_days + 1;
        IF EXISTS (
          SELECT 1 FROM attendance_records
          WHERE client_id = p_client_id AND date = v_day AND status = 'vacation'
        ) THEN
          v_vacation_days := v_vacation_days + 1;
        END IF;
      END IF;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;

  SELECT COUNT(*) INTO v_recovery_days
  FROM attendance_records
  WHERE client_id = p_client_id
    AND date BETWEEN v_month_start AND v_month_end
    AND status = 'recovery';

  v_chargeable_days := v_planned_days - v_vacation_days;

  IF v_full_month_days > 0 THEN
    v_proration_factor := v_chargeable_days::NUMERIC / v_full_month_days::NUMERIC;
    v_att_charge_gross := ROUND(v_proration_factor * v_att_rate_gross);
    v_att_charge_net := ROUND(v_proration_factor * v_att_rate_net);
    IF v_has_transport THEN
      v_trans_charge_gross := ROUND(v_proration_factor * v_trans_rate_gross);
      v_trans_charge_net := ROUND(v_proration_factor * v_trans_rate_net);
    END IF;
  ELSE
    v_att_charge_gross := 0;
    v_att_charge_net := 0;
  END IF;

  RETURN jsonb_build_object(
    'fullMonthDays', v_full_month_days,
    'plannedDays', v_planned_days,
    'vacationDays', v_vacation_days,
    'recoveryDays', v_recovery_days,
    'chargeableDays', v_chargeable_days,
    'isProrated', v_effective_start > v_month_start,
    'hasTransport', v_has_transport,
    'attendanceMonthlyRateNet', v_att_rate_net,
    'attendanceMonthlyRateGross', v_att_rate_gross,
    'attendanceChargeableNet', v_att_charge_net,
    'attendanceChargeableGross', v_att_charge_gross,
    'transportMonthlyRateNet', v_trans_rate_net,
    'transportMonthlyRateGross', v_trans_rate_gross,
    'transportChargeableNet', v_trans_charge_net,
    'transportChargeableGross', v_trans_charge_gross,
    'totalChargeableGross', v_att_charge_gross + v_trans_charge_gross,
    'totalMonthlyRateGross', v_att_rate_gross + v_trans_rate_gross,
    'monthlyRate', v_att_rate_gross,
    'chargeableAmount', v_att_charge_gross + v_trans_charge_gross
  );
END;
$function$;

-- ── clients_full (current plan version) ──────────────────────────────────────
CREATE OR REPLACE VIEW public.clients_full
WITH (security_invoker = true) AS
 SELECT c.id,
    c.first_name AS "firstName",
    c.last_name AS "lastName",
    c.email,
    c.phone,
    c.birth_date AS "birthDate",
    c.cognitive_level AS "cognitiveLevel",
    c.start_date AS "startDate",
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
            WHEN mi.id IS NOT NULL THEN jsonb_build_object('dietaryRestrictions', mi.dietary_restrictions, 'medicalRestrictions', mi.medical_restrictions, 'mobilityRestrictions', mi.mobility_restrictions, 'medication', mi.medication, 'medicationSchedule', mi.medication_schedule, 'notes', mi.notes, 'isDiabetic', mi.is_diabetic, 'isCeliac', mi.is_celiac, 'isHypertensive', mi.is_hypertensive)
            ELSE NULL::jsonb
        END AS "medicalInfo"
   FROM clients c
     LEFT JOIN LATERAL (
       SELECT cp2.id, cp2.frequency, cp2.schedule, cp2.has_transport, cp2.assigned_days
       FROM client_plans cp2
       WHERE cp2.client_id = c.id
         AND cp2.effective_from <= date_trunc('month', CURRENT_DATE)::date
       ORDER BY cp2.effective_from DESC
       LIMIT 1
     ) cp ON true
     LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;
