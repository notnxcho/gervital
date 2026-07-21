-- 068_unified_absence_model.sql
-- Modelo unificado de faltas: toda falta es 'absent', descrita por
-- is_justified + is_chargeable. Recupero sii (justificada AND cobrable).
-- Se elimina el status legacy 'vacation'.
--   is_chargeable = NOT (justificada AND futuro AND mes NO pago)
--   futuro = fecha > CURRENT_DATE (hoy/pasado NO son futuro)

-- ── 1. Columna is_chargeable ───────────────────────────────────────────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS is_chargeable BOOLEAN NOT NULL DEFAULT true;

-- ── 2. Backfill: 'vacation' → 'absent' justificada NO cobrable ─────────────
-- (preserva notes; NO toca recovery_credits: los créditos históricos siguen vivos)
UPDATE attendance_records
SET status = 'absent', is_justified = true, is_chargeable = false, updated_at = NOW()
WHERE status = 'vacation';

-- ── 3. CHECK sin 'vacation' ────────────────────────────────────────────────
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;
ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('scheduled', 'attended', 'absent', 'recovery'));

-- ── 4. attendance_view expone isChargeable ────────────────────────────────
-- (DROP + CREATE en vez de CREATE OR REPLACE: se inserta una columna en medio
--  de la lista existente, y Postgres no permite reordenar columnas con REPLACE.
--  Sin dependientes registrados sobre la vista, DROP es seguro.)
DROP VIEW IF EXISTS attendance_view;
CREATE VIEW attendance_view AS
SELECT
  ar.id,
  ar.client_id AS "clientId",
  ar.date::TEXT AS date,
  ar.shift,
  ar.status,
  ar.is_justified AS "isJustified",
  ar.is_chargeable AS "isChargeable",
  ar.notes,
  ar.created_at AS "createdAt",
  ar.updated_at AS "updatedAt"
FROM attendance_records ar;

-- ── 5. register_absence — única fuente de verdad ───────────────────────────
CREATE OR REPLACE FUNCTION public.register_absence(
  p_client_id uuid,
  p_date date,
  p_is_justified boolean DEFAULT false,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
  v_year INTEGER; v_month INTEGER; v_month_paid BOOLEAN;
  v_is_future BOOLEAN; v_is_chargeable BOOLEAN; v_grants_credit BOOLEAN;
  v_clean_notes TEXT;
BEGIN
  v_clean_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1;
  SELECT (payment_status = 'paid') INTO v_month_paid FROM monthly_invoices
  WHERE client_id = p_client_id AND year = v_year AND month = v_month;
  v_month_paid := COALESCE(v_month_paid, false);

  v_is_future := p_date > CURRENT_DATE;
  v_is_chargeable := NOT (p_is_justified AND v_is_future AND NOT v_month_paid);
  v_grants_credit := p_is_justified AND v_is_chargeable;

  INSERT INTO attendance_records (client_id, date, status, is_justified, is_chargeable, notes)
  VALUES (p_client_id, p_date, 'absent', p_is_justified, v_is_chargeable, v_clean_notes)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'absent',
    is_justified = EXCLUDED.is_justified,
    is_chargeable = EXCLUDED.is_chargeable,
    notes = EXCLUDED.notes,
    updated_at = NOW()
  RETURNING id INTO v_record_id;

  -- Re-marca idempotente: revoca cualquier crédito vivo previo de este registro
  DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';

  IF v_grants_credit THEN
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, note, grant_attendance_id, created_by_name)
    VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_clean_notes, v_record_id, p_created_by)
    RETURNING id INTO v_credit_id;
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
    VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by, v_credit_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'isChargeable', v_is_chargeable, 'creditEarned', v_grants_credit);
END;
$function$;

