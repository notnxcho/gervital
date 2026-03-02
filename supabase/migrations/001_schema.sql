-- ============================================
-- Gervital Database Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS (System users - admin/superadmin)
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'superadmin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CLIENTS (Elderly attendees)
-- ============================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  birth_date DATE,
  cognitive_level TEXT CHECK (cognitive_level IN ('A', 'B', 'C', 'D')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  recovery_days_available INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CLIENT_PLANS (Plan details per client)
-- ============================================
CREATE TABLE client_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  frequency INTEGER NOT NULL CHECK (frequency IN (1, 2, 3, 4)),
  schedule TEXT NOT NULL CHECK (schedule IN ('morning', 'afternoon', 'full_day')),
  has_transport BOOLEAN NOT NULL DEFAULT false,
  assigned_days TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- EMERGENCY_CONTACTS (One per client)
-- ============================================
CREATE TABLE emergency_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CLIENT_ADDRESSES (One per client)
-- ============================================
CREATE TABLE client_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  street TEXT,
  access_notes TEXT,
  doorbell TEXT,
  concierge TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- MEDICAL_INFO (One per client)
-- ============================================
CREATE TABLE medical_info (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  dietary_restrictions TEXT,
  medical_restrictions TEXT,
  mobility_restrictions TEXT,
  medication TEXT,
  medication_schedule TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ATTENDANCE_RECORDS (Daily attendance)
-- ============================================
CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift TEXT CHECK (shift IN ('morning', 'afternoon', 'full_day')),
  status TEXT NOT NULL CHECK (status IN (
    'attended',
    'unjustified_absence',
    'justified_recovered',
    'justified_not_recovered',
    'recovered',
    'scheduled'
  )),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, date)
);

-- ============================================
-- MONTHLY_INVOICES (Billing records)
-- ============================================
CREATE TABLE monthly_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 0 AND month <= 11),

  -- Days and amounts
  planned_days INTEGER NOT NULL DEFAULT 0,
  chargeable_days INTEGER NOT NULL DEFAULT 0,
  potential_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  chargeable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,

  -- Invoice status (independent from payment)
  invoice_status TEXT NOT NULL DEFAULT 'pending' CHECK (invoice_status IN ('pending', 'invoiced')),
  invoiced_at TIMESTAMPTZ,
  invoiced_by TEXT,
  invoice_number TEXT,
  invoice_url TEXT,

  -- Payment status (independent from invoice)
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue')),
  payment_due_date DATE,
  paid_at TIMESTAMPTZ,
  paid_amount NUMERIC(12, 2),
  payment_method TEXT,
  payment_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, year, month)
);

-- ============================================
-- PLAN_PRICING (Price matrix)
-- ============================================
CREATE TABLE plan_pricing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  frequency INTEGER NOT NULL CHECK (frequency IN (1, 2, 3, 4)),
  schedule TEXT NOT NULL CHECK (schedule IN ('morning', 'afternoon', 'full_day')),
  price NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(frequency, schedule)
);

-- ============================================
-- SUPPLIERS (Vendor management)
-- ============================================
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- EXPENSES (Expense tracking)
-- ============================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('recurring', 'extraordinary')),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 0 AND month <= 11),
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
