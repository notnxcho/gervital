-- ============================================
-- 016: Client Soft-Delete with Reason
-- - Adds deleted_at + deactivation_reason + deactivation_notes + deactivated_by
--   to `clients`.
-- - Refreshes clients_full view to expose those fields (no internal filter —
--   the service layer applies `deleted_at IS NULL` for operational reads).
-- - RPCs `deactivate_client(p_client_id, p_reason, p_notes, p_user_id)` and
--   `reactivate_client(p_client_id)`.
-- ============================================

-- ============================================
-- ⚠️  FRONTEND COUPLING (must ship in lockstep)
--
--   src/services/clients/clientService.js
--     - deleteClient removed; deactivateClient + reactivateClient added
--     - getClients gains { includeDeleted } option
--   src/services/clients/clientTransformers.js
--     - transformClientFromDb passes through the 3 new fields
--   src/services/api.js
--     - drop deleteClient export, add deactivateClient + reactivateClient
--   src/services/dashboard/dashboardService.js
--     - clients query filters deleted_at IS NULL
--   src/services/transport/transportService.js
--     - getTransportClients filters deleted_at IS NULL
--   src/pages/Clients/{ClientList,ClientDetail}.jsx + new DeactivateClientModal.jsx
-- ============================================

-- ============================================
-- Step 1 — Columns on `clients`
-- ============================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deactivation_notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deactivated_by UUID;

-- FK for deactivated_by (separate so re-runs don't crash if it already exists)
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_deactivated_by_fkey;
ALTER TABLE clients
  ADD CONSTRAINT clients_deactivated_by_fkey
  FOREIGN KEY (deactivated_by) REFERENCES users(id) ON DELETE SET NULL;

-- Reason check constraint
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_deactivation_reason_check;
ALTER TABLE clients ADD CONSTRAINT clients_deactivation_reason_check
  CHECK (deactivation_reason IS NULL OR deactivation_reason IN (
    'death',
    'transfer_to_other_center',
    'relocation',
    'health_decline',
    'family_decision',
    'financial',
    'service_dissatisfaction',
    'other'
  ));

-- Integrity: active rows must have no deactivation fields;
-- deactivated rows must have at least a reason.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_deactivation_consistency;
ALTER TABLE clients ADD CONSTRAINT clients_deactivation_consistency CHECK (
  (deleted_at IS NULL
    AND deactivation_reason IS NULL
    AND deactivation_notes IS NULL
    AND deactivated_by IS NULL)
  OR
  (deleted_at IS NOT NULL AND deactivation_reason IS NOT NULL)
);

-- ============================================
-- Step 2 — Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_clients_active
  ON clients(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_deactivation_reason
  ON clients(deactivation_reason) WHERE deleted_at IS NOT NULL;

-- ============================================
-- Step 3 — Refresh clients_full view
-- (no internal filter on deleted_at; the service layer filters)
-- ============================================

DROP VIEW IF EXISTS clients_full;
CREATE VIEW clients_full AS
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
  c.avatar_url AS "avatarUrl",
  c.deleted_at AS "deletedAt",
  c.deactivation_reason AS "deactivationReason",
  c.deactivation_notes AS "deactivationNotes",
  c.created_at AS "createdAt",

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

  CASE
    WHEN ec.id IS NOT NULL THEN
      jsonb_build_object(
        'name', ec.name,
        'relationship', ec.relationship,
        'phone', ec.phone
      )
    ELSE NULL
  END AS "emergencyContact",

  CASE
    WHEN ca.id IS NOT NULL THEN
      jsonb_build_object(
        'street', ca.street,
        'accessNotes', ca.access_notes,
        'doorbell', ca.doorbell,
        'concierge', ca.concierge,
        'latitude', ca.latitude,
        'longitude', ca.longitude,
        'distanceRange', ca.distance_range
      )
    ELSE NULL
  END AS address,

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
-- Step 4 — RPC: deactivate_client
-- ============================================

CREATE OR REPLACE FUNCTION deactivate_client(
  p_client_id UUID,
  p_reason TEXT,
  p_notes TEXT,
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_clean_notes TEXT;
BEGIN
  IF p_reason NOT IN (
    'death','transfer_to_other_center','relocation','health_decline',
    'family_decision','financial','service_dissatisfaction','other'
  ) THEN
    RAISE EXCEPTION 'Invalid deactivation reason: %', p_reason;
  END IF;

  v_clean_notes := NULLIF(trim(coalesce(p_notes, '')), '');

  IF p_reason = 'other' AND v_clean_notes IS NULL THEN
    RAISE EXCEPTION 'Notes required when reason is "other"';
  END IF;

  UPDATE clients
     SET deleted_at = NOW(),
         deactivation_reason = p_reason,
         deactivation_notes = v_clean_notes,
         deactivated_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or already deactivated';
  END IF;

  RETURN p_client_id;
END;
$$;

-- ============================================
-- Step 5 — RPC: reactivate_client
-- ============================================

CREATE OR REPLACE FUNCTION reactivate_client(p_client_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE clients
     SET deleted_at = NULL,
         deactivation_reason = NULL,
         deactivation_notes = NULL,
         deactivated_by = NULL,
         updated_at = NOW()
   WHERE id = p_client_id
     AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or not deactivated';
  END IF;

  RETURN p_client_id;
END;
$$;
