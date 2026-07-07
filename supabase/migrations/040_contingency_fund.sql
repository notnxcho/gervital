-- 040_contingency_fund.sql
-- Contingency fund: extraordinary expenses (full-access, supplier + category)
-- and a generic app_settings table holding the customizable fund percentage.

-- 1. Extraordinary expenses (mirrors expenses; month-scoped) --------------
CREATE TABLE extraordinary_expenses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  year        INT NOT NULL,
  month       INT NOT NULL CHECK (month BETWEEN 0 AND 11),
  date        DATE NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_extraordinary_expenses_year_month ON extraordinary_expenses (year, month);

CREATE TRIGGER update_extraordinary_expenses_updated_at
  BEFORE UPDATE ON extraordinary_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE VIEW extraordinary_expenses_view AS
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
FROM extraordinary_expenses e
LEFT JOIN expense_categories c ON c.id = e.category_id;

ALTER TABLE extraordinary_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Extraordinary expenses viewable by authenticated"   ON extraordinary_expenses FOR SELECT USING (is_authenticated());
CREATE POLICY "Extraordinary expenses insertable by authenticated" ON extraordinary_expenses FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Extraordinary expenses updatable by authenticated"  ON extraordinary_expenses FOR UPDATE USING (is_authenticated());
CREATE POLICY "Extraordinary expenses deletable by authenticated"  ON extraordinary_expenses FOR DELETE USING (is_authenticated());

-- 2. Generic app settings (key/value) ------------------------------------
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value) VALUES ('contingency_fund_pct', '10');

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "App settings viewable by authenticated" ON app_settings FOR SELECT USING (is_authenticated());
CREATE POLICY "App settings insertable by admins"      ON app_settings FOR INSERT WITH CHECK (is_admin_or_superadmin());
CREATE POLICY "App settings updatable by admins"       ON app_settings FOR UPDATE USING (is_admin_or_superadmin());
