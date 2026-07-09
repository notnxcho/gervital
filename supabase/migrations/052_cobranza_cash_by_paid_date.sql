-- ════════════════════════════════════════════════════════════════════════════
-- 052_cobranza_cash_by_paid_date.sql
-- Cobranza (cash) se atribuye al mes de paid_date (fallback: mes de la factura si
-- paid_date es NULL). Asi los meses prepagados de una promo (misma fecha) colapsan
-- en el mes de pago. Se recrean:
--   1. get_dashboard_finance_series: CTE `paid` agrupa por el mes atribuido.
--   2. get_month_collection_panel: agrega cash_collected (por mes atribuido) +
--      promo_index/promo_total (X/Y del rango contiguo de descuento) + promo_percent.
-- Facturacion NO cambia. month es 0-11. Ambas SECURITY INVOKER.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_dashboard_finance_series(
  p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer)
 RETURNS TABLE(year integer, month integer, att_net numeric, att_gross numeric,
   trans_net numeric, trans_gross numeric, paid_att_net numeric, paid_att_gross numeric,
   paid_trans_net numeric, paid_trans_gross numeric, expenses_total numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH bounds AS (
    SELECT p_from_year * 12 + p_from_month AS lo, p_to_year * 12 + p_to_month AS hi
  ),
  months AS (
    SELECT (i / 12) AS year, (i % 12) AS month FROM bounds, generate_series(bounds.lo, bounds.hi) AS i
  ),
  live AS (
    SELECT m.year, m.month,
      COALESCE(SUM((b->>'attendanceChargeableNet')::numeric), 0)   AS att_net,
      COALESCE(SUM((b->>'attendanceChargeableGross')::numeric), 0) AS att_gross,
      COALESCE(SUM((b->>'transportChargeableNet')::numeric), 0)    AS trans_net,
      COALESCE(SUM((b->>'transportChargeableGross')::numeric), 0)  AS trans_gross
    FROM months m
    JOIN clients c ON c.deleted_at IS NULL AND c.client_type = 'regular'
     AND date_trunc('month', c.start_date) <= make_date(m.year, m.month + 1, 1)
    CROSS JOIN LATERAL calculate_month_billing(c.id, m.year, m.month) AS b
    WHERE (b->>'error') IS NULL
    GROUP BY m.year, m.month
  ),
  -- Cobrado atribuido al mes de paid_date (fallback: mes de la factura).
  paid AS (
    SELECT pm.pyear AS year, pm.pmonth AS month,
      COALESCE(SUM(mi.attendance_chargeable_net), 0)   AS paid_att_net,
      COALESCE(SUM(mi.attendance_chargeable_gross), 0) AS paid_att_gross,
      COALESCE(SUM(mi.transport_chargeable_net), 0)    AS paid_trans_net,
      COALESCE(SUM(mi.transport_chargeable_gross), 0)  AS paid_trans_gross
    FROM monthly_invoices mi
    CROSS JOIN LATERAL (
      SELECT EXTRACT(YEAR  FROM COALESCE(mi.paid_date, make_date(mi.year, mi.month + 1, 1)))::int     AS pyear,
             EXTRACT(MONTH FROM COALESCE(mi.paid_date, make_date(mi.year, mi.month + 1, 1)))::int - 1 AS pmonth
    ) pm, bounds
    WHERE mi.payment_status = 'paid'
      AND pm.pyear * 12 + pm.pmonth BETWEEN bounds.lo AND bounds.hi
    GROUP BY pm.pyear, pm.pmonth
  ),
  exp AS (
    SELECT e.year, e.month, COALESCE(SUM(e.amount), 0) AS expenses_total
    FROM expenses e, bounds
    WHERE e.year * 12 + e.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY e.year, e.month
  )
  SELECT m.year, m.month,
    COALESCE(live.att_net, 0), COALESCE(live.att_gross, 0),
    COALESCE(live.trans_net, 0), COALESCE(live.trans_gross, 0),
    COALESCE(paid.paid_att_net, 0), COALESCE(paid.paid_att_gross, 0),
    COALESCE(paid.paid_trans_net, 0), COALESCE(paid.paid_trans_gross, 0),
    COALESCE(exp.expenses_total, 0)
  FROM months m
  LEFT JOIN live ON live.year = m.year AND live.month = m.month
  LEFT JOIN paid ON paid.year = m.year AND paid.month = m.month
  LEFT JOIN exp  ON exp.year  = m.year AND exp.month  = m.month
  ORDER BY 1, 2;
$function$;

GRANT EXECUTE ON FUNCTION get_dashboard_finance_series(INT, INT, INT, INT) TO authenticated;

-- Panel por cliente del mes: + cash_collected (por mes atribuido) + X/Y de promo.
DROP FUNCTION IF EXISTS public.get_month_collection_panel(integer, integer);
CREATE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
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
    -- cash cobrado del cliente atribuido a (p_year, p_month) por mes de paid_date
    COALESCE((
      SELECT SUM(mi2.paid_amount)
      FROM monthly_invoices mi2
      WHERE mi2.client_id = c.id
        AND mi2.payment_status = 'paid'
        AND EXTRACT(YEAR  FROM COALESCE(mi2.paid_date, make_date(mi2.year, mi2.month + 1, 1)))::int     = p_year
        AND EXTRACT(MONTH FROM COALESCE(mi2.paid_date, make_date(mi2.year, mi2.month + 1, 1)))::int - 1 = p_month
    ), 0) AS cash_collected,
    promo.promo_index,
    promo.promo_total,
    mi.discount_percent AS promo_percent
  FROM clients c
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  LEFT JOIN monthly_invoices mi ON mi.client_id = c.id AND mi.year = p_year AND mi.month = p_month
  -- Rango contiguo de descuento (gaps-and-islands) que contiene (p_year, p_month).
  LEFT JOIN LATERAL (
    SELECT (p_year * 12 + p_month) - r.run_start + 1 AS promo_index,
           r.run_end - r.run_start + 1               AS promo_total
    FROM (
      SELECT MIN(g.ord) AS run_start, MAX(g.ord) AS run_end
      FROM (
        SELECT (mi3.year * 12 + mi3.month) AS ord,
               (mi3.year * 12 + mi3.month) - ROW_NUMBER() OVER (ORDER BY mi3.year * 12 + mi3.month) AS grp
        FROM monthly_invoices mi3
        WHERE mi3.client_id = c.id AND COALESCE(mi3.discount_percent, 0) > 0
      ) g
      GROUP BY g.grp
    ) r
    WHERE (p_year * 12 + p_month) BETWEEN r.run_start AND r.run_end
  ) promo ON true
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND c.client_type = 'regular'
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

GRANT EXECUTE ON FUNCTION get_month_collection_panel(INT, INT) TO authenticated;
