-- ============================================
-- 015: Pricing Redesign
-- - plan_pricing: frequency 1..5, columns price_net + price_gross (drop old price)
-- - new transport_pricing table
-- - client_addresses.distance_range migrated to 3 buckets
-- - monthly_invoices extended with attendance/transport × net/gross granularity
-- - RPCs and views updated
-- ============================================

-- ============================================
-- Step 1 — client_plans: extend frequency to 1..5
-- ============================================

ALTER TABLE client_plans DROP CONSTRAINT IF EXISTS client_plans_frequency_check;
ALTER TABLE client_plans ADD CONSTRAINT client_plans_frequency_check
  CHECK (frequency IN (1, 2, 3, 4, 5));

-- ============================================
-- Step 2 — plan_pricing: extend frequency, add net/gross columns
-- ============================================

DELETE FROM plan_pricing;

ALTER TABLE plan_pricing DROP CONSTRAINT IF EXISTS plan_pricing_frequency_check;
ALTER TABLE plan_pricing ADD CONSTRAINT plan_pricing_frequency_check
  CHECK (frequency IN (1, 2, 3, 4, 5));

ALTER TABLE plan_pricing ADD COLUMN IF NOT EXISTS price_net NUMERIC(12, 2);
ALTER TABLE plan_pricing ADD COLUMN IF NOT EXISTS price_gross NUMERIC(12, 2);

ALTER TABLE plan_pricing ALTER COLUMN price_net SET NOT NULL;
ALTER TABLE plan_pricing ALTER COLUMN price_gross SET NOT NULL;

ALTER TABLE plan_pricing DROP COLUMN IF EXISTS price;

-- ============================================
-- Step 3 — transport_pricing: new table
-- ============================================

CREATE TABLE transport_pricing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  frequency INTEGER NOT NULL CHECK (frequency IN (1, 2, 3, 4, 5)),
  distance_range TEXT NOT NULL CHECK (distance_range IN ('0_to_2km', '2_to_5km', '5_to_10km')),
  price_net NUMERIC(12, 2) NOT NULL,
  price_gross NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (frequency, distance_range)
);

ALTER TABLE transport_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transport_pricing_select" ON transport_pricing FOR SELECT TO authenticated USING (true);
CREATE POLICY "transport_pricing_modify" ON transport_pricing FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER set_transport_pricing_updated_at
  BEFORE UPDATE ON transport_pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Step 4 — client_addresses: migrate distance_range to 3 buckets
-- ============================================

ALTER TABLE client_addresses DROP CONSTRAINT IF EXISTS client_addresses_distance_range_check;

UPDATE client_addresses SET distance_range = '0_to_2km' WHERE distance_range = 'under_1km';
UPDATE client_addresses SET distance_range = '2_to_5km' WHERE distance_range = '1_to_5km';
UPDATE client_addresses SET distance_range = '5_to_10km' WHERE distance_range = 'over_10km';

ALTER TABLE client_addresses ADD CONSTRAINT client_addresses_distance_range_check
  CHECK (distance_range IS NULL OR distance_range IN ('0_to_2km', '2_to_5km', '5_to_10km'));

-- ============================================
-- Step 5 — monthly_invoices: granular columns + backfill
-- ============================================

ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS attendance_monthly_rate_net NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS attendance_monthly_rate_gross NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS attendance_chargeable_net NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS attendance_chargeable_gross NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS transport_monthly_rate_net NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS transport_monthly_rate_gross NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS transport_chargeable_net NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS transport_chargeable_gross NUMERIC(12, 2);

UPDATE monthly_invoices
SET
  attendance_chargeable_gross = chargeable_amount,
  attendance_chargeable_net = ROUND(chargeable_amount / 1.22, 2),
  attendance_monthly_rate_gross = monthly_rate,
  attendance_monthly_rate_net = ROUND(monthly_rate / 1.22, 2),
  transport_monthly_rate_net = 0,
  transport_monthly_rate_gross = 0,
  transport_chargeable_net = 0,
  transport_chargeable_gross = 0
WHERE attendance_chargeable_gross IS NULL;

