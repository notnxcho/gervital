-- ============================================
-- Billing System Overhaul Migration
-- ============================================

-- ============================================
-- 1. Update attendance_records status enum
-- Add 'vacation' status for pre-marked absences
-- ============================================

-- Drop existing constraint
ALTER TABLE attendance_records
DROP CONSTRAINT IF EXISTS attendance_records_status_check;

-- Add new constraint with vacation status
ALTER TABLE attendance_records
ADD CONSTRAINT attendance_records_status_check
CHECK (status IN (
  'attended',
  'unjustified_absence',
  'justified_recovered',    -- missed paid day, earns recovery credit
  'justified_not_recovered', -- not charged
  'vacation',               -- pre-marked vacation, not charged
  'recovered',              -- using recovery credit
  'scheduled'               -- future planned day
));

-- ============================================
-- 2. Update monthly_invoices table
-- ============================================

-- Add recovery credits tracking
ALTER TABLE monthly_invoices
ADD COLUMN IF NOT EXISTS recovery_credits_applied INTEGER DEFAULT 0;

-- For new clients: first day they started (for proration calc)
ALTER TABLE monthly_invoices
ADD COLUMN IF NOT EXISTS prorated_from_date DATE;

-- Manual price override tracking
ALTER TABLE monthly_invoices
ADD COLUMN IF NOT EXISTS is_price_overridden BOOLEAN DEFAULT false;

ALTER TABLE monthly_invoices
ADD COLUMN IF NOT EXISTS original_calculated_amount NUMERIC(12, 2);

-- ============================================
-- 3. Create invoice_price_history table
-- For audit trail of manual price changes
-- ============================================

CREATE TABLE IF NOT EXISTS invoice_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES monthly_invoices(id) ON DELETE CASCADE,
  previous_amount NUMERIC(12, 2) NOT NULL,
  new_amount NUMERIC(12, 2) NOT NULL,
  reason TEXT,
  changed_by UUID REFERENCES users(id),
  changed_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_invoice_price_history_invoice_id
ON invoice_price_history(invoice_id);

-- ============================================
-- 4. Create recovery_credit_ledger table
-- Audit trail for tracking credit changes
-- ============================================

CREATE TABLE IF NOT EXISTS recovery_credit_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  change INTEGER NOT NULL,  -- +1 earned, -1 consumed
  reason TEXT NOT NULL,     -- 'earned_justified_absence', 'consumed_recovery_day', 'admin_adjustment'
  attendance_record_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_name TEXT
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_recovery_credit_ledger_client_id
ON recovery_credit_ledger(client_id);

CREATE INDEX IF NOT EXISTS idx_recovery_credit_ledger_date
ON recovery_credit_ledger(date);

-- ============================================
-- 5. Create monthly_billing_summary view
-- Helper view for billing calculations
-- ============================================

CREATE OR REPLACE VIEW monthly_billing_summary AS
SELECT
  mi.id as invoice_id,
  mi.client_id,
  mi.year,
  mi.month,
  mi.planned_days,
  mi.chargeable_days,
  mi.recovery_credits_applied,
  mi.prorated_from_date,
  mi.is_price_overridden,
  mi.original_calculated_amount,
  mi.chargeable_amount,
  mi.invoice_status,
  mi.payment_status,
  c.recovery_days_available,
  c.start_date as client_start_date,
  cp.frequency,
  cp.schedule,
  cp.has_transport,
  cp.assigned_days,
  pp.price as base_price,
  CASE WHEN cp.has_transport THEN ROUND(pp.price * 1.2) ELSE pp.price END as monthly_price
FROM monthly_invoices mi
JOIN clients c ON c.id = mi.client_id
LEFT JOIN client_plans cp ON cp.client_id = c.id
LEFT JOIN plan_pricing pp ON pp.frequency = cp.frequency AND pp.schedule = cp.schedule;

-- ============================================
-- 6. Update upsert_attendance function
-- Add ledger support and vacation handling
-- ============================================

