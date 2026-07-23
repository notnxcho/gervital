-- 070_client_inactivity_periods.sql
-- Fuente de verdad de los gaps de inactividad de un cliente.
-- clients.deactivation_date / deleted_at se conservan como caché de estado actual.

-- ── 1. Tabla ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_inactivity_periods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  from_date      date NOT NULL,             -- primer día inactivo (corte exclusivo)
  to_date        date,                      -- primer día activo de nuevo; NULL = abierto
  reason         text,
  notes          text,
  deactivated_by uuid,
  reactivated_by uuid,
  reactivated_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cip_dates_check CHECK (to_date IS NULL OR to_date > from_date)
);

CREATE INDEX IF NOT EXISTS idx_cip_client_from ON client_inactivity_periods(client_id, from_date);
-- A lo sumo un período abierto por cliente
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cip_open_per_client
  ON client_inactivity_periods(client_id) WHERE to_date IS NULL;

-- ── 2. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE client_inactivity_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cip_select_all ON client_inactivity_periods;
CREATE POLICY cip_select_all ON client_inactivity_periods
  FOR SELECT USING (true);
-- Escrituras solo vía RPCs SECURITY DEFINER (no policies de INSERT/UPDATE).

-- ── 3. Backfill: clientes actualmente dados de baja → período abierto ───────
INSERT INTO client_inactivity_periods (client_id, from_date, to_date, reason, notes, deactivated_by)
SELECT c.id, c.deactivation_date, NULL, c.deactivation_reason, c.deactivation_notes, c.deactivated_by
FROM clients c
WHERE c.deleted_at IS NOT NULL
  AND c.deactivation_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM client_inactivity_periods p
    WHERE p.client_id = c.id AND p.to_date IS NULL
  );

-- ── 4. deactivate_client: además, abre un período de inactividad ────────────
-- (Base: migración 045. Se recrea completa para mantener una sola definición viva.)
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
  v_date DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM deactivation_reasons WHERE key = p_reason AND is_active) THEN
    RAISE EXCEPTION 'Invalid deactivation reason: %', p_reason;
  END IF;

  v_clean_notes := NULLIF(trim(coalesce(p_notes, '')), '');
  IF p_reason = 'other' AND v_clean_notes IS NULL THEN
    RAISE EXCEPTION 'Notes required when reason is "other"';
  END IF;

  v_date := COALESCE(p_deactivation_date, CURRENT_DATE);

  UPDATE clients
     SET deleted_at = NOW(),
         deactivation_date = v_date,
         deactivation_reason = p_reason,
         deactivation_notes = v_clean_notes,
         deactivated_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_client_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or already deactivated';
  END IF;

  -- Abre el período (defensivo: elimina cualquier abierto huérfano antes)
  DELETE FROM client_inactivity_periods WHERE client_id = p_client_id AND to_date IS NULL;
  INSERT INTO client_inactivity_periods (client_id, from_date, to_date, reason, notes, deactivated_by)
  VALUES (p_client_id, v_date, NULL, p_reason, v_clean_notes, p_user_id);

  RETURN p_client_id;
END;
$function$;

-- ── 5. reactivate_client: fecha de reintegro + plan opcional ────────────────
-- DROP de la firma vieja (p_client_id) para evitar "function is not unique".
DROP FUNCTION IF EXISTS public.reactivate_client(uuid);

CREATE OR REPLACE FUNCTION public.reactivate_client(
  p_client_id uuid,
  p_reactivation_date date,
  p_frequency integer DEFAULT NULL,
  p_schedule text DEFAULT NULL,
  p_has_transport boolean DEFAULT NULL,
  p_assigned_days text[] DEFAULT NULL,
  p_distance_range text DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_from DATE;
BEGIN
  IF p_reactivation_date IS NULL THEN
    RAISE EXCEPTION 'Reactivation date required';
  END IF;

  -- Toma el período abierto (baja vigente)
  SELECT from_date INTO v_from
  FROM client_inactivity_periods
  WHERE client_id = p_client_id AND to_date IS NULL;

  IF v_from IS NULL THEN
    RAISE EXCEPTION 'Client not found or not deactivated';
  END IF;

  IF p_reactivation_date <= v_from THEN
    RAISE EXCEPTION 'Reactivation date must be after deactivation date (%)', v_from;
  END IF;

  -- Cierra el período
  UPDATE client_inactivity_periods
     SET to_date = p_reactivation_date,
         reactivated_at = NOW()
   WHERE client_id = p_client_id AND to_date IS NULL;

  -- Estado actual: activo ya si el reintegro es hoy o pasado; si es futuro, sigue baja.
  IF p_reactivation_date <= CURRENT_DATE THEN
    UPDATE clients
       SET deleted_at = NULL,
           deactivation_date = NULL,
           deactivation_reason = NULL,
           deactivation_notes = NULL,
           deactivated_by = NULL,
           updated_at = NOW()
     WHERE id = p_client_id;
  END IF;

  -- Plan opcional: solo si se pasaron los campos. set_client_plan_version es idempotente
  -- (upsert por mes) y trunca effective_from al inicio de mes.
  IF p_frequency IS NOT NULL AND p_schedule IS NOT NULL AND p_assigned_days IS NOT NULL THEN
    PERFORM set_client_plan_version(
      p_client_id,
      date_trunc('month', p_reactivation_date)::date,
      p_frequency,
      p_schedule,
      COALESCE(p_has_transport, false),
      p_assigned_days,
      p_distance_range,
      NULL
    );
  END IF;

  RETURN p_client_id;
END;
$function$;

-- ── 6. apply_due_reactivations: self-heal de reintegros futuros vencidos ─────
-- No hay cron. Voltea a activo cualquier cliente todavía marcado dado de baja
-- cuyo período abierto NO exista pero cuyo reintegro futuro ya llegó. Idempotente.
CREATE OR REPLACE FUNCTION public.apply_due_reactivations()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH due AS (
    SELECT c.id
    FROM clients c
    WHERE c.deleted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM client_inactivity_periods p
        WHERE p.client_id = c.id AND p.to_date IS NULL
      )
      AND EXISTS (
        SELECT 1 FROM client_inactivity_periods p
        WHERE p.client_id = c.id AND p.to_date IS NOT NULL AND p.to_date <= CURRENT_DATE
      )
  ), upd AS (
    UPDATE clients c
       SET deleted_at = NULL,
           deactivation_date = NULL,
           deactivation_reason = NULL,
           deactivation_notes = NULL,
           deactivated_by = NULL,
           updated_at = NOW()
     FROM due
    WHERE c.id = due.id
    RETURNING c.id
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;
