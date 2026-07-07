-- 042_charity_exclusion.sql
-- Exclude charity clients (clients.is_charity) from all money aggregators.
-- Attendance stats (get_attendance_stats) are intentionally NOT filtered:
-- charity clients still count in attendance metrics.
-- Each function below is its live definition + an `AND NOT c.is_charity` filter.

-- 1. Dashboard finance series (live/previsto CTE) -------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_finance_series(p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer)
 RETURNS TABLE(year integer, month integer, att_net numeric, att_gross numeric, trans_net numeric, trans_gross numeric, paid_att_net numeric, paid_att_gross numeric, paid_trans_net numeric, paid_trans_gross numeric, expenses_total numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH bounds AS (
    SELECT p_from_year * 12 + p_from_month AS lo,
           p_to_year   * 12 + p_to_month   AS hi
  ),
  months AS (
    SELECT (i / 12) AS year, (i % 12) AS month
    FROM bounds, generate_series(bounds.lo, bounds.hi) AS i
  ),
  live AS (
    SELECT m.year, m.month,
      COALESCE(SUM((b->>'attendanceChargeableNet')::numeric), 0)   AS att_net,
      COALESCE(SUM((b->>'attendanceChargeableGross')::numeric), 0) AS att_gross,
      COALESCE(SUM((b->>'transportChargeableNet')::numeric), 0)    AS trans_net,
      COALESCE(SUM((b->>'transportChargeableGross')::numeric), 0)  AS trans_gross
    FROM months m
    JOIN clients c
      ON c.deleted_at IS NULL
     AND NOT c.is_charity
     AND date_trunc('month', c.start_date) <= make_date(m.year, m.month + 1, 1)
    CROSS JOIN LATERAL calculate_month_billing(c.id, m.year, m.month) AS b
    WHERE (b->>'error') IS NULL
    GROUP BY m.year, m.month
  ),
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
$function$;

-- 2. Collection panel -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(client_id uuid, attendance_net numeric, attendance_gross numeric, transport_net numeric, transport_gross numeric, payment_status text, invoice_status text, paid_amount numeric, paid_date date, invoice_number text, invoiced_at timestamp with time zone, invoice_date date, invoiced_amount numeric)
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
    AND NOT c.is_charity
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

-- 3. Billing breakdown ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_billing_breakdown_rows(p_year integer, p_month integer)
 RETURNS TABLE(client_id uuid, frequency integer, schedule text, cognitive_level text, has_transport boolean, is_deactivated boolean, attendance_net numeric, attendance_gross numeric, transport_net numeric, transport_gross numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    c.id, cp.frequency, cp.schedule, c.cognitive_level,
    cp.has_transport, (c.deleted_at IS NOT NULL),
    (b->>'attendanceChargeableNet')::numeric,
    (b->>'attendanceChargeableGross')::numeric,
    (b->>'transportChargeableNet')::numeric,
    (b->>'transportChargeableGross')::numeric
  FROM clients c
  LEFT JOIN LATERAL (
    SELECT cp.frequency, cp.schedule, cp.has_transport
    FROM client_plans cp
    WHERE cp.client_id = c.id AND cp.effective_from <= make_date(p_year, p_month + 1, 1)
    ORDER BY cp.effective_from DESC LIMIT 1
  ) cp ON true
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND NOT c.is_charity
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

-- 4. Churn board (exclude charity from provisioning and from results) ------
CREATE OR REPLACE FUNCTION public.get_churn_board()
 RETURNS TABLE(client_id uuid, first_name text, last_name text, cognitive_level text, frequency integer, schedule text, stage text, reason text, deactivation_date date, mrr_snapshot numeric, assigned_to uuid, assigned_name text, days_since integer, note_count integer, is_currently_inactive boolean, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  INSERT INTO churn_followups (client_id, stage, reason, deactivation_date, mrr_snapshot)
  SELECT
    c.id,
    CASE WHEN c.deactivation_reason = 'death' THEN 'lost' ELSE 'new' END,
    c.deactivation_reason,
    c.deactivation_date,
    (SELECT pp.price_gross
       FROM client_plans cp2
       JOIN plan_pricing pp ON pp.frequency = cp2.frequency AND pp.schedule = cp2.schedule
      WHERE cp2.client_id = c.id
        AND cp2.effective_from <= COALESCE(c.deactivation_date, CURRENT_DATE)
      ORDER BY cp2.effective_from DESC LIMIT 1)
  FROM clients c
  WHERE c.deleted_at IS NOT NULL
    AND NOT c.is_charity
    AND NOT EXISTS (SELECT 1 FROM churn_followups f WHERE f.client_id = c.id)
  ON CONFLICT (client_id) DO NOTHING;

  RETURN QUERY
  SELECT
    f.client_id, c.first_name, c.last_name, c.cognitive_level,
    cp.frequency, cp.schedule,
    f.stage, f.reason, f.deactivation_date, f.mrr_snapshot,
    f.assigned_to, u.name,
    (CURRENT_DATE - f.deactivation_date)::int,
    (SELECT COUNT(*)::int FROM churn_followup_notes n WHERE n.client_id = f.client_id),
    (c.deleted_at IS NOT NULL),
    f.updated_at
  FROM churn_followups f
  JOIN clients c ON c.id = f.client_id
  LEFT JOIN LATERAL (
    SELECT cp.frequency, cp.schedule
    FROM client_plans cp
    WHERE cp.client_id = f.client_id
      AND cp.effective_from <= COALESCE(f.deactivation_date, CURRENT_DATE)
    ORDER BY cp.effective_from DESC LIMIT 1
  ) cp ON true
  LEFT JOIN users u ON u.id = f.assigned_to
  WHERE NOT c.is_charity
  ORDER BY f.deactivation_date DESC NULLS LAST;
END;
$function$;
