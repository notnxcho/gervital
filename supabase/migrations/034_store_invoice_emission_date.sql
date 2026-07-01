-- 034_store_invoice_emission_date.sql
-- Guardar la fecha de emisión REAL de la factura (la que va en el comprobante DGI, por defecto
-- el último día hábil del mes facturado), separada de invoiced_at (timestamp del record en el
-- sistema). El panel de cobranza (tab "Emitidas") debe mostrar esta fecha, no la del record.

-- 1. Columna
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS invoice_date DATE;

-- 2. mark_invoice_emitted: nuevo parámetro p_invoice_date (fecha de emisión). DROP + CREATE.
DROP FUNCTION IF EXISTS public.mark_invoice_emitted(uuid, integer, integer, bigint, text, text, text, numeric, numeric, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric);
CREATE FUNCTION public.mark_invoice_emitted(
  p_client_id uuid, p_year integer, p_month integer, p_biller_id bigint,
  p_serie text, p_numero text, p_hash text,
  p_chargeable_amount numeric DEFAULT NULL, p_monthly_rate numeric DEFAULT NULL,
  p_planned_days integer DEFAULT NULL, p_chargeable_days integer DEFAULT NULL,
  p_att_rate_net numeric DEFAULT NULL, p_att_rate_gross numeric DEFAULT NULL,
  p_att_charge_net numeric DEFAULT NULL, p_att_charge_gross numeric DEFAULT NULL,
  p_trans_rate_net numeric DEFAULT NULL, p_trans_rate_gross numeric DEFAULT NULL,
  p_trans_charge_net numeric DEFAULT NULL, p_trans_charge_gross numeric DEFAULT NULL,
  p_invoice_date date DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO monthly_invoices (
    client_id, year, month, invoice_status, invoiced_at, invoice_date, invoice_number,
    biller_id, biller_serie, biller_numero, biller_hash, dgi_status, emit_error,
    chargeable_amount, monthly_rate, planned_days, chargeable_days,
    attendance_monthly_rate_net, attendance_monthly_rate_gross,
    attendance_chargeable_net, attendance_chargeable_gross,
    transport_monthly_rate_net, transport_monthly_rate_gross,
    transport_chargeable_net, transport_chargeable_gross,
    updated_at
  ) VALUES (
    p_client_id, p_year, p_month, 'invoiced', NOW(), COALESCE(p_invoice_date, CURRENT_DATE), p_serie || '-' || p_numero,
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
    invoice_date = COALESCE(p_invoice_date, CURRENT_DATE),
    invoice_number = EXCLUDED.invoice_number, biller_id = EXCLUDED.biller_id,
    biller_serie = EXCLUDED.biller_serie, biller_numero = EXCLUDED.biller_numero,
    biller_hash = EXCLUDED.biller_hash, dgi_status = 'pending_dgi', emit_error = NULL,
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

-- 3. Backfill: facturas ya emitidas → último día hábil de su mes (mismo default que el modal)
UPDATE monthly_invoices mi SET invoice_date = (
  SELECT max(d)::date
  FROM generate_series(
    make_date(mi.year, mi.month + 1, 1),
    (make_date(mi.year, mi.month + 1, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date,
    INTERVAL '1 day'
  ) AS g(d)
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
)
WHERE mi.invoice_status = 'invoiced' AND mi.invoice_date IS NULL;

-- 4. Panel de cobranza: devolver invoice_date (fecha de emisión)
DROP FUNCTION IF EXISTS public.get_month_collection_panel(integer, integer);
CREATE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(
   client_id uuid,
   attendance_net numeric, attendance_gross numeric,
   transport_net numeric, transport_gross numeric,
   payment_status text, invoice_status text, paid_amount numeric,
   invoice_number text, invoiced_at timestamptz, invoice_date date, invoiced_amount numeric
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    c.id,
    (b->>'attendanceChargeableNet')::numeric,
    (b->>'attendanceChargeableGross')::numeric,
    (b->>'transportChargeableNet')::numeric,
    (b->>'transportChargeableGross')::numeric,
    COALESCE(mi.payment_status, 'pending'),
    COALESCE(mi.invoice_status, 'pending'),
    mi.paid_amount,
    mi.invoice_number,
    mi.invoiced_at,
    mi.invoice_date,
    mi.chargeable_amount
  FROM clients c
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  LEFT JOIN monthly_invoices mi
    ON mi.client_id = c.id AND mi.year = p_year AND mi.month = p_month
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;
