-- ════════════════════════════════════════════════════════════════════════════
-- 062_collection_panel_promo_id.sql
-- get_month_collection_panel: X/Y de promo ahora sale de mi.promo_id -> promotions
-- (antes gaps-and-islands sobre discount_percent, que fusionaba promos consecutivas).
-- Solo meses con promo_id devuelven promo_index/promo_total/promo_percent; el descuento
-- suelto (promo_id NULL) queda sin badge. cash_collected y el resto no cambian.
-- Misma firma que mig 052. month es 0-indexed. SECURITY INVOKER.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(
   client_id uuid,
   attendance_net numeric, attendance_gross numeric,
   transport_net numeric, transport_gross numeric,
   payment_status text, invoice_status text, paid_amount numeric, paid_date date,
   invoice_number text, invoiced_at timestamptz, invoice_date date, invoiced_amount numeric,
   cash_collected numeric, promo_index int, promo_total int, promo_percent numeric
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT c.id,
    (b->>'attendanceChargeableNet')::numeric, (b->>'attendanceChargeableGross')::numeric,
    (b->>'transportChargeableNet')::numeric, (b->>'transportChargeableGross')::numeric,
    COALESCE(mi.payment_status, 'pending'), COALESCE(mi.invoice_status, 'pending'),
    mi.paid_amount, mi.paid_date, mi.invoice_number, mi.invoiced_at, mi.invoice_date, mi.chargeable_amount,
    COALESCE((
      SELECT SUM(mi2.paid_amount)
      FROM monthly_invoices mi2
      WHERE mi2.client_id = c.id
        AND mi2.payment_status = 'paid'
        AND EXTRACT(YEAR  FROM COALESCE(mi2.paid_date, make_date(mi2.year, mi2.month + 1, 1)))::int     = p_year
        AND EXTRACT(MONTH FROM COALESCE(mi2.paid_date, make_date(mi2.year, mi2.month + 1, 1)))::int - 1 = p_month
    ), 0) AS cash_collected,
    CASE WHEN mi.promo_id IS NOT NULL
      THEN (p_year * 12 + p_month) - (pr.start_year * 12 + pr.start_month) + 1 END AS promo_index,
    CASE WHEN mi.promo_id IS NOT NULL
      THEN (pr.end_year * 12 + pr.end_month) - (pr.start_year * 12 + pr.start_month) + 1 END AS promo_total,
    CASE WHEN mi.promo_id IS NOT NULL THEN mi.discount_percent END AS promo_percent
  FROM clients c
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  LEFT JOIN monthly_invoices mi ON mi.client_id = c.id AND mi.year = p_year AND mi.month = p_month
  LEFT JOIN promotions pr ON pr.id = mi.promo_id
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND c.client_type = 'regular'
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

GRANT EXECUTE ON FUNCTION get_month_collection_panel(INT, INT) TO authenticated;
