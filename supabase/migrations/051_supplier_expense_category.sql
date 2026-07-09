-- 051_supplier_expense_category.sql
-- Suppliers no longer carry their own free-text category. Instead a supplier
-- references an expense category (expense_categories). When creating an expense
-- the chosen supplier auto-populates the expense's category and description.

-- 1. Add FK column, best-effort migrate existing free-text values by name match.
ALTER TABLE suppliers ADD COLUMN category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL;

UPDATE suppliers s
SET category_id = c.id
FROM expense_categories c
WHERE lower(trim(s.category)) = lower(trim(c.name));

-- 2. Drop the old free-text column. suppliers_view selects it, so drop the view
--    first (CREATE OR REPLACE VIEW cannot remove/rename columns), then recreate.
DROP VIEW IF EXISTS suppliers_view;
ALTER TABLE suppliers DROP COLUMN category;

CREATE VIEW suppliers_view AS
SELECT
  s.id,
  s.name,
  s.category_id AS "categoryId",
  c.name        AS "categoryName",
  s.contact,
  s.phone,
  s.email,
  s.notes,
  s.created_at AS "createdAt",
  s.updated_at AS "updatedAt"
FROM suppliers s
LEFT JOIN expense_categories c ON c.id = s.category_id;
