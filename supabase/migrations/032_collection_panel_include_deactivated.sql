-- 032_collection_panel_include_deactivated.sql
-- El panel de cobranza/facturación del dashboard debe incluir a los clientes dados de baja
-- cuando todavía tienen un monto cobrable ese mes (su último mes prorrateado), para poder
-- cobrarlos/facturarlos. Los meses posteriores a la baja (monto 0) siguen excluidos para no
-- ensuciar el panel con filas en $0. El frontend ya marca esas filas con "(baja)".

CREATE OR REPLACE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(client_id uuid, attendance_net numeric, attendance_gross numeric, transport_net numeric, transport_gross numeric, payment_status text, invoice_status text, paid_amount numeric)
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
    mi.paid_amount
  FROM clients c
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  LEFT JOIN monthly_invoices mi
    ON mi.client_id = c.id AND mi.year = p_year AND mi.month = p_month
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;
