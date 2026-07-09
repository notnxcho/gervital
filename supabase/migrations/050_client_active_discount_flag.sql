-- Migration 050: expose hasActiveDiscount flag on clients_full
--
-- Adds a boolean column "hasActiveDiscount" to the clients_full view.
-- Definition of "activa": the client has a row in monthly_invoices for the
-- CURRENT month with discount_percent > 0.
--
-- IMPORTANT month convention: monthly_invoices.month is stored 0-11 (Jan=0),
-- while EXTRACT(MONTH FROM CURRENT_DATE) returns 1-12, so we subtract 1:
--   current month = EXTRACT(MONTH FROM CURRENT_DATE)::int - 1
--   current year  = EXTRACT(YEAR FROM CURRENT_DATE)::int
--
-- RLS note: clients_full is security_invoker=on and SELECT on monthly_invoices
-- is RLS-restricted to admin/superadmin. As a result, for an operador the
-- EXISTS subquery sees 0 rows and the flag reads as false. This is acceptable:
-- discount/promo state is billing information the operador is not entitled to.
--
-- CREATE OR REPLACE VIEW preserves reloptions (security_invoker=on) and allows
-- appending a new column at the END. The rest of the view body is transcribed
-- verbatim from the migration-048 definition; nothing else is altered.

CREATE OR REPLACE VIEW clients_full AS
 SELECT c.id,
    c.first_name AS "firstName",
    c.last_name AS "lastName",
    c.email,
    c.phone,
    c.birth_date AS "birthDate",
    c.cognitive_level AS "cognitiveLevel",
    c.start_date AS "startDate",
    c.document_type AS "documentType",
    c.document_number AS "documentNumber",
    c.marital_status AS "maritalStatus",
    c.residence_type AS "residenceType",
    c.lives_with AS "livesWith",
    c.biller_client_id AS "billerClientId",
    c.biller_branch_id AS "billerBranchId",
    c.biller_synced_at AS "billerSyncedAt",
    c.biller_sync_error AS "billerSyncError",
    ( SELECT count(*)::integer AS count
           FROM recovery_credits rc
          WHERE rc.client_id = c.id AND rc.status = 'available'::text AND rc.expires_at >= CURRENT_DATE) AS "recoveryDaysAvailable",
    c.avatar_url AS "avatarUrl",
    c.deleted_at AS "deletedAt",
    c.deactivation_reason AS "deactivationReason",
    c.deactivation_notes AS "deactivationNotes",
    c.created_at AS "createdAt",
        CASE
            WHEN cp.id IS NOT NULL THEN jsonb_build_object('frequency', cp.frequency, 'schedule', cp.schedule, 'hasTransport', cp.has_transport, 'assignedDays', cp.assigned_days)
            ELSE NULL::jsonb
        END AS plan,
        CASE
            WHEN ec.id IS NOT NULL THEN jsonb_build_object('name', ec.name, 'relationship', ec.relationship, 'phone', ec.phone)
            ELSE NULL::jsonb
        END AS "emergencyContact",
        CASE
            WHEN ca.id IS NOT NULL THEN jsonb_build_object('street', ca.street, 'accessNotes', ca.access_notes, 'doorbell', ca.doorbell, 'concierge', ca.concierge, 'latitude', ca.latitude, 'longitude', ca.longitude, 'distanceRange', ca.distance_range)
            ELSE NULL::jsonb
        END AS address,
        CASE
            WHEN mi.id IS NOT NULL THEN jsonb_build_object('healthEmergencyService', mi.health_emergency_service, 'healthProvider', mi.health_provider, 'healthNotes', mi.health_notes, 'medicationNotes', mi.medication_notes, 'historyNotes', mi.history_notes, 'educationLevel', mi.education_level, 'occupation', mi.occupation, 'significantInterests', mi.significant_interests, 'significantBonds', mi.significant_bonds, 'musicTaste', mi.music_taste, 'favoriteFoods', mi.favorite_foods, 'character', mi.personality_type, 'personalResources', mi.personal_resources, 'vulnerabilities', mi.vulnerabilities)
            ELSE NULL::jsonb
        END AS "medicalInfo",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', m.name, 'schedule', m.schedule, 'dose', m.dose, 'indicatedFor', m.indicated_for) ORDER BY m."position", m.created_at) AS jsonb_agg
           FROM client_medications m
          WHERE m.client_id = c.id), '[]'::jsonb) AS medications,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('diagnosisType', d.diagnosis_type, 'behaviorDisorder', d.behavior_disorder) ORDER BY d."position", d.created_at) AS jsonb_agg
           FROM client_diagnoses d
          WHERE d.client_id = c.id), '[]'::jsonb) AS diagnoses,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('condition', h.condition, 'comment', h.comment) ORDER BY h.created_at) AS jsonb_agg
           FROM client_medical_history h
          WHERE h.client_id = c.id), '[]'::jsonb) AS "medicalHistory",
    c.transfer_responsible AS "transferResponsible",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', ec2.name, 'relationship', ec2.relationship, 'phone', ec2.phone) ORDER BY ec2."position", ec2.created_at) AS jsonb_agg
           FROM emergency_contacts ec2
          WHERE ec2.client_id = c.id), '[]'::jsonb) AS "emergencyContacts",
    c.deactivation_date AS "deactivationDate",
    c.client_type AS "clientType"
    ,EXISTS (
      SELECT 1 FROM monthly_invoices minv
      WHERE minv.client_id = c.id
        AND minv.discount_percent > 0
        AND minv.year = EXTRACT(YEAR FROM CURRENT_DATE)::int
        AND minv.month = (EXTRACT(MONTH FROM CURRENT_DATE)::int - 1)
    ) AS "hasActiveDiscount"
   FROM clients c
     LEFT JOIN LATERAL ( SELECT cp2.id,
            cp2.frequency,
            cp2.schedule,
            cp2.has_transport,
            cp2.assigned_days
           FROM client_plans cp2
          WHERE cp2.client_id = c.id AND cp2.effective_from <= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date
          ORDER BY cp2.effective_from DESC
         LIMIT 1) cp ON true
     LEFT JOIN LATERAL ( SELECT ec1.id,
            ec1.name,
            ec1.relationship,
            ec1.phone
           FROM emergency_contacts ec1
          WHERE ec1.client_id = c.id
          ORDER BY ec1."position", ec1.created_at
         LIMIT 1) ec ON true
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- CREATE OR REPLACE VIEW did NOT preserve security_invoker in practice, so we
-- re-assert it explicitly to guarantee the base-table RLS applies to readers.
ALTER VIEW clients_full SET (security_invoker = on);
