-- 023_mark_invoice_emitted_snapshot.sql
-- Fix: al emitir, snapshotear los montos/días del mes (como mark_month_paid),
-- para que una factura emitida sobre un mes no materializado no reporte $0 en el
-- dashboard. La firma cambia (params nuevos) → DROP + CREATE para no acumular overloads.

DROP FUNCTION IF EXISTS public.mark_invoice_emitted(uuid, integer, integer, bigint, text, text, text);

CREATE FUNCTION public.mark_invoice_emitted(
  p_client_id uuid, p_year integer, p_month integer,
  p_biller_id bigint, p_serie text, p_numero text, p_hash text,
  p_chargeable_amount numeric DEFAULT NULL,
  p_monthly_rate numeric DEFAULT NULL,
  p_planned_days integer DEFAULT NULL,
  p_chargeable_days integer DEFAULT NULL,
  p_att_rate_net numeric DEFAULT NULL, p_att_rate_gross numeric DEFAULT NULL,
  p_att_charge_net numeric DEFAULT NULL, p_att_charge_gross numeric DEFAULT NULL,
  p_trans_rate_net numeric DEFAULT NULL, p_trans_rate_gross numeric DEFAULT NULL,
  p_trans_charge_net numeric DEFAULT NULL, p_trans_charge_gross numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  INSERT INTO monthly_invoices (
    client_id, year, month, invoice_status, invoiced_at, invoice_number,
    biller_id, biller_serie, biller_numero, biller_hash, dgi_status, emit_error,
    chargeable_amount, monthly_rate, planned_days, chargeable_days,
    attendance_monthly_rate_net, attendance_monthly_rate_gross,
    attendance_chargeable_net, attendance_chargeable_gross,
    transport_monthly_rate_net, transport_monthly_rate_gross,
    transport_chargeable_net, transport_chargeable_gross,
    updated_at
  ) VALUES (
    p_client_id, p_year, p_month, 'invoiced', NOW(), p_serie || '-' || p_numero,
    p_biller_id, p_serie, p_numero, p_hash, 'pending_dgi', NULL,
    COALESCE(p_chargeable_amount, 0), COALESCE(p_monthly_rate, 0),
    COALESCE(p_planned_days, 0), COALESCE(p_chargeable_days, 0),
    COALESCE(p_att_rate_net, 0), COALESCE(p_att_rate_gross, 0),
    COALESCE(p_att_charge_net, 0), COALESCE(p_att_charge_gross, 0),
    COALESCE(p_trans_rate_net, 0), COALESCE(p_trans_rate_gross, 0),
    COALESCE(p_trans_charge_net, 0), COALESCE(p_trans_charge_gross, 0),
    NOW()
  )
  ON CONFLICT (client_id, year, month) DO UPDATE SET
    invoice_status = 'invoiced', invoiced_at = NOW(),
    invoice_number = EXCLUDED.invoice_number, biller_id = EXCLUDED.biller_id,
    biller_serie = EXCLUDED.biller_serie, biller_numero = EXCLUDED.biller_numero,
    biller_hash = EXCLUDED.biller_hash, dgi_status = 'pending_dgi', emit_error = NULL,
    -- Snapshot de montos: solo si se pasaron (no pisar con 0 si el caller no los envía).
    chargeable_amount = COALESCE(p_chargeable_amount, monthly_invoices.chargeable_amount),
    monthly_rate = COALESCE(p_monthly_rate, monthly_invoices.monthly_rate),
    planned_days = COALESCE(p_planned_days, monthly_invoices.planned_days),
    chargeable_days = COALESCE(p_chargeable_days, monthly_invoices.chargeable_days),
    attendance_monthly_rate_net = COALESCE(p_att_rate_net, monthly_invoices.attendance_monthly_rate_net),
    attendance_monthly_rate_gross = COALESCE(p_att_rate_gross, monthly_invoices.attendance_monthly_rate_gross),
    attendance_chargeable_net = COALESCE(p_att_charge_net, monthly_invoices.attendance_chargeable_net),
    attendance_chargeable_gross = COALESCE(p_att_charge_gross, monthly_invoices.attendance_chargeable_gross),
    transport_monthly_rate_net = COALESCE(p_trans_rate_net, monthly_invoices.transport_monthly_rate_net),
    transport_monthly_rate_gross = COALESCE(p_trans_rate_gross, monthly_invoices.transport_monthly_rate_gross),
    transport_chargeable_net = COALESCE(p_trans_charge_net, monthly_invoices.transport_chargeable_net),
    transport_chargeable_gross = COALESCE(p_trans_charge_gross, monthly_invoices.transport_chargeable_gross),
    updated_at = NOW();
  RETURN jsonb_build_object('success', true);
END;
$function$;
