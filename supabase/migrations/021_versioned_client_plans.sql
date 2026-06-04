-- 021_versioned_client_plans.sql
-- Plan del cliente versionado por vigencia mensual (no retroactivo).
-- client_plans pasa de 1 fila/cliente a 1 fila/período de vigencia.

-- ── Schema ──────────────────────────────────────────────────────────────────
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS effective_from date;
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS distance_range text;
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS created_by text;

-- Backfill: versión 1 = 1° del mes de ingreso; distancia desde la dirección actual.
UPDATE client_plans cp
SET effective_from = date_trunc('month', c.start_date)::date
FROM clients c
WHERE cp.client_id = c.id AND cp.effective_from IS NULL;

UPDATE client_plans cp
SET distance_range = a.distance_range
FROM client_addresses a
WHERE cp.client_id = a.client_id AND cp.distance_range IS NULL;

ALTER TABLE client_plans ALTER COLUMN effective_from SET NOT NULL;

-- Reemplazar UNIQUE(client_id) por UNIQUE(client_id, effective_from).
-- Acotado a la constraint que sea exactamente UNIQUE (client_id) (cualquier nombre),
-- para no barrer otras constraints en re-aplicaciones del archivo.
DO $$
DECLARE v_con text;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'client_plans'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (client_id)'
  LOOP
    EXECUTE format('ALTER TABLE client_plans DROP CONSTRAINT %I', v_con);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'client_plans'::regclass
      AND conname = 'client_plans_client_effective_uniq'
  ) THEN
    ALTER TABLE client_plans
      ADD CONSTRAINT client_plans_client_effective_uniq UNIQUE (client_id, effective_from);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_plans_client_effective
  ON client_plans (client_id, effective_from DESC);

-- ── set_client_plan_version ───────────────────────────────────────────────────
-- Crea o actualiza la versión de plan vigente desde el mes de p_effective_from.
CREATE OR REPLACE FUNCTION public.set_client_plan_version(
  p_client_id uuid,
  p_effective_from date,
  p_frequency integer,
  p_schedule text,
  p_has_transport boolean,
  p_assigned_days text[],
  p_distance_range text DEFAULT NULL,
  p_created_by text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO client_plans (
    client_id, effective_from, frequency, schedule,
    has_transport, assigned_days, distance_range, created_by
  ) VALUES (
    p_client_id, date_trunc('month', p_effective_from)::date, p_frequency, p_schedule,
    COALESCE(p_has_transport, FALSE), COALESCE(p_assigned_days, '{}'), p_distance_range, p_created_by
  )
  ON CONFLICT (client_id, effective_from) DO UPDATE SET
    frequency     = EXCLUDED.frequency,
    schedule      = EXCLUDED.schedule,
    has_transport = EXCLUDED.has_transport,
    assigned_days = EXCLUDED.assigned_days,
    distance_range = EXCLUDED.distance_range,
    updated_at    = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
