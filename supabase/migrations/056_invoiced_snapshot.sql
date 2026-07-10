-- 056_invoiced_snapshot.sql
-- La regla "meses facturados usan snapshot" (feature Gestión de planes) requiere que
-- CUALQUIER mes con invoice_status='invoiced' tenga chargeable_amount poblado. El path de
-- emisión Biller (mark_invoice_emitted) y el de cobro (mark_month_paid) ya snapshotean,
-- pero mark_month_invoiced (marca manual fallback) solo cambiaba el estado. Ahora también
-- snapshotea el billing al momento de facturar (precio vigente del mes), sin tocar el pago.

CREATE OR REPLACE FUNCTION mark_month_invoiced(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_invoice_number TEXT DEFAULT NULL,
  p_invoice_url TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_billing JSONB;
  v_total_gross NUMERIC(12,2);
BEGIN
  v_billing := calculate_month_billing(p_client_id, p_year, p_month);
  IF v_billing ? 'error' THEN
    RETURN jsonb_build_object('success', false, 'error', v_billing->>'error');
  END IF;
  v_total_gross := (v_billing->>'totalChargeableGross')::NUMERIC;

  UPDATE monthly_invoices SET
    invoice_status = 'invoiced',
    invoiced_at = NOW(),
    invoice_number = p_invoice_number,
    invoice_url = p_invoice_url,
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
    updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true, 'billing', v_billing);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
