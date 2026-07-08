-- 046_remove_recovered_stage.sql
-- La columna "Recuperado" del kanban de bajas es redundante: arrastrar ahí ya reactivaba
-- al cliente (se da de alta), y un cliente reactivado no tiene sentido en el seguimiento
-- de bajas. Se elimina la etapa 'recovered' y el tablero pasa a mostrar SOLO clientes que
-- siguen inactivos. La reactivación queda exclusivamente en el botón "Reactivar cliente"
-- del modal de la tarjeta.

-- 1. Limpiar filas legacy con stage 'recovered' (clientes ya reactivados que quedaron colgados).
UPDATE churn_followups SET stage = 'new' WHERE stage = 'recovered';

-- 2. Quitar 'recovered' del CHECK de stages.
ALTER TABLE churn_followups DROP CONSTRAINT IF EXISTS churn_followups_stage_check;
ALTER TABLE churn_followups ADD CONSTRAINT churn_followups_stage_check
  CHECK (stage IN ('new','contacting','negotiating','temporary_pause','lost'));

-- 3. get_churn_board ahora filtra a clientes que siguen inactivos (deleted_at IS NOT NULL),
--    de modo que al reactivar desde el modal la tarjeta desaparece del tablero.
--    (Idéntica a la versión de la mig 044 salvo el WHERE en el RETURN QUERY.)
CREATE OR REPLACE FUNCTION public.get_churn_board()
 RETURNS TABLE(client_id uuid, first_name text, last_name text, cognitive_level text, frequency integer, schedule text, stage text, reason text, deactivation_date date, mrr_snapshot numeric, assigned_to uuid, assigned_name text, days_since integer, note_count integer, is_currently_inactive boolean, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  WHERE c.deleted_at IS NOT NULL
  ORDER BY f.deactivation_date DESC NULLS LAST;
END;
$function$;
