-- ============================================
-- Views for nested JSON responses
-- ============================================

-- ============================================
-- clients_full: Returns clients with nested related data
-- Matches the shape expected by the frontend
-- ============================================
CREATE OR REPLACE VIEW clients_full AS
SELECT
  c.id,
  c.first_name AS "firstName",
  c.last_name AS "lastName",
  c.email,
  c.phone,
  c.birth_date AS "birthDate",
  c.cognitive_level AS "cognitiveLevel",
  c.start_date AS "startDate",
  c.recovery_days_available AS "recoveryDaysAvailable",
  c.created_at AS "createdAt",

  -- Plan as nested object
  CASE
    WHEN cp.id IS NOT NULL THEN
      jsonb_build_object(
        'frequency', cp.frequency,
        'schedule', cp.schedule,
        'hasTransport', cp.has_transport,
        'assignedDays', cp.assigned_days
      )
    ELSE NULL
  END AS plan,

  -- Emergency contact as nested object
  CASE
    WHEN ec.id IS NOT NULL THEN
      jsonb_build_object(
        'name', ec.name,
        'relationship', ec.relationship,
        'phone', ec.phone
      )
    ELSE NULL
  END AS "emergencyContact",

  -- Address as nested object
  CASE
    WHEN ca.id IS NOT NULL THEN
      jsonb_build_object(
        'street', ca.street,
        'accessNotes', ca.access_notes,
        'doorbell', ca.doorbell,
        'concierge', ca.concierge
      )
    ELSE NULL
  END AS address,

  -- Medical info as nested object
  CASE
    WHEN mi.id IS NOT NULL THEN
      jsonb_build_object(
        'dietaryRestrictions', mi.dietary_restrictions,
        'medicalRestrictions', mi.medical_restrictions,
        'mobilityRestrictions', mi.mobility_restrictions,
        'medication', mi.medication,
        'medicationSchedule', mi.medication_schedule,
        'notes', mi.notes
      )
    ELSE NULL
  END AS "medicalInfo"

FROM clients c
LEFT JOIN client_plans cp ON c.id = cp.client_id
LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
LEFT JOIN client_addresses ca ON c.id = ca.client_id
LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- ============================================
-- attendance_view: Returns attendance with formatted fields
-- ============================================
CREATE OR REPLACE VIEW attendance_view AS
SELECT
  ar.id,
  ar.client_id AS "clientId",
  ar.date::TEXT AS date,
  ar.shift,
  ar.status,
  ar.notes,
  ar.created_at AS "createdAt",
  ar.updated_at AS "updatedAt"
FROM attendance_records ar;

-- ============================================
-- invoices_view: Returns invoices with formatted fields
-- ============================================
CREATE OR REPLACE VIEW invoices_view AS
SELECT
  mi.id,
  mi.client_id AS "clientId",
  mi.year,
  mi.month,
  mi.planned_days AS "plannedDays",
  mi.chargeable_days AS "chargeableDays",
  mi.potential_amount AS "potentialAmount",
  mi.chargeable_amount AS "chargeableAmount",
  mi.invoice_status AS "invoiceStatus",
  mi.invoiced_at AS "invoicedAt",
  mi.invoiced_by AS "invoicedBy",
  mi.invoice_number AS "invoiceNumber",
  mi.invoice_url AS "invoiceUrl",
  mi.payment_status AS "paymentStatus",
  mi.payment_due_date AS "paymentDueDate",
  mi.paid_at AS "paidAt",
  mi.paid_amount AS "paidAmount",
  mi.payment_method AS "paymentMethod",
  mi.payment_notes AS "paymentNotes",
  mi.created_at AS "createdAt",
  mi.updated_at AS "updatedAt"
FROM monthly_invoices mi;

-- ============================================
-- suppliers_view: Returns suppliers with formatted fields
-- ============================================
CREATE OR REPLACE VIEW suppliers_view AS
SELECT
  s.id,
  s.name,
  s.category,
  s.contact,
  s.phone,
  s.email,
  s.notes,
  s.created_at AS "createdAt",
  s.updated_at AS "updatedAt"
FROM suppliers s;

-- ============================================
-- expenses_view: Returns expenses with formatted fields
-- ============================================
CREATE OR REPLACE VIEW expenses_view AS
SELECT
  e.id,
  e.supplier_id AS "supplierId",
  e.description,
  e.amount,
  e.type,
  e.year,
  e.month,
  e.date::TEXT AS date,
  e.status,
  e.paid_at AS "paidAt",
  e.notes,
  e.created_at AS "createdAt",
  e.updated_at AS "updatedAt"
FROM expenses e;

-- ============================================
-- users_view: Returns users with formatted fields
-- ============================================
CREATE OR REPLACE VIEW users_view AS
SELECT
  u.id,
  u.auth_id AS "authId",
  u.name,
  u.email,
  u.role,
  u.created_at::DATE::TEXT AS "createdAt",
  u.updated_at AS "updatedAt"
FROM users u;
