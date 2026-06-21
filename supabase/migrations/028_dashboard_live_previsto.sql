-- 028_dashboard_live_previsto.sql
-- "Previsto" / pending-to-collect must derive from each client's PLAN, not from the
-- monthly_invoices snapshot (which stays 0 until an invoice is emitted or a payment is
-- recorded). Payment happens BEFORE invoicing in this business, so the dashboard cannot
-- depend on emission to show expected income.
--
-- This migration:
--   1. Rewrites get_dashboard_finance_series so the "previsto" columns (att_*/trans_*)
--      are computed LIVE via calculate_month_billing over active clients per month.
--      "Cobrado" (paid_*) stays snapshot-based (payments are snapshotted when collected).
--   2. Adds get_month_collection_panel for the per-client collection panel (live amounts).
-- month is 0-indexed. Both are SECURITY INVOKER → RLS on base tables applies;
-- calculate_month_billing is SECURITY DEFINER so pricing/attendance reads work.

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
  months AS (
    SELECT (i / 12) AS year, (i % 12) AS month
    FROM bounds, generate_series(bounds.lo, bounds.hi) AS i
  ),
  -- Previsto: live, plan-derived, over clients active & started by each month.
  live AS (
    SELECT m.year, m.month,
      COALESCE(SUM((b->>'attendanceChargeableNet')::numeric), 0)   AS att_net,
      COALESCE(SUM((b->>'attendanceChargeableGross')::numeric), 0) AS att_gross,
      COALESCE(SUM((b->>'transportChargeableNet')::numeric), 0)    AS trans_net,
      COALESCE(SUM((b->>'transportChargeableGross')::numeric), 0)  AS trans_gross
    FROM months m
    JOIN clients c
      ON c.deleted_at IS NULL
     AND date_trunc('month', c.start_date) <= make_date(m.year, m.month + 1, 1)
    CROSS JOIN LATERAL calculate_month_billing(c.id, m.year, m.month) AS b
    WHERE (b->>'error') IS NULL
    GROUP BY m.year, m.month
  ),
  -- Cobrado: snapshot of paid invoices (payments are written when collected).
  paid AS (
    SELECT mi.year, mi.month,
      COALESCE(SUM(mi.attendance_chargeable_net), 0)   AS paid_att_net,
      COALESCE(SUM(mi.attendance_chargeable_gross), 0) AS paid_att_gross,
      COALESCE(SUM(mi.transport_chargeable_net), 0)    AS paid_trans_net,
      COALESCE(SUM(mi.transport_chargeable_gross), 0)  AS paid_trans_gross
    FROM monthly_invoices mi, bounds
    WHERE mi.payment_status = 'paid'
      AND mi.year * 12 + mi.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY mi.year, mi.month
  ),
  exp AS (
    SELECT e.year, e.month, COALESCE(SUM(e.amount), 0) AS expenses_total
    FROM expenses e, bounds
    WHERE e.year * 12 + e.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY e.year, e.month
  )
  SELECT
    m.year,
    m.month,
    COALESCE(live.att_net, 0),
    COALESCE(live.att_gross, 0),
    COALESCE(live.trans_net, 0),
    COALESCE(live.trans_gross, 0),
    COALESCE(paid.paid_att_net, 0),
    COALESCE(paid.paid_att_gross, 0),
    COALESCE(paid.paid_trans_net, 0),
    COALESCE(paid.paid_trans_gross, 0),
    COALESCE(exp.expenses_total, 0)
  FROM months m
  LEFT JOIN live ON live.year = m.year AND live.month = m.month
  LEFT JOIN paid ON paid.year = m.year AND paid.month = m.month
  LEFT JOIN exp  ON exp.year  = m.year AND exp.month  = m.month
  ORDER BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_finance_series(INT, INT, INT, INT) TO authenticated;

-- Per-client rows for the dashboard collection panel: live plan-derived amounts +
-- payment/invoice status from the snapshot (defaults to 'pending' when no row exists).
CREATE OR REPLACE FUNCTION get_month_collection_panel(
  p_year  INT,
  p_month INT
)
RETURNS TABLE (
  client_id        UUID,
  attendance_net   NUMERIC,
  attendance_gross NUMERIC,
  transport_net    NUMERIC,
  transport_gross  NUMERIC,
  payment_status   TEXT,
  invoice_status   TEXT,
  paid_amount      NUMERIC
)
LANGUAGE sql
STABLE
AS $$
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
  WHERE c.deleted_at IS NULL
    AND date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND (b->>'error') IS NULL;
$$;

GRANT EXECUTE ON FUNCTION get_month_collection_panel(INT, INT) TO authenticated;
