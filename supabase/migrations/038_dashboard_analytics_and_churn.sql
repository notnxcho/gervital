-- 038_dashboard_analytics_and_churn.sql
-- Dashboard analítico (asistencia + mix de facturación por segmento) y módulo de
-- seguimiento de bajas (kanban mini-CRM).
--
-- Contiene:
--   1. get_attendance_stats     — asistencia agregada por mes × plan × horario × tier
--   2. get_billing_breakdown_rows — facturación por cliente con su plan/horario/tier (para pivotear)
--   3. churn_followups + churn_followup_notes (+ RLS + trigger updated_at)
--   4. get_churn_board          — arma el tablero de bajas, auto-provisiona tarjetas

-- ============================================================
-- 1. Estadísticas de asistencia por segmento
-- ============================================================
-- Convención de mes: 0-based (0-11), igual que get_month_collection_panel.
-- La tasa de asistencia se computa en el frontend: (attended + recovery) /
-- (attended + recovery + absent). Vacation y scheduled se excluyen del denominador.
DROP FUNCTION IF EXISTS public.get_attendance_stats(integer, integer, integer, integer);
CREATE FUNCTION public.get_attendance_stats(
  p_from_year integer, p_from_month integer,
  p_to_year integer, p_to_month integer
)
RETURNS TABLE(
  year integer, month integer,
  frequency integer, schedule text, cognitive_level text,
  attended integer, absent_justified integer, absent_unjustified integer,
  recovery integer, vacation integer, scheduled integer
)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    EXTRACT(YEAR FROM ar.date)::int AS year,
    (EXTRACT(MONTH FROM ar.date)::int - 1) AS month,
    cp.frequency,
    cp.schedule,
    c.cognitive_level,
    COUNT(*) FILTER (WHERE ar.status = 'attended')::int,
    COUNT(*) FILTER (WHERE ar.status = 'absent' AND ar.is_justified IS TRUE)::int,
    COUNT(*) FILTER (WHERE ar.status = 'absent' AND ar.is_justified IS NOT TRUE)::int,
    COUNT(*) FILTER (WHERE ar.status = 'recovery')::int,
    COUNT(*) FILTER (WHERE ar.status = 'vacation')::int,
    COUNT(*) FILTER (WHERE ar.status = 'scheduled')::int
  FROM attendance_records ar
  JOIN clients c ON c.id = ar.client_id
  -- plan vigente en el mes del registro (client_plans es versionado por effective_from)
  LEFT JOIN LATERAL (
    SELECT cp.frequency, cp.schedule
    FROM client_plans cp
    WHERE cp.client_id = c.id AND cp.effective_from <= date_trunc('month', ar.date)::date
    ORDER BY cp.effective_from DESC
    LIMIT 1
  ) cp ON true
  WHERE ar.date >= make_date(p_from_year, p_from_month + 1, 1)
    AND ar.date < (make_date(p_to_year, p_to_month + 1, 1) + interval '1 month')
  GROUP BY 1, 2, 3, 4, 5;
$function$;

-- ============================================================
-- 2. Filas de facturación por cliente (para breakdown por dimensión)
-- ============================================================
-- Reusa calculate_month_billing (live "previsto") y adjunta plan/horario/tier para
-- que el frontend pivotee por la dimensión elegida en el sub-tab.
DROP FUNCTION IF EXISTS public.get_billing_breakdown_rows(integer, integer);
CREATE FUNCTION public.get_billing_breakdown_rows(p_year integer, p_month integer)
RETURNS TABLE(
  client_id uuid,
  frequency integer, schedule text, cognitive_level text,
  has_transport boolean, is_deactivated boolean,
  attendance_net numeric, attendance_gross numeric,
  transport_net numeric, transport_gross numeric
)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    c.id,
    cp.frequency, cp.schedule, c.cognitive_level,
    cp.has_transport,
    (c.deleted_at IS NOT NULL),
    (b->>'attendanceChargeableNet')::numeric,
    (b->>'attendanceChargeableGross')::numeric,
    (b->>'transportChargeableNet')::numeric,
    (b->>'transportChargeableGross')::numeric
  FROM clients c
  -- plan vigente en el mes consultado
  LEFT JOIN LATERAL (
    SELECT cp.frequency, cp.schedule, cp.has_transport
    FROM client_plans cp
    WHERE cp.client_id = c.id AND cp.effective_from <= make_date(p_year, p_month + 1, 1)
    ORDER BY cp.effective_from DESC
    LIMIT 1
  ) cp ON true
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

-- ============================================================
-- 3. Tablas del módulo de seguimiento de bajas
-- ============================================================
-- Una fila por cliente que alguna vez fue dado de baja. Persiste aunque el cliente
-- sea reactivado (para conservar la columna "Recuperado"). Los campos reason /
-- deactivation_date / mrr_snapshot se capturan al provisionar (ver get_churn_board)
-- para no perder contexto tras una reactivación.
CREATE TABLE IF NOT EXISTS churn_followups (
  client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new', 'contacting', 'negotiating', 'recovered', 'lost')),
  reason text,
  deactivation_date date,
  mrr_snapshot numeric,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS churn_followup_notes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churn_notes_client ON churn_followup_notes(client_id);

-- updated_at fresco en cada UPDATE (misma convención que 006/037)
DROP TRIGGER IF EXISTS update_churn_followups_updated_at ON churn_followups;
CREATE TRIGGER update_churn_followups_updated_at
  BEFORE UPDATE ON churn_followups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: el módulo es para todo el equipo (todos los roles autenticados).
ALTER TABLE churn_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE churn_followup_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS churn_followups_all ON churn_followups;
CREATE POLICY churn_followups_all ON churn_followups
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS churn_notes_all ON churn_followup_notes;
CREATE POLICY churn_notes_all ON churn_followup_notes
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 4. Tablero de bajas (arma + auto-provisiona)
-- ============================================================
-- SECURITY DEFINER: necesita snapshotear el MRR desde plan_pricing (cuya lectura está
-- restringida a admin/superadmin por RLS) de forma uniforme para cualquier rol, y
-- provisionar tarjetas de forma confiable independientemente de quién abra el tablero.
DROP FUNCTION IF EXISTS public.get_churn_board();
CREATE FUNCTION public.get_churn_board()
RETURNS TABLE(
  client_id uuid, first_name text, last_name text, cognitive_level text,
  frequency integer, schedule text,
  stage text, reason text, deactivation_date date, mrr_snapshot numeric,
  assigned_to uuid, assigned_name text,
  days_since integer, note_count integer, is_currently_inactive boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
BEGIN
  -- Provisión lazy: crear tarjeta para cada baja que aún no la tenga.
  -- death => arranca en 'lost' (sin pipeline de recuperación); el resto en 'new'.
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
      ORDER BY cp2.effective_from DESC
      LIMIT 1)
  FROM clients c
  WHERE c.deleted_at IS NOT NULL
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
  -- plan vigente al momento de la baja (para mostrar plan/horario en la tarjeta)
  LEFT JOIN LATERAL (
    SELECT cp.frequency, cp.schedule
    FROM client_plans cp
    WHERE cp.client_id = f.client_id
      AND cp.effective_from <= COALESCE(f.deactivation_date, CURRENT_DATE)
    ORDER BY cp.effective_from DESC
    LIMIT 1
  ) cp ON true
  LEFT JOIN users u ON u.id = f.assigned_to
  ORDER BY f.deactivation_date DESC NULLS LAST;
END;
$function$;
