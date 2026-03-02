-- ============================================
-- Billing V2 Migration
-- Full overhaul: simplified states, new RPCs
-- ============================================

-- ============================================
-- 1a. Drop 008 + 005 artifacts
-- ============================================

DROP FUNCTION IF EXISTS upsert_attendance(UUID, DATE, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS upsert_attendance(UUID, DATE, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS consume_recovery_day(UUID, DATE, TEXT, TEXT);
DROP FUNCTION IF EXISTS consume_recovery_day(UUID, DATE, TEXT);
DROP FUNCTION IF EXISTS increment_recovery_days(UUID);
DROP FUNCTION IF EXISTS toggle_vacation_day(UUID, DATE, TEXT);
DROP FUNCTION IF EXISTS override_invoice_price(UUID, INTEGER, INTEGER, NUMERIC, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS get_invoice_price_history(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS revert_invoice_price(UUID, INTEGER, INTEGER, NUMERIC, TEXT, UUID);
DROP FUNCTION IF EXISTS calculate_billing_for_month(UUID, INTEGER, INTEGER);
DROP VIEW IF EXISTS monthly_billing_summary;
DROP TABLE IF EXISTS invoice_price_history CASCADE;

-- Drop and recreate recovery_credit_ledger with updated schema
DROP TABLE IF EXISTS recovery_credit_ledger CASCADE;

-- ============================================
-- 1b. Update attendance_records
-- ============================================

-- Drop old status constraint
ALTER TABLE attendance_records
DROP CONSTRAINT IF EXISTS attendance_records_status_check;

-- Add is_justified column
ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS is_justified BOOLEAN;

-- Migrate old data to new statuses
UPDATE attendance_records SET status = 'absent', is_justified = false
WHERE status = 'unjustified_absence';

UPDATE attendance_records SET status = 'absent', is_justified = true
WHERE status IN ('justified_recovered', 'justified_not_recovered');

UPDATE attendance_records SET status = 'recovery'
WHERE status = 'recovered';

-- Add new constraint with simplified statuses
ALTER TABLE attendance_records
ADD CONSTRAINT attendance_records_status_check
CHECK (status IN ('scheduled', 'attended', 'absent', 'vacation', 'recovery'));

-- ============================================
-- 1c. Simplify monthly_invoices
-- ============================================

-- Drop obsolete columns
ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS potential_amount;
ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS payment_due_date;
ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS invoiced_by;
ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS recovery_credits_applied;
ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS prorated_from_date;
ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS is_price_overridden;
ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS original_calculated_amount;

-- Add new columns
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS monthly_rate NUMERIC(12,2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS is_amount_overridden BOOLEAN DEFAULT false;
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS original_chargeable_amount NUMERIC(12,2);

-- Update payment_status CHECK: remove 'overdue'
ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_payment_status_check;
ALTER TABLE monthly_invoices ADD CONSTRAINT monthly_invoices_payment_status_check
CHECK (payment_status IN ('pending', 'paid'));

-- Fix any 'overdue' rows
UPDATE monthly_invoices SET payment_status = 'pending' WHERE payment_status = 'overdue';

-- ============================================
-- 1d. Recreate recovery_credit_ledger
-- ============================================

CREATE TABLE recovery_credit_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  change INTEGER NOT NULL,
  reason TEXT NOT NULL,
  attendance_record_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
  balance_after INTEGER NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recovery_ledger_client_id ON recovery_credit_ledger(client_id);
CREATE INDEX idx_recovery_ledger_date ON recovery_credit_ledger(date);

ALTER TABLE recovery_credit_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_credit_ledger" ON recovery_credit_ledger FOR SELECT USING (true);
CREATE POLICY "users_insert_credit_ledger" ON recovery_credit_ledger FOR INSERT WITH CHECK (true);

-- ============================================
-- 1e. Helper: get month start/end (0-indexed month)
-- ============================================

CREATE OR REPLACE FUNCTION _month_start(p_year INTEGER, p_month INTEGER)
RETURNS DATE AS $$
BEGIN
  RETURN make_date(p_year, p_month + 1, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _month_end(p_year INTEGER, p_month INTEGER)
RETURNS DATE AS $$
BEGIN
  RETURN (_month_start(p_year, p_month) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- 1e. ensure_client_months
-- Creates monthly_invoice rows from start_date to now+6mo
-- ============================================

CREATE OR REPLACE FUNCTION ensure_client_months(p_client_id UUID)
RETURNS VOID AS $$
DECLARE
  v_start DATE;
  v_cursor DATE;
  v_end DATE;
  v_year INTEGER;
  v_month INTEGER;
BEGIN
  SELECT start_date INTO v_start FROM clients WHERE id = p_client_id;
  IF v_start IS NULL THEN RETURN; END IF;

  -- Start from the first day of the client's start month
  v_cursor := date_trunc('month', v_start)::DATE;
  -- End at 6 months from now
  v_end := date_trunc('month', NOW() + INTERVAL '6 months')::DATE;

  WHILE v_cursor <= v_end LOOP
    v_year := EXTRACT(YEAR FROM v_cursor)::INTEGER;
    v_month := EXTRACT(MONTH FROM v_cursor)::INTEGER - 1; -- 0-indexed

    INSERT INTO monthly_invoices (client_id, year, month, planned_days, chargeable_days, chargeable_amount)
    VALUES (p_client_id, v_year, v_month, 0, 0, 0)
    ON CONFLICT (client_id, year, month) DO NOTHING;

    v_cursor := (v_cursor + INTERVAL '1 month')::DATE;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. advance_scheduled_attendance
-- Flips 'scheduled' → 'attended' for dates < today
-- ============================================

CREATE OR REPLACE FUNCTION advance_scheduled_attendance()
RETURNS INTEGER AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE attendance_records
  SET status = 'attended', updated_at = NOW()
  WHERE status = 'scheduled' AND date < CURRENT_DATE;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. calculate_month_billing
-- Returns billing breakdown for a client/month
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
  v_pricing RECORD;
  v_month_start DATE;
  v_month_end DATE;
  v_effective_start DATE;
  v_full_month_days INTEGER := 0;
  v_planned_days INTEGER := 0;
  v_vacation_days INTEGER := 0;
  v_recovery_days INTEGER := 0;
  v_chargeable_days INTEGER;
  v_monthly_rate NUMERIC(12,2);
  v_chargeable_amount NUMERIC(12,2);
  v_day DATE;
  v_day_of_week INTEGER;
  v_day_name TEXT;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'Cliente no encontrado');
  END IF;

  SELECT * INTO v_plan FROM client_plans WHERE client_id = p_client_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Plan no encontrado');
  END IF;

  SELECT * INTO v_pricing FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule;
  IF v_pricing IS NULL THEN
    RETURN jsonb_build_object('error', 'Precio de plan no encontrado');
  END IF;

  v_monthly_rate := CASE WHEN v_plan.has_transport
    THEN ROUND(v_pricing.price * 1.2)
    ELSE v_pricing.price
  END;

  v_month_start := _month_start(p_year, p_month);
  v_month_end := _month_end(p_year, p_month);
  v_effective_start := GREATEST(v_client.start_date, v_month_start);

  -- Walk every day of the month
  v_day := v_month_start;
  WHILE v_day <= v_month_end LOOP
    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday'
      WHEN 2 THEN 'tuesday'
      WHEN 3 THEN 'wednesday'
      WHEN 4 THEN 'thursday'
      WHEN 5 THEN 'friday'
      ELSE NULL
    END;

    IF v_day_name IS NOT NULL AND v_day_name = ANY(v_plan.assigned_days) THEN
      -- Full month days: all assigned days in the calendar month
      v_full_month_days := v_full_month_days + 1;

      IF v_day >= v_effective_start THEN
        IF EXISTS (
          SELECT 1 FROM attendance_records
          WHERE client_id = p_client_id AND date = v_day AND status = 'vacation'
        ) THEN
          v_vacation_days := v_vacation_days + 1;
        ELSE
          v_planned_days := v_planned_days + 1;
        END IF;
      END IF;
    END IF;

    v_day := v_day + INTERVAL '1 day';
  END LOOP;

  -- Count recovery attendances in this month
  SELECT COUNT(*) INTO v_recovery_days
  FROM attendance_records
  WHERE client_id = p_client_id
    AND date BETWEEN v_month_start AND v_month_end
    AND status = 'recovery';

  v_chargeable_days := v_planned_days - v_vacation_days;

  IF v_full_month_days > 0 THEN
    v_chargeable_amount := ROUND((v_chargeable_days::NUMERIC / v_full_month_days::NUMERIC) * v_monthly_rate);
  ELSE
    v_chargeable_amount := 0;
  END IF;

  RETURN jsonb_build_object(
    'fullMonthDays', v_full_month_days,
    'plannedDays', v_planned_days,
    'vacationDays', v_vacation_days,
    'recoveryDays', v_recovery_days,
    'chargeableDays', v_chargeable_days,
    'monthlyRate', v_monthly_rate,
    'chargeableAmount', v_chargeable_amount,
    'isProrated', v_effective_start > v_month_start
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. mark_month_paid
-- Snapshots billing and marks month as paid
-- ============================================

CREATE OR REPLACE FUNCTION mark_month_paid(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_amount NUMERIC(12,2),
  p_method TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_billing JSONB;
  v_calculated_amount NUMERIC(12,2);
  v_monthly_rate NUMERIC(12,2);
  v_is_overridden BOOLEAN;
BEGIN
  -- Calculate billing snapshot
  v_billing := calculate_month_billing(p_client_id, p_year, p_month);
  IF v_billing ? 'error' THEN
    RETURN jsonb_build_object('success', false, 'error', v_billing->>'error');
  END IF;

  v_calculated_amount := (v_billing->>'chargeableAmount')::NUMERIC;
  v_monthly_rate := (v_billing->>'monthlyRate')::NUMERIC;
  v_is_overridden := p_amount IS DISTINCT FROM v_calculated_amount AND p_amount IS NOT NULL;

  UPDATE monthly_invoices SET
    payment_status = 'paid',
    paid_at = NOW(),
    paid_amount = COALESCE(p_amount, v_calculated_amount),
    payment_method = p_method,
    payment_notes = p_notes,
    -- Snapshot billing data
    planned_days = (v_billing->>'plannedDays')::INTEGER,
    chargeable_days = (v_billing->>'chargeableDays')::INTEGER,
    chargeable_amount = v_calculated_amount,
    monthly_rate = v_monthly_rate,
    is_amount_overridden = v_is_overridden,
    original_chargeable_amount = CASE WHEN v_is_overridden THEN v_calculated_amount ELSE NULL END,
    updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true, 'billing', v_billing);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. mark_month_invoiced
-- ============================================

CREATE OR REPLACE FUNCTION mark_month_invoiced(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_invoice_number TEXT DEFAULT NULL,
  p_invoice_url TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
  UPDATE monthly_invoices SET
    invoice_status = 'invoiced',
    invoiced_at = NOW(),
    invoice_number = p_invoice_number,
    invoice_url = p_invoice_url,
    updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. mark_day_absent
-- ============================================

CREATE OR REPLACE FUNCTION mark_day_absent(
  p_client_id UUID,
  p_date DATE,
  p_is_justified BOOLEAN DEFAULT false,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_record_id UUID;
  v_new_balance INTEGER;
BEGIN
  INSERT INTO attendance_records (client_id, date, status, is_justified)
  VALUES (p_client_id, p_date, 'absent', p_is_justified)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'absent',
    is_justified = EXCLUDED.is_justified,
    updated_at = NOW()
  RETURNING id INTO v_record_id;

  IF p_is_justified THEN
    UPDATE clients SET recovery_days_available = recovery_days_available + 1, updated_at = NOW()
    WHERE id = p_client_id
    RETURNING recovery_days_available INTO v_new_balance;

    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by);
  END IF;

  RETURN jsonb_build_object('success', true, 'recordId', v_record_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. unmark_day_absent
-- Reverts absent → attended; if was justified → -1 recovery day
-- ============================================

CREATE OR REPLACE FUNCTION unmark_day_absent(
  p_client_id UUID,
  p_date DATE,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_old_justified BOOLEAN;
  v_record_id UUID;
  v_new_balance INTEGER;
BEGIN
  SELECT id, is_justified INTO v_record_id, v_old_justified
  FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date AND status = 'absent';

  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No existe falta para este día');
  END IF;

  UPDATE attendance_records SET status = 'attended', is_justified = NULL, updated_at = NOW()
  WHERE id = v_record_id;

  IF v_old_justified THEN
    UPDATE clients SET recovery_days_available = GREATEST(recovery_days_available - 1, 0), updated_at = NOW()
    WHERE id = p_client_id
    RETURNING recovery_days_available INTO v_new_balance;

    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_justified_absence', v_record_id, v_new_balance, p_created_by);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. mark_day_vacation
-- Marks a day as vacation; if month paid → +1 recovery day
-- ============================================

CREATE OR REPLACE FUNCTION mark_day_vacation(
  p_client_id UUID,
  p_date DATE,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_record_id UUID;
  v_month_paid BOOLEAN;
  v_new_balance INTEGER;
  v_year INTEGER;
  v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1; -- 0-indexed

  SELECT (payment_status = 'paid') INTO v_month_paid
  FROM monthly_invoices
  WHERE client_id = p_client_id AND year = v_year AND month = v_month;

  INSERT INTO attendance_records (client_id, date, status)
  VALUES (p_client_id, p_date, 'vacation')
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'vacation',
    is_justified = NULL,
    updated_at = NOW()
  RETURNING id INTO v_record_id;

  IF v_month_paid THEN
    UPDATE clients SET recovery_days_available = recovery_days_available + 1, updated_at = NOW()
    WHERE id = p_client_id
    RETURNING recovery_days_available INTO v_new_balance;

    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, 1, 'vacation_post_payment', v_record_id, v_new_balance, p_created_by);
  END IF;

  RETURN jsonb_build_object('success', true, 'creditEarned', COALESCE(v_month_paid, false));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. unmark_day_vacation
-- Removes vacation; if month paid → -1 recovery day
-- ============================================

CREATE OR REPLACE FUNCTION unmark_day_vacation(
  p_client_id UUID,
  p_date DATE,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_record_id UUID;
  v_month_paid BOOLEAN;
  v_new_balance INTEGER;
  v_year INTEGER;
  v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1;

  SELECT id INTO v_record_id
  FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date AND status = 'vacation';

  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No existe vacación para este día');
  END IF;

  SELECT (payment_status = 'paid') INTO v_month_paid
  FROM monthly_invoices
  WHERE client_id = p_client_id AND year = v_year AND month = v_month;

  -- Revert to scheduled (future) or attended (past)
  UPDATE attendance_records SET
    status = CASE WHEN p_date >= CURRENT_DATE THEN 'scheduled' ELSE 'attended' END,
    updated_at = NOW()
  WHERE id = v_record_id;

  IF v_month_paid THEN
    UPDATE clients SET recovery_days_available = GREATEST(recovery_days_available - 1, 0), updated_at = NOW()
    WHERE id = p_client_id
    RETURNING recovery_days_available INTO v_new_balance;

    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_vacation_post_payment', v_record_id, v_new_balance, p_created_by);
  END IF;

  RETURN jsonb_build_object('success', true, 'creditRevoked', COALESCE(v_month_paid, false));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. mark_vacation_range
-- Marks vacation for each assigned day in a date range
-- ============================================

CREATE OR REPLACE FUNCTION mark_vacation_range(
  p_client_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_day DATE;
  v_day_of_week INTEGER;
  v_day_name TEXT;
  v_assigned_days TEXT[];
  v_count INTEGER := 0;
BEGIN
  SELECT assigned_days INTO v_assigned_days FROM client_plans WHERE client_id = p_client_id;
  IF v_assigned_days IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan no encontrado');
  END IF;

  v_day := p_from_date;
  WHILE v_day <= p_to_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday'  WHEN 2 THEN 'tuesday'
      WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
      WHEN 5 THEN 'friday'  ELSE NULL
    END;

    IF v_day_name IS NOT NULL AND v_day_name = ANY(v_assigned_days) THEN
      PERFORM mark_day_vacation(p_client_id, v_day, p_created_by);
      v_count := v_count + 1;
    END IF;

    v_day := v_day + INTERVAL '1 day';
  END LOOP;

  RETURN jsonb_build_object('success', true, 'daysMarked', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. mark_day_recovery_attended
-- Non-planned day → recovery; -1 recovery day
-- ============================================

CREATE OR REPLACE FUNCTION mark_day_recovery_attended(
  p_client_id UUID,
  p_date DATE,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_recovery_days INTEGER;
  v_record_id UUID;
  v_new_balance INTEGER;
BEGIN
  SELECT recovery_days_available INTO v_recovery_days FROM clients WHERE id = p_client_id;
  IF v_recovery_days IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;
  IF v_recovery_days <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin días de recupero disponibles');
  END IF;

  INSERT INTO attendance_records (client_id, date, status)
  VALUES (p_client_id, p_date, 'recovery')
  ON CONFLICT (client_id, date) DO UPDATE SET status = 'recovery', updated_at = NOW()
  RETURNING id INTO v_record_id;

  UPDATE clients SET recovery_days_available = recovery_days_available - 1, updated_at = NOW()
  WHERE id = p_client_id
  RETURNING recovery_days_available INTO v_new_balance;

  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
  VALUES (p_client_id, p_date, -1, 'recovery_attendance', v_record_id, v_new_balance, p_created_by);

  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1e. unmark_day_recovery_attended
-- Removes recovery attendance; +1 recovery day
-- ============================================

CREATE OR REPLACE FUNCTION unmark_day_recovery_attended(
  p_client_id UUID,
  p_date DATE,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_record_id UUID;
  v_new_balance INTEGER;
BEGIN
  SELECT id INTO v_record_id
  FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date AND status = 'recovery';

  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No existe recupero para este día');
  END IF;

  DELETE FROM attendance_records WHERE id = v_record_id;

  UPDATE clients SET recovery_days_available = recovery_days_available + 1, updated_at = NOW()
  WHERE id = p_client_id
  RETURNING recovery_days_available INTO v_new_balance;

  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, balance_after, created_by_name)
  VALUES (p_client_id, p_date, 1, 'reverted_recovery_attendance', v_new_balance, p_created_by);

  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1f. pg_cron nightly job (best-effort)
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'advance-scheduled-attendance',
      '0 1 * * *',
      'SELECT advance_scheduled_attendance()'
    );
  END IF;
END;
$$;

-- ============================================
-- 1g. Updated views
-- ============================================

-- attendance_view: include is_justified
CREATE OR REPLACE VIEW attendance_view AS
SELECT
  ar.id,
  ar.client_id AS "clientId",
  ar.date::TEXT AS date,
  ar.shift,
  ar.status,
  ar.is_justified AS "isJustified",
  ar.notes,
  ar.created_at AS "createdAt",
  ar.updated_at AS "updatedAt"
FROM attendance_records ar;

-- invoices_view: new columns, remove obsolete
CREATE OR REPLACE VIEW invoices_view AS
SELECT
  mi.id,
  mi.client_id AS "clientId",
  mi.year,
  mi.month,
  mi.planned_days AS "plannedDays",
  mi.chargeable_days AS "chargeableDays",
  mi.chargeable_amount AS "chargeableAmount",
  mi.monthly_rate AS "monthlyRate",
  mi.is_amount_overridden AS "isAmountOverridden",
  mi.original_chargeable_amount AS "originalChargeableAmount",
  mi.invoice_status AS "invoiceStatus",
  mi.invoiced_at AS "invoicedAt",
  mi.invoice_number AS "invoiceNumber",
  mi.invoice_url AS "invoiceUrl",
  mi.payment_status AS "paymentStatus",
  mi.paid_at AS "paidAt",
  mi.paid_amount AS "paidAmount",
  mi.payment_method AS "paymentMethod",
  mi.payment_notes AS "paymentNotes",
  mi.created_at AS "createdAt",
  mi.updated_at AS "updatedAt"
FROM monthly_invoices mi;
