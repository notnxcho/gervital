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
DO $$
DECLARE v_con text;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'client_plans'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE client_plans DROP CONSTRAINT %I', v_con);
  END LOOP;
END $$;

ALTER TABLE client_plans
  ADD CONSTRAINT client_plans_client_effective_uniq UNIQUE (client_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_client_plans_client_effective
  ON client_plans (client_id, effective_from DESC);
