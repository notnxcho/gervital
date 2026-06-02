-- 020_operador_role.sql
-- Third role 'operador' + financial RLS hardening + salaries table.

-- 1. Widen the role CHECK constraint to three values
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('operador', 'admin', 'superadmin'));

-- 2. New users default to the least-privileged role
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (auth_id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'operador')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RLS helper: admin or superadmin
CREATE OR REPLACE FUNCTION is_admin_or_superadmin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_id = auth.uid() AND role IN ('admin', 'superadmin')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 4. suppliers: superadmin-only -> any authenticated (all three roles)
DROP POLICY IF EXISTS "Suppliers are viewable by superadmin only" ON suppliers;
DROP POLICY IF EXISTS "Suppliers are insertable by superadmin only" ON suppliers;
DROP POLICY IF EXISTS "Suppliers are updatable by superadmin only" ON suppliers;
DROP POLICY IF EXISTS "Suppliers are deletable by superadmin only" ON suppliers;
CREATE POLICY "Suppliers viewable by authenticated"   ON suppliers FOR SELECT USING (is_authenticated());
CREATE POLICY "Suppliers insertable by authenticated" ON suppliers FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Suppliers updatable by authenticated"  ON suppliers FOR UPDATE USING (is_authenticated());
CREATE POLICY "Suppliers deletable by authenticated"  ON suppliers FOR DELETE USING (is_authenticated());

-- expenses: superadmin-only -> any authenticated
DROP POLICY IF EXISTS "Expenses are viewable by superadmin only" ON expenses;
DROP POLICY IF EXISTS "Expenses are insertable by superadmin only" ON expenses;
DROP POLICY IF EXISTS "Expenses are updatable by superadmin only" ON expenses;
DROP POLICY IF EXISTS "Expenses are deletable by superadmin only" ON expenses;
CREATE POLICY "Expenses viewable by authenticated"   ON expenses FOR SELECT USING (is_authenticated());
CREATE POLICY "Expenses insertable by authenticated" ON expenses FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Expenses updatable by authenticated"  ON expenses FOR UPDATE USING (is_authenticated());
CREATE POLICY "Expenses deletable by authenticated"  ON expenses FOR DELETE USING (is_authenticated());

-- 5. monthly_invoices SELECT: authenticated -> admin/superadmin only.
-- Write policies are left as-is (operador never writes invoices from the UI,
-- and no trigger writes invoices on attendance changes).
DROP POLICY IF EXISTS "Monthly invoices are viewable by authenticated users" ON monthly_invoices;
CREATE POLICY "Monthly invoices viewable by admin or superadmin"
  ON monthly_invoices FOR SELECT USING (is_admin_or_superadmin());

-- invoices_view must honor the caller's RLS for the restriction to apply through the view
ALTER VIEW invoices_view SET (security_invoker = on);

-- plan_pricing SELECT: authenticated -> admin/superadmin only (read directly from table)
DROP POLICY IF EXISTS "Plan pricing is viewable by authenticated users" ON plan_pricing;
CREATE POLICY "Plan pricing viewable by admin or superadmin"
  ON plan_pricing FOR SELECT USING (is_admin_or_superadmin());

-- 6. salaries table (Sueldos module, superadmin only)
CREATE TABLE salaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL CHECK (kind IN ('recurring', 'one_time')),
  one_time_type TEXT CHECK (one_time_type IN
    ('aguinaldo', 'despido', 'licencia_vacacional', 'liquidacion', 'otro')),
  concept TEXT,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE salaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Salaries viewable by superadmin"   ON salaries FOR SELECT USING (is_superadmin());
CREATE POLICY "Salaries insertable by superadmin" ON salaries FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Salaries updatable by superadmin"  ON salaries FOR UPDATE USING (is_superadmin());
CREATE POLICY "Salaries deletable by superadmin"  ON salaries FOR DELETE USING (is_superadmin());
