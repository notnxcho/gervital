-- 044_deactivation_reasons.sql
-- Motivos de baja gestionables + etapa "Pausa temporal" en el kanban de churn.

-- 1. Tabla de motivos
CREATE TABLE IF NOT EXISTS deactivation_reasons (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text,
  color       text NOT NULL DEFAULT '#64748b',
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_deactivation_reasons_updated_at ON deactivation_reasons;
CREATE TRIGGER update_deactivation_reasons_updated_at
  BEFORE UPDATE ON deactivation_reasons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. RLS: lectura para todos; escritura solo superadmin
ALTER TABLE deactivation_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deactivation_reasons_select ON deactivation_reasons;
CREATE POLICY deactivation_reasons_select ON deactivation_reasons
  FOR SELECT USING (true);

DROP POLICY IF EXISTS deactivation_reasons_write ON deactivation_reasons;
CREATE POLICY deactivation_reasons_write ON deactivation_reasons
  FOR ALL USING (is_superadmin()) WITH CHECK (is_superadmin());

-- 3. Seed de los 8 motivos
INSERT INTO deactivation_reasons (key, label, description, color, sort_order, is_system) VALUES
  ('death', 'Fallecimiento', 'Fallecimiento del usuario.', '#64748b', 1, true),
  ('institutionalization', 'Institucionalización', 'El usuario pasa a un residencial o cuidado permanente fuera del hogar.', '#7c3aed', 2, false),
  ('health_decline', 'Deterioro de salud', 'Agrupa tanto el evento agudo (fractura, cirugía, internación) como el deterioro progresivo.', '#dc2626', 3, false),
  ('adaptation_motivation', 'Adaptación / motivación', 'Dificultad de adaptación al grupo/centro y motivos anímicos. Depresión, angustia, desgano o rechazo a participar, sin que medie necesariamente una causa médica aguda.', '#e11d48', 4, false),
  ('financial', 'Motivo económico', 'La familia no puede sostener el costo.', '#2563eb', 5, false),
  ('logistical_family', 'Motivo logístico-familiar', 'Viajes, mudanzas, conflictos de agenda laboral o de quien traslada al usuario, pausas "de vacaciones" que nunca se retoman.', '#0891b2', 6, false),
  ('temporary_pause_not_resumed', 'Pausa temporal no retomada', 'El usuario o su familia avisa que se ausentará por un período determinado (vacaciones, viaje, un mes puntual) con intención declarada de volver en una fecha específica, pero luego no se reintegra ni comunica un motivo concreto de baja.', '#d97706', 7, true),
  ('other', 'Otro / sin especificar', 'Motivo no contemplado o sin especificar.', '#94a3b8', 8, true)
ON CONFLICT (key) DO NOTHING;

-- 4/5 reordenados respecto al brief: el CHECK viejo de clients solo permite los
-- keys legacy (no incluye 'institutionalization' ni los demás keys nuevos), así que
-- hay que quitarlo ANTES de remapear datos o el UPDATE viola el constraint.
-- Los valores válidos ahora viven en deactivation_reasons.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_deactivation_reason_check;

-- 4. Mapeo de datos viejos → nuevos keys
UPDATE clients SET deactivation_reason = 'institutionalization'  WHERE deactivation_reason = 'transfer_to_other_center';
UPDATE clients SET deactivation_reason = 'logistical_family'     WHERE deactivation_reason = 'relocation';
UPDATE clients SET deactivation_reason = 'other'                 WHERE deactivation_reason = 'family_decision';
UPDATE clients SET deactivation_reason = 'adaptation_motivation' WHERE deactivation_reason = 'service_dissatisfaction';

UPDATE churn_followups SET reason = 'institutionalization'  WHERE reason = 'transfer_to_other_center';
UPDATE churn_followups SET reason = 'logistical_family'     WHERE reason = 'relocation';
UPDATE churn_followups SET reason = 'other'                 WHERE reason = 'family_decision';
UPDATE churn_followups SET reason = 'adaptation_motivation' WHERE reason = 'service_dissatisfaction';

-- 6. Nueva etapa temporary_pause en churn_followups.stage
ALTER TABLE churn_followups DROP CONSTRAINT IF EXISTS churn_followups_stage_check;
ALTER TABLE churn_followups ADD CONSTRAINT churn_followups_stage_check
  CHECK (stage IN ('new','contacting','negotiating','temporary_pause','recovered','lost'));

-- ============================================================
-- 7. get_churn_board(): auto-provisión ahora también mapea
--    temporary_pause_not_resumed -> etapa temporary_pause.
--    Copia íntegra de la función definida en 038, con solo el CASE
--    del stage inicial modificado. Resto idéntico (SECURITY DEFINER,
--    returns, joins).
-- ============================================================
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
  -- death => arranca en 'lost' (sin pipeline de recuperación);
  -- temporary_pause_not_resumed => arranca en 'temporary_pause'; el resto en 'new'.
  INSERT INTO churn_followups (client_id, stage, reason, deactivation_date, mrr_snapshot)
  SELECT
    c.id,
    CASE
      WHEN c.deactivation_reason = 'death' THEN 'lost'
      WHEN c.deactivation_reason = 'temporary_pause_not_resumed' THEN 'temporary_pause'
      ELSE 'new'
    END,
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
