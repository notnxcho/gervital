-- ============================================
-- Row-Level Security Policies
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Helper function to get current user role
-- ============================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE auth_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================
-- Helper function to check if user is superadmin
-- ============================================
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_id = auth.uid() AND role = 'superadmin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================
-- Helper function to check if user is authenticated
-- ============================================
CREATE OR REPLACE FUNCTION is_authenticated()
RETURNS BOOLEAN AS $$
  SELECT auth.uid() IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================
-- USERS Policies
-- ============================================
-- All authenticated users can read users
CREATE POLICY "Users are viewable by authenticated users"
  ON users FOR SELECT
  USING (is_authenticated());

-- Only superadmin can insert/update/delete users
CREATE POLICY "Only superadmin can insert users"
  ON users FOR INSERT
  WITH CHECK (is_superadmin());

CREATE POLICY "Only superadmin can update users"
  ON users FOR UPDATE
  USING (is_superadmin());

CREATE POLICY "Only superadmin can delete users"
  ON users FOR DELETE
  USING (is_superadmin());

-- ============================================
-- CLIENTS Policies
-- ============================================
CREATE POLICY "Clients are viewable by authenticated users"
  ON clients FOR SELECT
  USING (is_authenticated());

CREATE POLICY "Clients are insertable by authenticated users"
  ON clients FOR INSERT
  WITH CHECK (is_authenticated());

CREATE POLICY "Clients are updatable by authenticated users"
  ON clients FOR UPDATE
  USING (is_authenticated());

CREATE POLICY "Clients are deletable by authenticated users"
  ON clients FOR DELETE
  USING (is_authenticated());

-- ============================================
-- CLIENT_PLANS Policies
-- ============================================
CREATE POLICY "Client plans are viewable by authenticated users"
  ON client_plans FOR SELECT
  USING (is_authenticated());

CREATE POLICY "Client plans are insertable by authenticated users"
  ON client_plans FOR INSERT
  WITH CHECK (is_authenticated());

CREATE POLICY "Client plans are updatable by authenticated users"
  ON client_plans FOR UPDATE
  USING (is_authenticated());

CREATE POLICY "Client plans are deletable by authenticated users"
  ON client_plans FOR DELETE
  USING (is_authenticated());

-- ============================================
-- EMERGENCY_CONTACTS Policies
-- ============================================
CREATE POLICY "Emergency contacts are viewable by authenticated users"
  ON emergency_contacts FOR SELECT
  USING (is_authenticated());

CREATE POLICY "Emergency contacts are insertable by authenticated users"
  ON emergency_contacts FOR INSERT
  WITH CHECK (is_authenticated());

CREATE POLICY "Emergency contacts are updatable by authenticated users"
  ON emergency_contacts FOR UPDATE
  USING (is_authenticated());

CREATE POLICY "Emergency contacts are deletable by authenticated users"
  ON emergency_contacts FOR DELETE
  USING (is_authenticated());

-- ============================================
-- CLIENT_ADDRESSES Policies
-- ============================================
CREATE POLICY "Client addresses are viewable by authenticated users"
  ON client_addresses FOR SELECT
  USING (is_authenticated());

CREATE POLICY "Client addresses are insertable by authenticated users"
  ON client_addresses FOR INSERT
  WITH CHECK (is_authenticated());

CREATE POLICY "Client addresses are updatable by authenticated users"
  ON client_addresses FOR UPDATE
  USING (is_authenticated());

CREATE POLICY "Client addresses are deletable by authenticated users"
  ON client_addresses FOR DELETE
  USING (is_authenticated());

-- ============================================
-- MEDICAL_INFO Policies
-- ============================================
CREATE POLICY "Medical info is viewable by authenticated users"
  ON medical_info FOR SELECT
  USING (is_authenticated());

CREATE POLICY "Medical info is insertable by authenticated users"
  ON medical_info FOR INSERT
  WITH CHECK (is_authenticated());

CREATE POLICY "Medical info is updatable by authenticated users"
  ON medical_info FOR UPDATE
  USING (is_authenticated());

CREATE POLICY "Medical info is deletable by authenticated users"
  ON medical_info FOR DELETE
  USING (is_authenticated());

-- ============================================
-- ATTENDANCE_RECORDS Policies
-- ============================================
CREATE POLICY "Attendance records are viewable by authenticated users"
  ON attendance_records FOR SELECT
  USING (is_authenticated());

CREATE POLICY "Attendance records are insertable by authenticated users"
  ON attendance_records FOR INSERT
  WITH CHECK (is_authenticated());

CREATE POLICY "Attendance records are updatable by authenticated users"
  ON attendance_records FOR UPDATE
  USING (is_authenticated());

CREATE POLICY "Attendance records are deletable by authenticated users"
  ON attendance_records FOR DELETE
  USING (is_authenticated());

-- ============================================
-- MONTHLY_INVOICES Policies
-- ============================================
CREATE POLICY "Monthly invoices are viewable by authenticated users"
  ON monthly_invoices FOR SELECT
  USING (is_authenticated());

CREATE POLICY "Monthly invoices are insertable by authenticated users"
  ON monthly_invoices FOR INSERT
  WITH CHECK (is_authenticated());

CREATE POLICY "Monthly invoices are updatable by authenticated users"
  ON monthly_invoices FOR UPDATE
  USING (is_authenticated());

CREATE POLICY "Monthly invoices are deletable by authenticated users"
  ON monthly_invoices FOR DELETE
  USING (is_authenticated());

-- ============================================
-- PLAN_PRICING Policies
-- ============================================
CREATE POLICY "Plan pricing is viewable by authenticated users"
  ON plan_pricing FOR SELECT
  USING (is_authenticated());

CREATE POLICY "Only superadmin can modify plan pricing"
  ON plan_pricing FOR INSERT
  WITH CHECK (is_superadmin());

CREATE POLICY "Only superadmin can update plan pricing"
  ON plan_pricing FOR UPDATE
  USING (is_superadmin());

CREATE POLICY "Only superadmin can delete plan pricing"
  ON plan_pricing FOR DELETE
  USING (is_superadmin());

-- ============================================
-- SUPPLIERS Policies (Superadmin only)
-- ============================================
CREATE POLICY "Suppliers are viewable by superadmin only"
  ON suppliers FOR SELECT
  USING (is_superadmin());

CREATE POLICY "Suppliers are insertable by superadmin only"
  ON suppliers FOR INSERT
  WITH CHECK (is_superadmin());

CREATE POLICY "Suppliers are updatable by superadmin only"
  ON suppliers FOR UPDATE
  USING (is_superadmin());

CREATE POLICY "Suppliers are deletable by superadmin only"
  ON suppliers FOR DELETE
  USING (is_superadmin());

-- ============================================
-- EXPENSES Policies (Superadmin only)
-- ============================================
CREATE POLICY "Expenses are viewable by superadmin only"
  ON expenses FOR SELECT
  USING (is_superadmin());

CREATE POLICY "Expenses are insertable by superadmin only"
  ON expenses FOR INSERT
  WITH CHECK (is_superadmin());

CREATE POLICY "Expenses are updatable by superadmin only"
  ON expenses FOR UPDATE
  USING (is_superadmin());

CREATE POLICY "Expenses are deletable by superadmin only"
  ON expenses FOR DELETE
  USING (is_superadmin());
