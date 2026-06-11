-- 026: Rework Sueldos -> ficha de empleados.
-- Drops the flat salaries table; adds employees + salary history + extra costs.

-- 1. Drop legacy salaries table (datos de prueba, se descartan)
DROP TABLE IF EXISTS salaries CASCADE;

-- 2. employees
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  role TEXT,
  semester_adjustment_pct NUMERIC(5,2) NOT NULL DEFAULT 3.5,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. employee_salary_adjustments (historia de sueldo)
CREATE TABLE employee_salary_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  nominal NUMERIC(12,2) NOT NULL,
  liquido NUMERIC(12,2) NOT NULL,
  effective_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_salary_adj_employee ON employee_salary_adjustments(employee_id, effective_date DESC);

-- 4. employee_extra_costs (extraordinarios, con o sin empleado)
CREATE TABLE employee_extra_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('despido', 'liquidacion', 'bono', 'otro')),
  concept TEXT,
  amount NUMERIC(12,2) NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_extra_costs_employee ON employee_extra_costs(employee_id);
CREATE INDEX idx_extra_costs_date ON employee_extra_costs(date);

-- 5. RLS: superadmin only (las 3 tablas)
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_salary_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_extra_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees viewable by superadmin"   ON employees FOR SELECT USING (is_superadmin());
CREATE POLICY "Employees insertable by superadmin" ON employees FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Employees updatable by superadmin"  ON employees FOR UPDATE USING (is_superadmin());
CREATE POLICY "Employees deletable by superadmin"  ON employees FOR DELETE USING (is_superadmin());

CREATE POLICY "Salary adj viewable by superadmin"   ON employee_salary_adjustments FOR SELECT USING (is_superadmin());
CREATE POLICY "Salary adj insertable by superadmin" ON employee_salary_adjustments FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Salary adj updatable by superadmin"  ON employee_salary_adjustments FOR UPDATE USING (is_superadmin());
CREATE POLICY "Salary adj deletable by superadmin"  ON employee_salary_adjustments FOR DELETE USING (is_superadmin());

CREATE POLICY "Extra costs viewable by superadmin"   ON employee_extra_costs FOR SELECT USING (is_superadmin());
CREATE POLICY "Extra costs insertable by superadmin" ON employee_extra_costs FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Extra costs updatable by superadmin"  ON employee_extra_costs FOR UPDATE USING (is_superadmin());
CREATE POLICY "Extra costs deletable by superadmin"  ON employee_extra_costs FOR DELETE USING (is_superadmin());

-- 6. View employees_full (nested JSON; derivados se calculan en JS)
CREATE VIEW employees_full WITH (security_invoker = on) AS
SELECT
  e.id,
  e.name,
  e.role,
  e.semester_adjustment_pct,
  e.active,
  e.created_at,
  e.updated_at,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.effective_date DESC, a.created_at DESC)
    FROM employee_salary_adjustments a WHERE a.employee_id = e.id
  ), '[]'::jsonb) AS adjustments,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC)
    FROM employee_extra_costs x WHERE x.employee_id = e.id
  ), '[]'::jsonb) AS extra_costs
FROM employees e;

-- 7. RPC: alta atomica de empleado + primer sueldo (SECURITY INVOKER -> RLS aplica)
CREATE OR REPLACE FUNCTION create_employee_with_salary(
  p_name TEXT,
  p_role TEXT,
  p_semester_adjustment_pct NUMERIC,
  p_nominal NUMERIC,
  p_liquido NUMERIC,
  p_effective_date DATE,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO employees (name, role, semester_adjustment_pct)
  VALUES (p_name, p_role, COALESCE(p_semester_adjustment_pct, 3.5))
  RETURNING id INTO v_id;

  INSERT INTO employee_salary_adjustments (employee_id, nominal, liquido, effective_date, notes)
  VALUES (v_id, p_nominal, p_liquido, p_effective_date, p_notes);

  RETURN v_id;
END;
$$;
