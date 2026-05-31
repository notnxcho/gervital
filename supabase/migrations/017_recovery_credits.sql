-- 017_recovery_credits.sql
-- Recovery days become individual credits, each expiring 30 calendar days after grant.
-- Available balance is derived (status='available' AND expires_at >= CURRENT_DATE),
-- so expiry is automatic/lazy with no scheduled job. Drops clients.recovery_days_available.

-- ── 1. recovery_credits table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recovery_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  granted_at DATE NOT NULL,
  expires_at DATE NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('justified_absence','vacation_post_payment','manual','migration')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','consumed','revoked')),
  grant_attendance_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
  consumed_attendance_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
  consumed_at DATE,
  revoked_at TIMESTAMPTZ,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_credits_client_status_exp
  ON recovery_credits (client_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_recovery_credits_grant_att
  ON recovery_credits (grant_attendance_id);
CREATE INDEX IF NOT EXISTS idx_recovery_credits_consumed_att
  ON recovery_credits (consumed_attendance_id);

-- RLS mirrors attendance_records (authenticated users full access)
ALTER TABLE recovery_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recovery_credits_select" ON recovery_credits;
DROP POLICY IF EXISTS "recovery_credits_insert" ON recovery_credits;
DROP POLICY IF EXISTS "recovery_credits_update" ON recovery_credits;
DROP POLICY IF EXISTS "recovery_credits_delete" ON recovery_credits;
CREATE POLICY "recovery_credits_select" ON recovery_credits FOR SELECT USING (is_authenticated());
CREATE POLICY "recovery_credits_insert" ON recovery_credits FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "recovery_credits_update" ON recovery_credits FOR UPDATE USING (is_authenticated());
CREATE POLICY "recovery_credits_delete" ON recovery_credits FOR DELETE USING (is_authenticated());

-- ── 2. ledger gains a credit reference ─────────────────────────────────────
ALTER TABLE recovery_credit_ledger ADD COLUMN IF NOT EXISTS credit_id UUID;

-- ── 3. Backfill existing balances from the ledger (FIFO replay) ─────────────
-- No-op against current data (ledger empty, no client holds days) but robust.
DO $$
DECLARE r RECORD; led RECORD;
BEGIN
  FOR r IN SELECT DISTINCT client_id FROM recovery_credit_ledger LOOP
    FOR led IN
      SELECT date, change FROM recovery_credit_ledger
      WHERE client_id = r.client_id
      ORDER BY date ASC, created_at ASC
    LOOP
      IF led.change > 0 THEN
        INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, status)
        VALUES (r.client_id, led.date, led.date + 30, 'migration', 'available');
      ELSIF led.change < 0 THEN
        UPDATE recovery_credits SET status='consumed', consumed_at=led.date
        WHERE id = (
          SELECT id FROM recovery_credits
          WHERE client_id = r.client_id AND status='available'
          ORDER BY expires_at ASC, granted_at ASC
          LIMIT 1
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Fallback: positive counter not fully reconstructed from the ledger
  FOR r IN
    SELECT c.id,
           c.recovery_days_available AS bal,
           COALESCE((SELECT count(*) FROM recovery_credits rc
                     WHERE rc.client_id = c.id AND rc.status='available'), 0) AS reconstructed
    FROM clients c
    WHERE c.recovery_days_available > 0
  LOOP
    IF r.reconstructed < r.bal THEN
      INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, status)
      SELECT r.id, CURRENT_DATE, CURRENT_DATE + 30, 'migration', 'available'
      FROM generate_series(1, r.bal - r.reconstructed);
    END IF;
  END LOOP;
END $$;

-- ── 4. clients_full computes the live, expiry-aware balance ────────────────
CREATE OR REPLACE VIEW clients_full AS
 SELECT c.id,
    c.first_name AS "firstName",
    c.last_name AS "lastName",
    c.email,
    c.phone,
    c.birth_date AS "birthDate",
    c.cognitive_level AS "cognitiveLevel",
    c.start_date AS "startDate",
    ( SELECT count(*)::int FROM recovery_credits rc
      WHERE rc.client_id = c.id
        AND rc.status = 'available'
        AND rc.expires_at >= CURRENT_DATE ) AS "recoveryDaysAvailable",
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
            WHEN mi.id IS NOT NULL THEN jsonb_build_object('dietaryRestrictions', mi.dietary_restrictions, 'medicalRestrictions', mi.medical_restrictions, 'mobilityRestrictions', mi.mobility_restrictions, 'medication', mi.medication, 'medicationSchedule', mi.medication_schedule, 'notes', mi.notes)
            ELSE NULL::jsonb
        END AS "medicalInfo"
   FROM clients c
     LEFT JOIN client_plans cp ON c.id = cp.client_id
     LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- ── 5. create_client_full no longer references recovery_days_available ──────
