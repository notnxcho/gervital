-- ════════════════════════════════════════════════════════════════════════════
-- 058_client_test_instances.sql
-- Instancias de tests clínicos por cliente (modelo genérico). El catálogo y el
-- scoring viven en frontend (testsCatalog.js); acá solo se guardan las tomas.
-- test_id SIN CHECK a propósito: el catálogo crece sin migración.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_test_instances (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  test_id              TEXT NOT NULL,
  administered_at      DATE NOT NULL,
  administered_by      TEXT,
  is_genesis           BOOLEAN NOT NULL DEFAULT false,
  answers              JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_score            NUMERIC,
  subscores            JSONB,
  interpretation_label TEXT,
  score_version        TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_test_instances_client_test
  ON client_test_instances (client_id, test_id, administered_at DESC);

-- RLS: espeja las tablas médicas (is_authenticated() para todo).
ALTER TABLE client_test_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cti_select ON client_test_instances;
DROP POLICY IF EXISTS cti_insert ON client_test_instances;
DROP POLICY IF EXISTS cti_update ON client_test_instances;
DROP POLICY IF EXISTS cti_delete ON client_test_instances;
CREATE POLICY cti_select ON client_test_instances FOR SELECT USING (is_authenticated());
CREATE POLICY cti_insert ON client_test_instances FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY cti_update ON client_test_instances FOR UPDATE USING (is_authenticated());
CREATE POLICY cti_delete ON client_test_instances FOR DELETE USING (is_authenticated());
