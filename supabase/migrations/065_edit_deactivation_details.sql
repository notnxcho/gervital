-- 065_edit_deactivation_details.sql
-- Permitir editar el motivo de baja (discreto) y su nota desde el modal de la tarjeta en
-- /bajas. Hasta ahora el motivo se fijaba solo al dar de baja (deactivate_client, mig 045) y
-- la nota (clients.deactivation_notes) no se mostraba ni se podía editar en ningún lado.
--
-- 1. RPC de edición: valida igual que deactivate_client (motivo activo; nota obligatoria si
--    el motivo es 'other') y mantiene sincronizadas clients + churn_followups.reason (la
--    tarjeta del tablero lee churn_followups.reason vía get_churn_board). NO toca el stage:
--    la etapa del kanban se maneja a mano, cambiar el motivo no debe mover la tarjeta.
-- 2. get_churn_board(): agrega deactivation_notes al retorno para que la nota viaje con la
--    tarjeta (idéntica a la versión de la mig 053 salvo la columna nueva).

CREATE OR REPLACE FUNCTION public.update_deactivation_details(
  p_client_id uuid,
  p_reason text,
  p_notes text
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE
  v_clean_notes TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM deactivation_reasons WHERE key = p_reason AND is_active
  ) THEN
    RAISE EXCEPTION 'Invalid deactivation reason: %', p_reason;
  END IF;

  v_clean_notes := NULLIF(trim(coalesce(p_notes, '')), '');

  IF p_reason = 'other' AND v_clean_notes IS NULL THEN
    RAISE EXCEPTION 'Notes required when reason is "other"';
  END IF;

  UPDATE clients
     SET deactivation_reason = p_reason,
         deactivation_notes = v_clean_notes,
         updated_at = NOW()
   WHERE id = p_client_id
     AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or not deactivated';
  END IF;

  -- Mantener el motivo del tablero en sincronía (la tarjeta lee churn_followups.reason).
  UPDATE churn_followups
     SET reason = p_reason
   WHERE client_id = p_client_id;

  RETURN p_client_id;
END;
$function$;

-- El retorno cambia (columna deactivation_notes nueva), así que hay que DROP: Postgres no
-- permite alterar el tipo de retorno de una función existente con CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.get_churn_board();
CREATE OR REPLACE FUNCTION public.get_churn_board()
 RETURNS TABLE(client_id uuid, first_name text, last_name text, cognitive_level text, frequency integer, schedule text, stage text, reason text, deactivation_notes text, deactivation_date date, mrr_snapshot numeric, assigned_to uuid, assigned_name text, days_since integer, note_count integer, is_currently_inactive boolean, updated_at timestamp with time zone)
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
    f.stage, f.reason, c.deactivation_notes, f.deactivation_date, f.mrr_snapshot,
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
