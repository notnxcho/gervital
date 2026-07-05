-- 036_costs_overhaul.sql
-- Costs module overhaul: custom expense categories, fixed-expense templates,
-- expenses become variable-only (no payment status). Drops dead summary fn.

-- 1. Expense categories (global, editable) --------------------------------
CREATE TABLE expense_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO expense_categories (name, description) VALUES
  ('Impuestos y cargas fiscales', 'Tributos, Saneamiento, Primaria, Comercio'),
  ('Servicios básicos', 'Energía, agua, conectividad'),
  ('Alimentación', 'Insumos alimentarios de los usuarios'),
  ('Mantenimiento e higiene del local', 'Edificio, jardín, limpieza, ambientación'),
  ('Seguros y cobertura médica', 'BSE, SEMM'),
  ('Tecnología y software', 'Suscripciones y sistemas'),
  ('Vehículo', 'Todo lo de la H1 como centro de costo'),
  ('Personal - beneficios', 'Uniformes, regalos, gift cards'),
  ('Administración y financieros', 'Papelería, comisiones, publicidad, varios'),
  ('Actividades y equipamiento terapéutico', 'Fungibles de talleres, reposición de equipamiento y ayudas técnicas');

-- 2. Fixed expenses (recurring templates) --------------------------------
CREATE TABLE fixed_expenses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description   TEXT NOT NULL,
  category_id   UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  supplier_id   UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  amount        NUMERIC(12,2) NOT NULL,
  period_months INT NOT NULL CHECK (period_months IN (1,2,3,4,6,12)),
  start_year    INT NOT NULL,
  start_month   INT NOT NULL CHECK (start_month BETWEEN 0 AND 11),
  end_year      INT,
  end_month     INT CHECK (end_month BETWEEN 0 AND 11),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. expenses -> variable-only -------------------------------------------
-- expenses_view depends on status/paid_at, so drop it before dropping columns
-- (CREATE OR REPLACE VIEW cannot remove columns). Recreated in step 5.
DROP VIEW IF EXISTS expenses_view;
ALTER TABLE expenses ADD COLUMN category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL;
ALTER TABLE expenses DROP COLUMN IF EXISTS status;
ALTER TABLE expenses DROP COLUMN IF EXISTS paid_at;
ALTER TABLE expenses DROP COLUMN IF EXISTS type;

-- 4. RLS: mirror expenses/suppliers (any authenticated) ------------------
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expense categories viewable by authenticated"   ON expense_categories FOR SELECT USING (is_authenticated());
CREATE POLICY "Expense categories insertable by authenticated" ON expense_categories FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Expense categories updatable by authenticated"  ON expense_categories FOR UPDATE USING (is_authenticated());
CREATE POLICY "Expense categories deletable by authenticated"  ON expense_categories FOR DELETE USING (is_authenticated());

CREATE POLICY "Fixed expenses viewable by authenticated"   ON fixed_expenses FOR SELECT USING (is_authenticated());
CREATE POLICY "Fixed expenses insertable by authenticated" ON fixed_expenses FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Fixed expenses updatable by authenticated"  ON fixed_expenses FOR UPDATE USING (is_authenticated());
CREATE POLICY "Fixed expenses deletable by authenticated"  ON fixed_expenses FOR DELETE USING (is_authenticated());

-- 5. Views ----------------------------------------------------------------
CREATE VIEW expenses_view AS
SELECT
  e.id,
  e.supplier_id AS "supplierId",
  e.category_id AS "categoryId",
  c.name        AS "categoryName",
  e.description,
  e.amount,
  e.year,
  e.month,
  e.date::TEXT AS date,
  e.notes,
  e.created_at AS "createdAt",
  e.updated_at AS "updatedAt"
FROM expenses e
LEFT JOIN expense_categories c ON c.id = e.category_id;

CREATE OR REPLACE VIEW fixed_expenses_view AS
SELECT
  f.id,
  f.description,
  f.category_id   AS "categoryId",
  c.name          AS "categoryName",
  f.supplier_id   AS "supplierId",
  s.name          AS "supplierName",
  f.amount,
  f.period_months AS "periodMonths",
  f.start_year    AS "startYear",
  f.start_month   AS "startMonth",
  f.end_year      AS "endYear",
  f.end_month     AS "endMonth",
  f.notes,
  f.created_at    AS "createdAt",
  f.updated_at    AS "updatedAt"
FROM fixed_expenses f
LEFT JOIN expense_categories c ON c.id = f.category_id
LEFT JOIN suppliers s ON s.id = f.supplier_id;

-- 6. Drop dead code -------------------------------------------------------
DROP FUNCTION IF EXISTS get_expenses_summary(INTEGER, INTEGER);
