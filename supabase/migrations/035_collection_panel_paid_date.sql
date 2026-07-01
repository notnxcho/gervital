-- 035_collection_panel_paid_date.sql
-- La tab "Cobrados" del panel de cobranza necesita la fecha de cobro (paid_date, la que carga
-- el operador al marcar como cobrado) además del monto pagado (paid_amount, ya devuelto).

DROP FUNCTION IF EXISTS public.get_month_collection_panel(integer, integer);
CREATE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(
   client_id uuid,
   attendance_net numeric, attendance_gross numeric,
   transport_net numeric, transport_gross numeric,
   payment_status text, invoice_status text, paid_amount numeric, paid_date date,
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
    mi.paid_date,
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