-- ============================================
-- Step 6 — Seed plan_pricing (5 frequencies × 3 schedules)
-- ============================================

INSERT INTO plan_pricing (frequency, schedule, price_net, price_gross) VALUES
  (1, 'morning',    13115, 16000),
  (2, 'morning',    19672, 24000),
  (3, 'morning',    25574, 31200),
  (4, 'morning',    31475, 38400),
  (5, 'morning',    37377, 45600),
  (1, 'afternoon',  16393, 20000),
  (2, 'afternoon',  24590, 30000),
  (3, 'afternoon',  31967, 39000),
  (4, 'afternoon',  39344, 48000),
  (5, 'afternoon',  46721, 57000),
  (1, 'full_day',   27049, 33000),
  (2, 'full_day',   39344, 48000),
  (3, 'full_day',   49180, 60000),
  (4, 'full_day',   59836, 73000),
  (5, 'full_day',   66393, 81000);

-- ============================================
-- Step 7 — Seed transport_pricing (5 frequencies × 3 distance ranges)
-- ============================================

INSERT INTO transport_pricing (frequency, distance_range, price_net, price_gross) VALUES
  (1, '0_to_2km',  2327,  2560),
  (2, '0_to_2km',  4655,  5120),
  (3, '0_to_2km',  6982,  7680),
  (4, '0_to_2km',  9309, 10240),
  (5, '0_to_2km', 11636, 12800),
  (1, '2_to_5km',  3782,  4160),
  (2, '2_to_5km',  7564,  8320),
  (3, '2_to_5km', 11345, 12480),
  (4, '2_to_5km', 15127, 16640),
  (5, '2_to_5km', 18909, 20800),
  (1, '5_to_10km',  4655,  5120),
  (2, '5_to_10km',  9309, 10240),
  (3, '5_to_10km', 13964, 15360),
  (4, '5_to_10km', 18618, 20480),
  (5, '5_to_10km', 23273, 25600);

-- ============================================
-- Step 8 — Pricing RPCs
-- ============================================

DROP FUNCTION IF EXISTS get_plan_price(INTEGER, TEXT);
DROP FUNCTION IF EXISTS get_transport_price(INTEGER, TEXT);

CREATE OR REPLACE FUNCTION get_plan_price(p_frequency INTEGER, p_schedule TEXT)
RETURNS JSONB AS $$
DECLARE v_net NUMERIC; v_gross NUMERIC;
BEGIN
  SELECT price_net, price_gross INTO v_net, v_gross
  FROM plan_pricing
  WHERE frequency = p_frequency AND schedule = p_schedule;

  IF v_net IS NULL THEN
    RAISE EXCEPTION 'No plan pricing for frequency=% schedule=%', p_frequency, p_schedule;
  END IF;

  RETURN jsonb_build_object('net', v_net, 'gross', v_gross);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_transport_price(p_frequency INTEGER, p_distance_range TEXT)
RETURNS JSONB AS $$
DECLARE v_net NUMERIC; v_gross NUMERIC;
BEGIN
  SELECT price_net, price_gross INTO v_net, v_gross
  FROM transport_pricing
  WHERE frequency = p_frequency AND distance_range = p_distance_range;

  IF v_net IS NULL THEN
    RAISE EXCEPTION 'No transport pricing for frequency=% distance=%', p_frequency, p_distance_range;
  END IF;

  RETURN jsonb_build_object('net', v_net, 'gross', v_gross);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- Step 9 — calculate_month_billing v2
-- ============================================

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
  v_full_month_days INTEGER := 0;
  v_planned_days INTEGER := 0;
  v_vacation_days INTEGER := 0;
  v_recovery_days INTEGER := 0;
  v_chargeable_days INTEGER;
  v_att_rate_net NUMERIC(12,2);
  v_att_rate_gross NUMERIC(12,2);
  v_att_charge_net NUMERIC(12,2);
  v_att_charge_gross NUMERIC(12,2);
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Step 10 — mark_month_paid v2
-- ============================================

