-- 053_temporary_pause_not_a_reason.sql
-- "Pausa temporal" es una etapa del kanban de bajas (churn_followups.stage), no un motivo
-- de baja: un cliente en esa columna puede tener CUALQUIER motivo real de fondo, y el
-- equipo la mueve manualmente ahí mientras espera a ver si la familia retoma. El motivo
-- "temporary_pause_not_resumed" (migración 044) duplicaba ese concepto en deactivation_reasons
-- y forzaba el stage inicial vía get_churn_board(). Se confirma 0 uso en clients/churn_followups
-- antes de este cambio, así que se elimina sin necesidad de remapear datos existentes.

-- 1. Quitar el motivo de la tabla gestionable.
DELETE FROM deactivation_reasons WHERE key = 'temporary_pause_not_resumed';

-- 2. get_churn_board(): sacar el CASE que arrancaba el stage en 'temporary_pause' según motivo.
--    Idéntica a la versión de la mig 046 salvo esa rama del CASE.
CREATE OR REPLACE FUNCTION public.get_churn_board()
 RETURNS TABLE(client_id uuid, first_name text, last_name text, cognitive_level text, frequency integer, schedule text, stage text, reason text, deactivation_date date, mrr_snapshot numeric, assigned_to uuid, assigned_name text, days_since integer, note_count integer, is_currently_inactive boolean, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  -- Provisión lazy: crear tarjeta para cada baja que aún no la tenga.
  -- death => arranca en 'lost' (sin pipeline de recuperación); el resto en 'new'.
  -- "Pausa temporal" ya no se infiere del motivo: el equipo mueve la tarjeta ahí a mano.
  INSERT INTO churn_followups (client_id, stage, reason, deactivation_date, mrr_snapshot)
  SELECT
    c.id,
    CASE
      WHEN c.deactivation_reason = 'death' THEN 'lost'
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
