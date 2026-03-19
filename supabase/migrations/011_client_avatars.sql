-- ============================================
-- 011: Client Avatars
-- Adds avatar_url to clients table and updates clients_full view
-- ============================================

-- Add avatar_url column to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Drop and recreate clients_full view to include avatarUrl
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
-- Storage bucket for client avatars
-- Note: Run this via Supabase dashboard or SQL editor:
--
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('client-avatars', 'client-avatars', true);
--
-- CREATE POLICY "Allow authenticated uploads"
-- ON storage.objects FOR INSERT
-- TO authenticated
-- WITH CHECK (bucket_id = 'client-avatars');
--
-- CREATE POLICY "Allow authenticated updates"
-- ON storage.objects FOR UPDATE
-- TO authenticated
-- USING (bucket_id = 'client-avatars');
--
-- CREATE POLICY "Allow authenticated deletes"
-- ON storage.objects FOR DELETE
-- TO authenticated
-- USING (bucket_id = 'client-avatars');
--
-- CREATE POLICY "Allow public reads"
-- ON storage.objects FOR SELECT
-- TO public
-- USING (bucket_id = 'client-avatars');
-- ============================================