CREATE OR REPLACE FUNCTION mark_month_paid(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_amount NUMERIC(12,2),
  p_method TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_paid_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_billing JSONB;
  v_total_gross NUMERIC(12,2);
  v_is_overridden BOOLEAN;
BEGIN
  v_billing := calculate_month_billing(p_client_id, p_year, p_month);
  IF v_billing ? 'error' THEN
    RETURN jsonb_build_object('success', false, 'error', v_billing->>'error');
  END IF;

  v_total_gross := (v_billing->>'totalChargeableGross')::NUMERIC;
  v_is_overridden := p_amount IS DISTINCT FROM v_total_gross AND p_amount IS NOT NULL;

  UPDATE monthly_invoices SET
    payment_status = 'paid',
    paid_at = NOW(),
    paid_date = COALESCE(p_paid_date, CURRENT_DATE),
    paid_amount = COALESCE(p_amount, v_total_gross),
    payment_method = p_method,
    payment_notes = p_notes,
    planned_days = (v_billing->>'plannedDays')::INTEGER,
    chargeable_days = (v_billing->>'chargeableDays')::INTEGER,
    attendance_monthly_rate_net   = (v_billing->>'attendanceMonthlyRateNet')::NUMERIC,
    attendance_monthly_rate_gross = (v_billing->>'attendanceMonthlyRateGross')::NUMERIC,
    attendance_chargeable_net     = (v_billing->>'attendanceChargeableNet')::NUMERIC,
    attendance_chargeable_gross   = (v_billing->>'attendanceChargeableGross')::NUMERIC,
    transport_monthly_rate_net    = (v_billing->>'transportMonthlyRateNet')::NUMERIC,
    transport_monthly_rate_gross  = (v_billing->>'transportMonthlyRateGross')::NUMERIC,
    transport_chargeable_net      = (v_billing->>'transportChargeableNet')::NUMERIC,
    transport_chargeable_gross    = (v_billing->>'transportChargeableGross')::NUMERIC,
    chargeable_amount = v_total_gross,
    monthly_rate = (v_billing->>'attendanceMonthlyRateGross')::NUMERIC,
    is_amount_overridden = v_is_overridden,
    original_chargeable_amount = CASE WHEN v_is_overridden THEN v_total_gross ELSE NULL END,
    updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true, 'billing', v_billing);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Step 11 — invoices_view
-- ============================================

DROP VIEW IF EXISTS invoices_view;
CREATE VIEW invoices_view AS
SELECT
  mi.id,
  mi.client_id AS "clientId",
  mi.year,
  mi.month,
  mi.planned_days AS "plannedDays",
  mi.chargeable_days AS "chargeableDays",
  mi.chargeable_amount AS "chargeableAmount",
  mi.monthly_rate AS "monthlyRate",
  mi.attendance_monthly_rate_net AS "attendanceMonthlyRateNet",
  mi.attendance_monthly_rate_gross AS "attendanceMonthlyRateGross",
  mi.attendance_chargeable_net AS "attendanceChargeableNet",
  mi.attendance_chargeable_gross AS "attendanceChargeableGross",
  mi.transport_monthly_rate_net AS "transportMonthlyRateNet",
  mi.transport_monthly_rate_gross AS "transportMonthlyRateGross",
  mi.transport_chargeable_net AS "transportChargeableNet",
  mi.transport_chargeable_gross AS "transportChargeableGross",
  mi.is_amount_overridden AS "isAmountOverridden",
  mi.original_chargeable_amount AS "originalChargeableAmount",
  mi.invoice_status AS "invoiceStatus",
  mi.invoiced_at AS "invoicedAt",
  mi.invoice_number AS "invoiceNumber",
  mi.invoice_url AS "invoiceUrl",
  mi.payment_status AS "paymentStatus",
  mi.paid_at AS "paidAt",
  mi.paid_date AS "paidDate",
  mi.paid_amount AS "paidAmount",
  mi.payment_method AS "paymentMethod",
  mi.payment_notes AS "paymentNotes",
  mi.created_at AS "createdAt",
  mi.updated_at AS "updatedAt"
FROM monthly_invoices mi;
