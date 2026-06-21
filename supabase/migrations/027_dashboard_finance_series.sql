-- 027_dashboard_finance_series.sql
-- Monthly aggregation for the dashboard hero chart + KPIs.
-- Income (previsto = all invoices, cobrado = paid invoices) with attendance/transport
-- split and net/gross (IVA) columns, plus devengado expenses. Salaries are added
-- client-side. month is 0-indexed. SECURITY INVOKER → RLS on base tables applies.

CREATE OR REPLACE FUNCTION get_dashboard_finance_series(
  p_from_year  INT,
  p_from_month INT,
  p_to_year    INT,
  p_to_month   INT
)
RETURNS TABLE (
  year             INT,
  month            INT,
  att_net          NUMERIC,
  att_gross        NUMERIC,
  trans_net        NUMERIC,
  trans_gross      NUMERIC,
  paid_att_net     NUMERIC,
  paid_att_gross   NUMERIC,
  paid_trans_net   NUMERIC,
  paid_trans_gross NUMERIC,
  expenses_total   NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT p_from_year * 12 + p_from_month AS lo,
           p_to_year   * 12 + p_to_month   AS hi
  ),
  inv AS (
    SELECT mi.year, mi.month,
      COALESCE(SUM(mi.attendance_chargeable_net), 0)   AS att_net,
      COALESCE(SUM(mi.attendance_chargeable_gross), 0) AS att_gross,
      COALESCE(SUM(mi.transport_chargeable_net), 0)    AS trans_net,
      COALESCE(SUM(mi.transport_chargeable_gross), 0)  AS trans_gross,
      COALESCE(SUM(CASE WHEN mi.payment_status = 'paid' THEN mi.attendance_chargeable_net  ELSE 0 END), 0) AS paid_att_net,
      COALESCE(SUM(CASE WHEN mi.payment_status = 'paid' THEN mi.attendance_chargeable_gross ELSE 0 END), 0) AS paid_att_gross,
      COALESCE(SUM(CASE WHEN mi.payment_status = 'paid' THEN mi.transport_chargeable_net   ELSE 0 END), 0) AS paid_trans_net,
      COALESCE(SUM(CASE WHEN mi.payment_status = 'paid' THEN mi.transport_chargeable_gross ELSE 0 END), 0) AS paid_trans_gross
    FROM monthly_invoices mi, bounds
    WHERE mi.year * 12 + mi.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY mi.year, mi.month
  ),
  exp AS (
    SELECT e.year, e.month, COALESCE(SUM(e.amount), 0) AS expenses_total
    FROM expenses e, bounds
    WHERE e.year * 12 + e.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY e.year, e.month
  )
  SELECT
    COALESCE(inv.year,  exp.year)  AS year,
    COALESCE(inv.month, exp.month) AS month,
    COALESCE(inv.att_net, 0),
    COALESCE(inv.att_gross, 0),
    COALESCE(inv.trans_net, 0),
    COALESCE(inv.trans_gross, 0),
    COALESCE(inv.paid_att_net, 0),
    COALESCE(inv.paid_att_gross, 0),
    COALESCE(inv.paid_trans_net, 0),
    COALESCE(inv.paid_trans_gross, 0),
    COALESCE(exp.expenses_total, 0)
  FROM inv
  FULL OUTER JOIN exp ON inv.year = exp.year AND inv.month = exp.month
  ORDER BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_finance_series(INT, INT, INT, INT) TO authenticated;