CREATE OR REPLACE FUNCTION upsert_attendance(
  p_client_id UUID,
  p_date DATE,
  p_status TEXT,
  p_shift TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_by_name TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_old_status TEXT;
  v_record RECORD;
  v_new_balance INTEGER;
  v_attendance_id UUID;
BEGIN
  -- Get old status if exists
  SELECT status, id INTO v_old_status, v_attendance_id
  FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date;

  -- Handle recovery day logic
  IF v_old_status IS NOT NULL AND v_old_status = 'justified_recovered' AND p_status != 'justified_recovered' THEN
    -- Decrement recovery days if changing FROM justified_recovered
    UPDATE clients SET recovery_days_available = GREATEST(recovery_days_available - 1, 0)
    WHERE id = p_client_id
    RETURNING recovery_days_available INTO v_new_balance;

    -- Log to ledger
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_justified_absence', v_attendance_id, v_new_balance, p_created_by_name);
  END IF;

  IF (v_old_status IS NULL OR v_old_status != 'justified_recovered') AND p_status = 'justified_recovered' THEN
    -- Increment recovery days if changing TO justified_recovered
    UPDATE clients SET recovery_days_available = recovery_days_available + 1
    WHERE id = p_client_id
    RETURNING recovery_days_available INTO v_new_balance;
  END IF;

  -- Insert or update attendance record
  INSERT INTO attendance_records (client_id, date, status, shift, notes)
  VALUES (p_client_id, p_date, p_status, p_shift, p_notes)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = EXCLUDED.status,
    shift = COALESCE(EXCLUDED.shift, attendance_records.shift),
    notes = COALESCE(EXCLUDED.notes, attendance_records.notes),
    updated_at = NOW()
  RETURNING *, id INTO v_record, v_attendance_id;

  -- Log credit earned to ledger (for new justified_recovered)
  IF (v_old_status IS NULL OR v_old_status != 'justified_recovered') AND p_status = 'justified_recovered' THEN
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, 1, 'earned_justified_absence', v_attendance_id, v_new_balance, p_created_by_name);
  END IF;

  RETURN jsonb_build_object(
    'date', v_record.date::TEXT,
    'status', v_record.status,
    'shift', v_record.shift,
    'notes', v_record.notes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. Update consume_recovery_day function
-- Add ledger support
-- ============================================

CREATE OR REPLACE FUNCTION consume_recovery_day(
  p_client_id UUID,
  p_date DATE,
  p_shift TEXT DEFAULT NULL,
  p_created_by_name TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_recovery_days INTEGER;
  v_attendance_record RECORD;
  v_attendance_id UUID;
BEGIN
  -- Get current recovery days
  SELECT recovery_days_available INTO v_recovery_days
  FROM clients WHERE id = p_client_id;

  IF v_recovery_days IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Cliente no encontrado');
  END IF;

  IF v_recovery_days <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'No hay días de recupero disponibles');
  END IF;

  -- Decrement recovery days
  UPDATE clients
  SET recovery_days_available = recovery_days_available - 1,
      updated_at = NOW()
  WHERE id = p_client_id;

  -- Insert or update attendance record
  INSERT INTO attendance_records (client_id, date, shift, status)
  VALUES (p_client_id, p_date, p_shift, 'recovered')
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'recovered',
    shift = EXCLUDED.shift,
    updated_at = NOW()
  RETURNING *, id INTO v_attendance_record, v_attendance_id;

  -- Log to ledger
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
  VALUES (p_client_id, p_date, -1, 'consumed_recovery_day', v_attendance_id, v_recovery_days - 1, p_created_by_name);

  RETURN jsonb_build_object(
    'success', TRUE,
    'attendance', jsonb_build_object(
      'date', v_attendance_record.date::TEXT,
      'status', v_attendance_record.status,
      'shift', v_attendance_record.shift
    ),
    'recoveryDaysAvailable', v_recovery_days - 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. New function: toggle_vacation_day
-- Toggle between scheduled and vacation status
-- ============================================

CREATE OR REPLACE FUNCTION toggle_vacation_day(
  p_client_id UUID,
  p_date DATE,
  p_shift TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_current_status TEXT;
  v_new_status TEXT;
  v_record RECORD;
BEGIN
  -- Get current status if exists
  SELECT status INTO v_current_status
  FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date;

  -- Determine new status
  IF v_current_status = 'vacation' THEN
    v_new_status := 'scheduled';
  ELSIF v_current_status IS NULL OR v_current_status = 'scheduled' THEN
    v_new_status := 'vacation';
  ELSE
    -- Can't toggle non-scheduled/vacation statuses
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Solo se pueden cambiar días programados o de vacaciones'
    );
  END IF;

  -- Insert or update
  INSERT INTO attendance_records (client_id, date, status, shift)
  VALUES (p_client_id, p_date, v_new_status, p_shift)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = v_new_status,
    shift = COALESCE(EXCLUDED.shift, attendance_records.shift),
    updated_at = NOW()
  RETURNING * INTO v_record;

  RETURN jsonb_build_object(
    'success', TRUE,
    'date', v_record.date::TEXT,
    'status', v_record.status,
    'shift', v_record.shift
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. New function: override_invoice_price
-- Manual price override with audit trail
-- ============================================

CREATE OR REPLACE FUNCTION override_invoice_price(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_new_amount NUMERIC(12, 2),
  p_reason TEXT,
  p_changed_by_name TEXT,
  p_changed_by_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_invoice RECORD;
  v_previous_amount NUMERIC(12, 2);
BEGIN
  -- Get the invoice
  SELECT * INTO v_invoice
  FROM monthly_invoices
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  IF v_invoice IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Factura no encontrada');
  END IF;

  -- Check if already invoiced (locked)
  IF v_invoice.invoice_status = 'invoiced' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'El precio no puede modificarse - mes ya facturado');
  END IF;

  -- Store previous amount
  v_previous_amount := v_invoice.chargeable_amount;

  -- Store original calculated amount if first override
  IF NOT v_invoice.is_price_overridden THEN
    UPDATE monthly_invoices
    SET original_calculated_amount = chargeable_amount,
        is_price_overridden = TRUE
    WHERE id = v_invoice.id;
  END IF;

  -- Update the price
  UPDATE monthly_invoices
  SET chargeable_amount = p_new_amount,
      updated_at = NOW()
  WHERE id = v_invoice.id;

  -- Log to history
  INSERT INTO invoice_price_history (invoice_id, previous_amount, new_amount, reason, changed_by, changed_by_name)
  VALUES (v_invoice.id, v_previous_amount, p_new_amount, p_reason, p_changed_by_id, p_changed_by_name);

  RETURN jsonb_build_object(
    'success', TRUE,
    'previousAmount', v_previous_amount,
    'newAmount', p_new_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. New function: get_invoice_price_history
-- Retrieve price change history for an invoice
-- ============================================

CREATE OR REPLACE FUNCTION get_invoice_price_history(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_invoice_id UUID;
  v_history JSONB;
  v_original_amount NUMERIC(12, 2);
BEGIN
  -- Get invoice ID and original amount
  SELECT id, original_calculated_amount INTO v_invoice_id, v_original_amount
  FROM monthly_invoices
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  IF v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('history', '[]'::JSONB, 'originalAmount', NULL);
  END IF;

  -- Get history
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'previousAmount', previous_amount,
      'newAmount', new_amount,
      'reason', reason,
      'changedBy', changed_by_name,
      'createdAt', created_at
    ) ORDER BY created_at DESC
  ), '[]'::JSONB) INTO v_history
  FROM invoice_price_history
  WHERE invoice_id = v_invoice_id;

  RETURN jsonb_build_object(
    'history', v_history,
    'originalAmount', v_original_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 11. New function: revert_invoice_price
-- Revert to a specific historical price or original
-- ============================================

CREATE OR REPLACE FUNCTION revert_invoice_price(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_target_amount NUMERIC(12, 2),
  p_changed_by_name TEXT,
  p_changed_by_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
  -- Just call override with a revert reason
  RETURN override_invoice_price(
    p_client_id,
    p_year,
    p_month,
    p_target_amount,
    'Revertido a valor anterior',
    p_changed_by_name,
    p_changed_by_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 12. New function: calculate_billing_for_month
-- Calculate billing with proration and recovery credits
-- ============================================

CREATE OR REPLACE FUNCTION calculate_billing_for_month(
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
  v_credits_available INTEGER;
  v_credits_to_apply INTEGER;
  v_chargeable_days INTEGER;
  v_monthly_price NUMERIC(12, 2);
  v_chargeable_amount NUMERIC(12, 2);
  v_day DATE;
  v_day_of_week INTEGER;
  v_day_name TEXT;
BEGIN
  -- Get client info
  SELECT * INTO v_client
  FROM clients WHERE id = p_client_id;

  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'Cliente no encontrado');
  END IF;

  -- Get plan info
  SELECT * INTO v_plan
  FROM client_plans WHERE client_id = p_client_id;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Plan no encontrado');
  END IF;

  -- Get pricing
  SELECT * INTO v_pricing
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule;

  IF v_pricing IS NULL THEN
    RETURN jsonb_build_object('error', 'Precio de plan no encontrado');
  END IF;

  -- Calculate monthly price with transport
  v_monthly_price := CASE WHEN v_plan.has_transport
    THEN ROUND(v_pricing.price * 1.2)
    ELSE v_pricing.price
  END;

  -- Calculate month boundaries
  v_month_start := make_date(p_year, p_month + 1, 1);  -- p_month is 0-indexed
  v_month_end := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Effective start for new clients
  v_effective_start := GREATEST(v_client.start_date, v_month_start);

  -- Count full month days (based on assigned days)
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
      v_full_month_days := v_full_month_days + 1;

      -- Count planned days (from effective start, excluding vacations)
      IF v_day >= v_effective_start THEN
        -- Check for vacation
        IF NOT EXISTS (
          SELECT 1 FROM attendance_records
          WHERE client_id = p_client_id AND date = v_day AND status = 'vacation'
        ) THEN
          v_planned_days := v_planned_days + 1;
        ELSE
          v_vacation_days := v_vacation_days + 1;
        END IF;
      END IF;
    END IF;

    v_day := v_day + INTERVAL '1 day';
  END LOOP;

  -- Get recovery credits available
  v_credits_available := v_client.recovery_days_available;
  v_credits_to_apply := LEAST(v_credits_available, v_planned_days);

  -- Calculate chargeable days
  v_chargeable_days := v_planned_days - v_credits_to_apply;

  -- Calculate amount with proration
  IF v_full_month_days > 0 THEN
    v_chargeable_amount := ROUND((v_chargeable_days::NUMERIC / v_full_month_days::NUMERIC) * v_monthly_price);
  ELSE
    v_chargeable_amount := 0;
  END IF;

  RETURN jsonb_build_object(
    'fullMonthDays', v_full_month_days,
    'plannedDays', v_planned_days,
    'vacationDays', v_vacation_days,
    'creditsAvailable', v_credits_available,
    'creditsToApply', v_credits_to_apply,
    'chargeableDays', v_chargeable_days,
    'monthlyPrice', v_monthly_price,
    'chargeableAmount', v_chargeable_amount,
    'isProrated', v_effective_start > v_month_start,
    'effectiveStartDate', v_effective_start::TEXT
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 13. Update views for new fields
-- ============================================

-- Update invoices_view to include new fields
CREATE OR REPLACE VIEW invoices_view AS
SELECT
  mi.client_id as "clientId",
  mi.year,
  mi.month,
  mi.planned_days as "plannedDays",
  mi.chargeable_days as "chargeableDays",
  mi.potential_amount as "potentialAmount",
  mi.chargeable_amount as "chargeableAmount",
  mi.recovery_credits_applied as "recoveryCreditsApplied",
  mi.prorated_from_date as "proratedFromDate",
  mi.is_price_overridden as "isPriceOverridden",
  mi.original_calculated_amount as "originalCalculatedAmount",
  mi.invoice_status as "invoiceStatus",
  mi.invoiced_at as "invoicedAt",
  mi.invoiced_by as "invoicedBy",
  mi.invoice_number as "invoiceNumber",
  mi.invoice_url as "invoiceUrl",
  mi.payment_status as "paymentStatus",
  mi.payment_due_date as "paymentDueDate",
  mi.paid_at as "paidAt",
  mi.paid_amount as "paidAmount",
  mi.payment_method as "paymentMethod",
  mi.payment_notes as "paymentNotes"
FROM monthly_invoices mi;

-- ============================================
-- 14. RLS Policies for new tables
-- ============================================

-- Enable RLS on new tables
ALTER TABLE invoice_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_credit_ledger ENABLE ROW LEVEL SECURITY;

-- invoice_price_history policies
CREATE POLICY "Users can view all price history" ON invoice_price_history
  FOR SELECT USING (true);

CREATE POLICY "Users can insert price history" ON invoice_price_history
  FOR INSERT WITH CHECK (true);

-- recovery_credit_ledger policies
CREATE POLICY "Users can view all credit ledger" ON recovery_credit_ledger
  FOR SELECT USING (true);

CREATE POLICY "Users can insert credit ledger" ON recovery_credit_ledger
  FOR INSERT WITH CHECK (true);