-- Overload A (no distance_range)
CREATE OR REPLACE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT false,
  p_plan_assigned_days text[] DEFAULT '{}', p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_med_dietary text DEFAULT NULL,
  p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL, p_med_medication text DEFAULT NULL,
  p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date)
  RETURNING id INTO v_client_id;
  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (v_client_id, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days);
  END IF;
  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (v_client_id, p_ec_name, p_ec_relationship, p_ec_phone);
  END IF;
  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge);
  END IF;
  INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes)
  VALUES (v_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes);
  RETURN v_client_id;
END;
$function$;

-- Overload B (with distance_range)
CREATE OR REPLACE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT false,
  p_plan_assigned_days text[] DEFAULT '{}', p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_med_dietary text DEFAULT NULL, p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL,
  p_med_medication text DEFAULT NULL, p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date)
  RETURNING id INTO v_client_id;
  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (v_client_id, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days);
  END IF;
  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (v_client_id, p_ec_name, p_ec_relationship, p_ec_phone);
  END IF;
  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range);
  END IF;
  INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes)
  VALUES (v_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes);
  RETURN v_client_id;
END;
$function$;

-- ── 6. Derived-balance helper (available, not expired) ─────────────────────
CREATE OR REPLACE FUNCTION _recovery_balance(p_client_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM recovery_credits
  WHERE client_id = p_client_id AND status = 'available' AND expires_at >= CURRENT_DATE
$$;

-- ── 7. Justified absence grants a credit (expires granted_at + 30) ─────────
CREATE OR REPLACE FUNCTION public.mark_day_absent(p_client_id uuid, p_date date, p_is_justified boolean DEFAULT false, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
BEGIN
  INSERT INTO attendance_records (client_id, date, status, is_justified)
  VALUES (p_client_id, p_date, 'absent', p_is_justified)
  ON CONFLICT (client_id, date) DO UPDATE SET status='absent', is_justified=EXCLUDED.is_justified, updated_at=NOW()
  RETURNING id INTO v_record_id;
  IF p_is_justified THEN
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, grant_attendance_id, created_by_name)
    VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_record_id, p_created_by)
    RETURNING id INTO v_credit_id;
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
    VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by, v_credit_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'recordId', v_record_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.unmark_day_absent(p_client_id uuid, p_date date, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_old_justified BOOLEAN; v_record_id UUID; v_new_balance INTEGER;
BEGIN
  SELECT id, is_justified INTO v_record_id, v_old_justified
  FROM attendance_records WHERE client_id=p_client_id AND date=p_date AND status='absent';
  IF v_record_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'No existe falta para este día'); END IF;
  UPDATE attendance_records SET status='attended', is_justified=NULL, updated_at=NOW() WHERE id=v_record_id;
  IF v_old_justified THEN
    DELETE FROM recovery_credits WHERE grant_attendance_id=v_record_id AND status='available';
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_justified_absence', v_record_id, v_new_balance, p_created_by);
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── 8. Vacation on a paid month grants a credit ────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_day_vacation(p_client_id uuid, p_date date, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_month_paid BOOLEAN; v_credit_id UUID; v_new_balance INTEGER; v_year INTEGER; v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1;
  SELECT (payment_status='paid') INTO v_month_paid FROM monthly_invoices
  WHERE client_id=p_client_id AND year=v_year AND month=v_month;
  INSERT INTO attendance_records (client_id, date, status)
  VALUES (p_client_id, p_date, 'vacation')
  ON CONFLICT (client_id, date) DO UPDATE SET status='vacation', is_justified=NULL, updated_at=NOW()
  RETURNING id INTO v_record_id;
  IF v_month_paid THEN
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, grant_attendance_id, created_by_name)
    VALUES (p_client_id, p_date, p_date + 30, 'vacation_post_payment', v_record_id, p_created_by)
    RETURNING id INTO v_credit_id;
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
    VALUES (p_client_id, p_date, 1, 'vacation_post_payment', v_record_id, v_new_balance, p_created_by, v_credit_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'creditEarned', COALESCE(v_month_paid, false));
END;
$function$;

CREATE OR REPLACE FUNCTION public.unmark_day_vacation(p_client_id uuid, p_date date, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_month_paid BOOLEAN; v_new_balance INTEGER; v_year INTEGER; v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1;
  SELECT id INTO v_record_id FROM attendance_records
  WHERE client_id=p_client_id AND date=p_date AND status='vacation';
  IF v_record_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'No existe vacación para este día'); END IF;
  SELECT (payment_status='paid') INTO v_month_paid FROM monthly_invoices
  WHERE client_id=p_client_id AND year=v_year AND month=v_month;
  UPDATE attendance_records SET
    status = CASE WHEN p_date >= CURRENT_DATE THEN 'scheduled' ELSE 'attended' END, updated_at=NOW()
  WHERE id=v_record_id;
  IF v_month_paid THEN
    DELETE FROM recovery_credits WHERE grant_attendance_id=v_record_id AND status='available';
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_vacation_post_payment', v_record_id, v_new_balance, p_created_by);
  END IF;
  RETURN jsonb_build_object('success', true, 'creditRevoked', COALESCE(v_month_paid, false));