-- ── 6. register_absence_range — evalúa cada día asignado por separado ───────
CREATE OR REPLACE FUNCTION public.register_absence_range(
  p_client_id uuid,
  p_from_date date,
  p_to_date date,
  p_is_justified boolean DEFAULT false,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_day DATE; v_day_of_week INTEGER; v_day_name TEXT;
  v_assigned_days TEXT[]; v_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM client_plans WHERE client_id = p_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan no encontrado');
  END IF;
  v_day := p_from_date;
  WHILE v_day <= p_to_date LOOP
    SELECT assigned_days INTO v_assigned_days
    FROM client_plans
    WHERE client_id = p_client_id AND effective_from <= date_trunc('month', v_day)::date
    ORDER BY effective_from DESC LIMIT 1;

    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
      WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' ELSE NULL END;
    IF v_day_name IS NOT NULL AND v_assigned_days IS NOT NULL AND v_day_name = ANY(v_assigned_days) THEN
      PERFORM register_absence(p_client_id, v_day, p_is_justified, p_notes, p_created_by);
      v_count := v_count + 1;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;
  RETURN jsonb_build_object('success', true, 'daysMarked', v_count);
END;
$function$;

-- ── 7. unregister_absence — reversa unificada ──────────────────────────────
CREATE OR REPLACE FUNCTION public.unregister_absence(
  p_client_id uuid,
  p_date date,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_had_credit BOOLEAN := false; v_new_balance INTEGER;
BEGIN
  SELECT id INTO v_record_id FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date AND status = 'absent';
  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No existe falta para este día');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available'
  ) INTO v_had_credit;

  IF v_had_credit THEN
    DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';
  END IF;

  -- Hoy/pasado → 'attended'; futuro estricto → 'scheduled' (alineado con 067)
  UPDATE attendance_records SET
    status = CASE WHEN p_date > CURRENT_DATE THEN 'scheduled' ELSE 'attended' END,
    is_justified = NULL,
    is_chargeable = true,
    notes = NULL,
    updated_at = NOW()
  WHERE id = v_record_id;

  IF v_had_credit THEN
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_justified_absence', v_record_id, v_new_balance, p_created_by);
  END IF;

  RETURN jsonb_build_object('success', true, 'creditRevoked', v_had_credit);
END;
$function$;

-- ── 8. Drop de las RPCs legacy (todas las firmas) ──────────────────────────
DROP FUNCTION IF EXISTS public.mark_day_absent(uuid, date, boolean, text, text);
DROP FUNCTION IF EXISTS public.mark_day_absent(uuid, date, boolean, text);
DROP FUNCTION IF EXISTS public.unmark_day_absent(uuid, date, text);
DROP FUNCTION IF EXISTS public.mark_day_vacation(uuid, date, text, text);
DROP FUNCTION IF EXISTS public.mark_day_vacation(uuid, date, text);
DROP FUNCTION IF EXISTS public.unmark_day_vacation(uuid, date, text);
DROP FUNCTION IF EXISTS public.mark_vacation_range(uuid, date, date, text, text);
DROP FUNCTION IF EXISTS public.mark_vacation_range(uuid, date, date, text);

-- ── 9. Billing: cobrable = planned - (absent AND NOT is_chargeable) ────────
-- Reemplaza SOLO la detección de días descontados dentro de calculate_month_billing.
-- (Base: migración 055. El resto de la función queda idéntico; se recrea completa
--  para mantener una sola definición viva.)
CREATE OR REPLACE FUNCTION calculate_month_billing(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_client RECORD;
  v_plan RECORD;
  v_address RECORD;
  v_plan_price RECORD;
  v_transport_price RECORD;
  v_month_start DATE;
  v_month_end DATE;
  v_effective_start DATE;
  v_effective_end DATE;
  v_full_month_days INTEGER := 0;
  v_planned_days INTEGER := 0;
  v_vacation_days INTEGER := 0;
  v_recovery_days INTEGER := 0;
  v_chargeable_days INTEGER;
  v_days_per_month INTEGER;
  v_billed_days INTEGER;
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
  v_discount NUMERIC := 0;
  v_discount_factor NUMERIC := 1;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'Cliente no encontrado');
  END IF;

  SELECT * INTO v_plan FROM client_plans WHERE client_id = p_client_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Plan no encontrado');
  END IF;

  -- CHANGED: versión de precio vigente para el mes objetivo
  SELECT price_net, price_gross INTO v_plan_price
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule
    AND (effective_year * 12 + effective_month) <= (p_year * 12 + p_month)
  ORDER BY (effective_year * 12 + effective_month) DESC
  LIMIT 1;
  IF v_plan_price IS NULL THEN
    RETURN jsonb_build_object('error', 'Precio de plan no encontrado');
  END IF;
  v_att_rate_net := v_plan_price.price_net;
  v_att_rate_gross := v_plan_price.price_gross;

  IF v_plan.has_transport THEN
    SELECT * INTO v_address FROM client_addresses WHERE client_id = p_client_id;
    IF v_address IS NULL OR v_address.distance_range IS NULL THEN
      RETURN jsonb_build_object('error', 'Cliente con transporte requiere distancia definida');
    END IF;

    -- CHANGED: versión de precio de transporte vigente para el mes objetivo
    SELECT price_net, price_gross INTO v_transport_price
    FROM transport_pricing
    WHERE frequency = v_plan.frequency AND distance_range = v_address.distance_range
      AND (effective_year * 12 + effective_month) <= (p_year * 12 + p_month)
    ORDER BY (effective_year * 12 + effective_month) DESC
    LIMIT 1;
    IF v_transport_price IS NULL THEN
      RETURN jsonb_build_object('error', 'Precio de transporte no encontrado');
    END IF;

    v_trans_rate_net := v_transport_price.price_net;
    v_trans_rate_gross := v_transport_price.price_gross;
    v_has_transport := TRUE;
  END IF;

  SELECT COALESCE(discount_percent, 0) INTO v_discount
  FROM monthly_invoices
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
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday'
      WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
      WHEN 5 THEN 'friday' ELSE NULL
    END;

    IF v_day_name IS NOT NULL AND v_day_name = ANY(v_plan.assigned_days) THEN
      v_full_month_days := v_full_month_days + 1;
      IF v_day >= v_effective_start AND v_day <= v_effective_end THEN
        v_planned_days := v_planned_days + 1;
        IF EXISTS (
          SELECT 1 FROM attendance_records
          WHERE client_id = p_client_id AND date = v_day
            AND status = 'absent' AND is_chargeable = false
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
    'fullMonthDays', v_full_month_days,
    'plannedDays', v_planned_days,
    'vacationDays', v_vacation_days,
    'recoveryDays', v_recovery_days,
    'daysPerMonth', v_days_per_month,
    'chargeableDays', v_billed_days,
    'rawChargeableDays', v_chargeable_days,
    'isProrated', v_billed_days < v_days_per_month,
    'effectiveEnd', v_effective_end,
    'hasTransport', v_has_transport,
    'discountPercent', v_discount,
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 10. get_attendance_stats: 'vacation' ya no existe como status ─────────
--   absentJustified   = absent AND is_justified AND is_chargeable      (cobrada, cuenta como ausencia)
--   absentUnjustified = absent AND NOT is_justified                    (cobrada, cuenta como ausencia)
--   vacation          = absent AND is_justified AND NOT is_chargeable  (no cobrable, EXCLUIDA del denominador)
DROP FUNCTION IF EXISTS public.get_attendance_stats(integer, integer, integer, integer);
CREATE FUNCTION public.get_attendance_stats(
  p_from_year integer, p_from_month integer,
  p_to_year integer, p_to_month integer
)
RETURNS TABLE(
  year integer, month integer,
  frequency integer, schedule text, cognitive_level text,
  attended integer, absent_justified integer, absent_unjustified integer,
  recovery integer, vacation integer, scheduled integer
)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    EXTRACT(YEAR FROM ar.date)::int AS year,
    (EXTRACT(MONTH FROM ar.date)::int - 1) AS month,
    cp.frequency,
    cp.schedule,
    c.cognitive_level,
    COUNT(*) FILTER (WHERE ar.status = 'attended')::int,
    COUNT(*) FILTER (WHERE ar.status = 'absent' AND ar.is_justified = true AND ar.is_chargeable = true)::int,
    COUNT(*) FILTER (WHERE ar.status = 'absent' AND (ar.is_justified = false OR ar.is_justified IS NULL))::int,
    COUNT(*) FILTER (WHERE ar.status = 'recovery')::int,
    COUNT(*) FILTER (WHERE ar.status = 'absent' AND ar.is_justified = true AND ar.is_chargeable = false)::int,
    COUNT(*) FILTER (WHERE ar.status = 'scheduled')::int
  FROM attendance_records ar
  JOIN clients c ON c.id = ar.client_id
  -- plan vigente en el mes del registro (client_plans es versionado por effective_from)
  LEFT JOIN LATERAL (
    SELECT cp.frequency, cp.schedule
    FROM client_plans cp
    WHERE cp.client_id = c.id AND cp.effective_from <= date_trunc('month', ar.date)::date
    ORDER BY cp.effective_from DESC
    LIMIT 1
  ) cp ON true
  WHERE ar.date >= make_date(p_from_year, p_from_month + 1, 1)
    AND ar.date < (make_date(p_to_year, p_to_month + 1, 1) + interval '1 month')
  GROUP BY 1, 2, 3, 4, 5;
$function$;
