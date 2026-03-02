-- ============================================
-- Performance Indexes
-- ============================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auth_id ON users(auth_id);
CREATE INDEX idx_users_role ON users(role);

-- Clients
CREATE INDEX idx_clients_cognitive_level ON clients(cognitive_level);
CREATE INDEX idx_clients_last_name ON clients(last_name);
CREATE INDEX idx_clients_start_date ON clients(start_date);

-- Client Plans
CREATE INDEX idx_client_plans_client_id ON client_plans(client_id);
CREATE INDEX idx_client_plans_frequency ON client_plans(frequency);
CREATE INDEX idx_client_plans_schedule ON client_plans(schedule);

-- Emergency Contacts
CREATE INDEX idx_emergency_contacts_client_id ON emergency_contacts(client_id);

-- Client Addresses
CREATE INDEX idx_client_addresses_client_id ON client_addresses(client_id);

-- Medical Info
CREATE INDEX idx_medical_info_client_id ON medical_info(client_id);

-- Attendance Records
CREATE INDEX idx_attendance_records_client_id ON attendance_records(client_id);
CREATE INDEX idx_attendance_records_date ON attendance_records(date);
CREATE INDEX idx_attendance_records_status ON attendance_records(status);
CREATE INDEX idx_attendance_records_client_date ON attendance_records(client_id, date);

-- Monthly Invoices
CREATE INDEX idx_monthly_invoices_client_id ON monthly_invoices(client_id);
CREATE INDEX idx_monthly_invoices_year_month ON monthly_invoices(year, month);
CREATE INDEX idx_monthly_invoices_invoice_status ON monthly_invoices(invoice_status);
CREATE INDEX idx_monthly_invoices_payment_status ON monthly_invoices(payment_status);

-- Plan Pricing
CREATE INDEX idx_plan_pricing_frequency_schedule ON plan_pricing(frequency, schedule);

-- Suppliers
CREATE INDEX idx_suppliers_category ON suppliers(category);
CREATE INDEX idx_suppliers_name ON suppliers(name);

-- Expenses
CREATE INDEX idx_expenses_supplier_id ON expenses(supplier_id);
CREATE INDEX idx_expenses_year_month ON expenses(year, month);
CREATE INDEX idx_expenses_type ON expenses(type);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_date ON expenses(date);
