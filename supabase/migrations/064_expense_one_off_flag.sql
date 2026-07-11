-- One-off variable expenses: excluded from "Copiar del mes pasado".
-- A one-off expense is a real variable expense for its month, but it should
-- not be offered as a template when copying last month's expenses forward.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_one_off BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW expenses_view AS
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
  e.updated_at AS "updatedAt",
  e.is_one_off  AS "isOneOff"
FROM expenses e
LEFT JOIN expense_categories c ON c.id = e.category_id;