END;
$function$;

-- ── 9. Consuming a recovery day uses the soonest-expiring credit (FIFO) ─────
CREATE OR REPLACE FUNCTION public.mark_day_recovery_attended(p_client_id uuid, p_date date, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_credit_id UUID; v_record_id UUID; v_new_balance INTEGER;
BEGIN
  SELECT id INTO v_credit_id FROM recovery_credits
  WHERE client_id=p_client_id AND status='available' AND expires_at >= CURRENT_DATE
  ORDER BY expires_at ASC, granted_at ASC
  LIMIT 1 FOR UPDATE;
  IF v_credit_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Sin días de recupero disponibles'); END IF;
  INSERT INTO attendance_records (client_id, date, status) VALUES (p_client_id, p_date, 'recovery')
  ON CONFLICT (client_id, date) DO UPDATE SET status='recovery', updated_at=NOW()
  RETURNING id INTO v_record_id;
  UPDATE recovery_credits SET status='consumed', consumed_at=p_date, consumed_attendance_id=v_record_id, updated_at=NOW()
  WHERE id=v_credit_id;
  v_new_balance := _recovery_balance(p_client_id);
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
  VALUES (p_client_id, p_date, -1, 'recovery_attendance', v_record_id, v_new_balance, p_created_by, v_credit_id);
  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance);
END;
$function$;

CREATE OR REPLACE FUNCTION public.unmark_day_recovery_attended(p_client_id uuid, p_date date, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
BEGIN
  SELECT id INTO v_record_id FROM attendance_records
  WHERE client_id=p_client_id AND date=p_date AND status='recovery';
  IF v_record_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'No existe recupero para este día'); END IF;
  SELECT id INTO v_credit_id FROM recovery_credits WHERE consumed_attendance_id=v_record_id;
  IF v_credit_id IS NOT NULL THEN
    UPDATE recovery_credits SET status='available', consumed_at=NULL, consumed_attendance_id=NULL, updated_at=NOW()
    WHERE id=v_credit_id;
  ELSE
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, created_by_name)
    VALUES (p_client_id, CURRENT_DATE, CURRENT_DATE + 30, 'manual', p_created_by)
    RETURNING id INTO v_credit_id;
  END IF;
  DELETE FROM attendance_records WHERE id=v_record_id;
  v_new_balance := _recovery_balance(p_client_id);
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, balance_after, created_by_name, credit_id)
  VALUES (p_client_id, p_date, 1, 'reverted_recovery_attendance', v_new_balance, p_created_by, v_credit_id);
  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance);
END;
$function$;

-- ── 10. Discretionary add (+1, 30-day expiry, optional note) ───────────────
CREATE OR REPLACE FUNCTION public.add_recovery_credit(p_client_id uuid, p_note text DEFAULT NULL, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_credit_id UUID; v_new_balance INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id=p_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;
  INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, note, created_by_name)
  VALUES (p_client_id, CURRENT_DATE, CURRENT_DATE + 30, 'manual', NULLIF(TRIM(p_note), ''), p_created_by)
  RETURNING id INTO v_credit_id;
  v_new_balance := _recovery_balance(p_client_id);
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, balance_after, created_by_name, credit_id)
  VALUES (p_client_id, CURRENT_DATE, 1, 'manual_add', v_new_balance, p_created_by, v_credit_id);
  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance, 'creditId', v_credit_id);
END;
$function$;

-- ── 11. Revoke a credit (stays in table, status='revoked') ─────────────────
CREATE OR REPLACE FUNCTION public.revoke_recovery_credit(p_credit_id uuid, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID; v_new_balance INTEGER;
BEGIN
  UPDATE recovery_credits SET status='revoked', revoked_at=NOW(), updated_at=NOW()
  WHERE id=p_credit_id AND status='available'
  RETURNING client_id INTO v_client_id;
  IF v_client_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Crédito no disponible'); END IF;
  v_new_balance := _recovery_balance(v_client_id);
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, balance_after, created_by_name, credit_id)
  VALUES (v_client_id, CURRENT_DATE, -1, 'manual_revoke', v_new_balance, p_created_by, p_credit_id);
  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance);
END;
$function$;

-- ── 12. Drop the legacy counter (clients_full is now the source of truth) ──
ALTER TABLE clients DROP COLUMN IF EXISTS recovery_days_available;
