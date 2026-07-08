-- 045_deactivate_client_dynamic_reason.sql
-- Los motivos de baja pasaron a ser gestionables (tabla deactivation_reasons, migración 044).
-- deactivate_client (definido en 030) todavía validaba el motivo contra una lista hardcodeada
-- de keys VIEJOS, por lo que dar de baja con un motivo nuevo (ej. adaptation_motivation)
-- fallaba con "Invalid deactivation reason". Se reemplaza la validación estática por una
-- contra la tabla: el motivo debe existir y estar activo.

CREATE OR REPLACE FUNCTION public.deactivate_client(
  p_client_id uuid,
  p_reason text,
  p_notes text,
  p_user_id uuid,
  p_deactivation_date date DEFAULT CURRENT_DATE
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
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
     SET deleted_at = NOW(),
         deactivation_date = COALESCE(p_deactivation_date, CURRENT_DATE),
         deactivation_reason = p_reason,
         deactivation_notes = v_clean_notes,
         deactivated_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or already deactivated';
  END IF;

  RETURN p_client_id;
END;
$function$;
