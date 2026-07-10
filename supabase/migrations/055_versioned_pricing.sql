-- 055_versioned_pricing.sql
-- Precios de plan/transporte versionados por (effective_year, effective_month).
-- Editar precios desde un mes elegido en adelante; meses anteriores mantienen la versión
-- previa; meses cobrados/facturados conservan su snapshot en monthly_invoices.

BEGIN;

-- 1. Columnas de vigencia (month 0-indexed, como monthly_invoices). DEFAULT (2000,0)
--    hace que las filas existentes apliquen a todo mes histórico (backfill implícito).
ALTER TABLE plan_pricing      ADD COLUMN IF NOT EXISTS effective_year  INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE plan_pricing      ADD COLUMN IF NOT EXISTS effective_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transport_pricing ADD COLUMN IF NOT EXISTS effective_year  INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE transport_pricing ADD COLUMN IF NOT EXISTS effective_month INTEGER NOT NULL DEFAULT 0;

-- 2. Reemplazar UNIQUE para incluir la vigencia (permite múltiples versiones por combo)
ALTER TABLE plan_pricing      DROP CONSTRAINT IF EXISTS plan_pricing_frequency_schedule_key;
ALTER TABLE transport_pricing DROP CONSTRAINT IF EXISTS transport_pricing_frequency_distance_range_key;

ALTER TABLE plan_pricing ADD CONSTRAINT plan_pricing_freq_sched_eff_key
  UNIQUE (frequency, schedule, effective_year, effective_month);
ALTER TABLE transport_pricing ADD CONSTRAINT transport_pricing_freq_dist_eff_key
  UNIQUE (frequency, distance_range, effective_year, effective_month);

-- 3. Endurecer RLS de transport_pricing (plan_pricing ya está endurecido)
DROP POLICY IF EXISTS "transport_pricing_select" ON transport_pricing;
DROP POLICY IF EXISTS "transport_pricing_modify" ON transport_pricing;
CREATE POLICY "transport_pricing_select_admin" ON transport_pricing
  FOR SELECT USING (is_admin_or_superadmin());
CREATE POLICY "transport_pricing_write_superadmin" ON transport_pricing
  FOR ALL USING (is_superadmin()) WITH CHECK (is_superadmin());

-- 4. RPC de escritura (solo superadmin). Net se deriva del gross (IVA 22%).
CREATE OR REPLACE FUNCTION set_pricing(
  p_effective_year INTEGER,
  p_effective_month INTEGER,
  p_plan_prices JSONB,
  p_transport_prices JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_gross NUMERIC;
  v_net NUMERIC;
  v_current_ym INTEGER;
  v_target_ym INTEGER;
BEGIN
  IF NOT is_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
  END IF;

  v_current_ym := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER * 12
                  + (EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER - 1);
  v_target_ym := p_effective_year * 12 + p_effective_month;
  IF v_target_ym < v_current_ym THEN
    RETURN jsonb_build_object('success', false,
      'error', 'El mes de vigencia no puede ser anterior al mes actual');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_plan_prices) LOOP
    v_gross := (v_item->>'price_gross')::NUMERIC;
    v_net := ROUND(v_gross / 1.22, 2);
    INSERT INTO plan_pricing (frequency, schedule, price_net, price_gross, effective_year, effective_month)
    VALUES ((v_item->>'frequency')::INTEGER, v_item->>'schedule', v_net, v_gross,
            p_effective_year, p_effective_month)
    ON CONFLICT (frequency, schedule, effective_year, effective_month)
    DO UPDATE SET price_net = EXCLUDED.price_net,
                  price_gross = EXCLUDED.price_gross,
                  updated_at = NOW();
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_transport_prices) LOOP
    v_gross := (v_item->>'price_gross')::NUMERIC;
    v_net := ROUND(v_gross / 1.22, 2);
    INSERT INTO transport_pricing (frequency, distance_range, price_net, price_gross, effective_year, effective_month)
    VALUES ((v_item->>'frequency')::INTEGER, v_item->>'distance_range', v_net, v_gross,
            p_effective_year, p_effective_month)
    ON CONFLICT (frequency, distance_range, effective_year, effective_month)
    DO UPDATE SET price_net = EXCLUDED.price_net,
                  price_gross = EXCLUDED.price_gross,
                  updated_at = NOW();
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. calculate_month_billing: los dos SELECT de precio pasan a elegir la versión
--    vigente para (p_year, p_month). El resto del cuerpo es idéntico al actual.
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

COMMIT;
