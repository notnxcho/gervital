-- 031_deterministic_daily_rate.sql
-- Modelo de precio por día determinístico. En vez de prorratear sobre los días asignados
-- reales del mes (variable: 8/9/10 para 2x/sem), se usa un denominador fijo:
--   días_estándar = 4 × frecuencia  (1x=4, 2x=8, 3x=12, 4x=16, 5x=20) — "mes = 4 semanas"
-- y se factura min(díasCobrables, días_estándar):
--   - un mes completo nunca supera la mensualidad (el día extra del calendario se absorbe),
--   - cada día por debajo del estándar (inicio a mitad de mes, baja, vacación) descuenta
--     precio / días_estándar.
-- Sin retroimpacto: aplica de acá en adelante; las cobranzas ya hechas se corrigieron a mano.

CREATE OR REPLACE FUNCTION public.calculate_month_billing(p_client_id uuid, p_year integer, p_month integer)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
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

  SELECT price_net, price_gross INTO v_plan_price
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule;
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

    SELECT price_net, price_gross INTO v_transport_price
    FROM transport_pricing
    WHERE frequency = v_plan.frequency AND distance_range = v_address.distance_range;
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
  -- Tope de fin EXCLUSIVO por fecha de baja (desde ese día no asiste ni se cobra).
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

  -- Precio por día determinístico: denominador fijo = 4 × frecuencia, numerador capado.
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
$function$;
