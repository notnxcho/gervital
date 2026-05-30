# Recovery Credits with 30-Day Expiry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `recovery_days_available` counter with individual recovery-credit records that each expire 30 calendar days after being granted, and surface them through a clickable card that opens a management modal (list with per-credit expiry + remove, header count + discretionary add).

**Architecture:** A new `recovery_credits` table holds one row per earned/added day. The available balance becomes a derived value (`status='available' AND expires_at >= CURRENT_DATE`), computed in the `clients_full` view — so expiry is automatic and lazy (no cron). The `clients.recovery_days_available` column is dropped. All existing attendance RPCs are rewritten to insert/consume/revoke credit rows (FIFO consumption) instead of incrementing a counter, and two new RPCs (`add_recovery_credit`, `revoke_recovery_credit`) are added. Frontend gets a new `recoveryService`, a `RecoveryCreditsModal`, and wiring in `ClientDetail`.

**Tech Stack:** Supabase (PostgreSQL, plpgsql RPCs, SECURITY DEFINER), React 19, Tailwind 3 (manual compile), iconoir-react, date-fns. Apply SQL via the Supabase MCP (`apply_migration` / `execute_sql`). No JS test framework is in use (only the default CRA `App.test.js`), so DB layer is verified with live SQL queries and frontend with `npm run build` + manual checks.

**Reference:** Design spec at `docs/superpowers/specs/2026-05-30-recovery-credits-expiry-design.md`.

---

## File Structure

- **Create** `supabase/migrations/017_recovery_credits.sql` — table, indexes, RLS, ledger column, view rewrite, backfill, RPC rewrites, new RPCs, column drop.
- **Create** `src/services/recovery/recoveryService.js` — `getRecoveryCredits`, `addRecoveryCredit`, `revokeRecoveryCredit`.
- **Modify** `src/services/api.js` — re-export the recovery service.
- **Create** `src/pages/Clients/RecoveryCreditsModal.jsx` — the management modal.
- **Modify** `src/pages/Clients/ClientDetail.jsx` — imports, state, load, refresh, the card→button, render the modal.

---

## Task 1: SQL migration — table, RLS, ledger column

**Files:**
- Create: `supabase/migrations/017_recovery_credits.sql`

- [ ] **Step 1: Create the migration file with the table + indexes + RLS + ledger column**

Create `supabase/migrations/017_recovery_credits.sql` with this content (later steps append more to the same file):

```sql
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
CREATE POLICY "recovery_credits_select" ON recovery_credits FOR SELECT USING (is_authenticated());
CREATE POLICY "recovery_credits_insert" ON recovery_credits FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "recovery_credits_update" ON recovery_credits FOR UPDATE USING (is_authenticated());
CREATE POLICY "recovery_credits_delete" ON recovery_credits FOR DELETE USING (is_authenticated());

-- ── 2. ledger gains a credit reference ─────────────────────────────────────
ALTER TABLE recovery_credit_ledger ADD COLUMN IF NOT EXISTS credit_id UUID;
```

- [ ] **Step 2: Do NOT apply yet** — the migration is applied once, after the whole file is assembled in Tasks 1–5. Proceed to Task 2 to append more SQL to the same file.

---

## Task 2: SQL migration — backfill, view rewrite, `create_client_full`

**Files:**
- Modify: `supabase/migrations/017_recovery_credits.sql` (append)

- [ ] **Step 1: Append the backfill block** (runs while the column still exists)

```sql
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
```

- [ ] **Step 2: Append the `clients_full` view rewrite** (the only change vs. the live def is the `recoveryDaysAvailable` expression)

```sql
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
```

- [ ] **Step 3: Append both `create_client_full` overloads without the dropped column**

```sql
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
```

---

## Task 3: SQL migration — helper + rewritten attendance RPCs

**Files:**
- Modify: `supabase/migrations/017_recovery_credits.sql` (append)

- [ ] **Step 1: Append the balance helper**

```sql
-- ── 6. Derived-balance helper (available, not expired) ─────────────────────
CREATE OR REPLACE FUNCTION _recovery_balance(p_client_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM recovery_credits
  WHERE client_id = p_client_id AND status = 'available' AND expires_at >= CURRENT_DATE
$$;
```

- [ ] **Step 2: Append the four mark/unmark absent + vacation RPCs (insert/delete credits instead of ±1)**

```sql
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
```

- [ ] **Step 3: Append the recovery consume/unconsume RPCs (FIFO)**

```sql
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
```

---

## Task 4: SQL migration — new RPCs + drop column

**Files:**
- Modify: `supabase/migrations/017_recovery_credits.sql` (append)

- [ ] **Step 1: Append the manual add + revoke RPCs**

```sql
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
```

- [ ] **Step 2: Append the column drop** (last — after view + RPCs no longer reference it)

```sql
-- ── 12. Drop the legacy counter (clients_full is now the source of truth) ──
ALTER TABLE clients DROP COLUMN recovery_days_available;
```

- [ ] **Step 3: Apply the full migration**

Apply `supabase/migrations/017_recovery_credits.sql` via the Supabase MCP `apply_migration` tool (name: `017_recovery_credits`, the file's full SQL as `query`).
Expected: success, no error.

- [ ] **Step 4: Verify schema + view + balance helper**

Run via MCP `execute_sql`:
```sql
SELECT to_regclass('public.recovery_credits') AS tbl;                       -- expect: recovery_credits
SELECT column_name FROM information_schema.columns
  WHERE table_name='clients' AND column_name='recovery_days_available';     -- expect: 0 rows
SELECT "recoveryDaysAvailable" FROM clients_full LIMIT 1;                    -- expect: an integer (0+), no error
```
Expected: table exists; column gone; view query succeeds.

- [ ] **Step 5: Verify grant + FIFO consume + revoke + expiry on a throwaway client**

Run via MCP `execute_sql` (uses a real client id; pick one with `SELECT id FROM clients LIMIT 1`):
```sql
-- replace :cid with a real client id
-- grant two credits, different expiries
INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, status)
VALUES (':cid', CURRENT_DATE, CURRENT_DATE + 5,  'manual', 'available'),
       (':cid', CURRENT_DATE, CURRENT_DATE + 20, 'manual', 'available');
SELECT _recovery_balance(':cid');                                  -- expect: 2

-- FIFO: consuming should mark the +5 (soonest) one consumed
SELECT mark_day_recovery_attended(':cid', CURRENT_DATE, 'tester');
SELECT expires_at, status FROM recovery_credits
  WHERE client_id=':cid' ORDER BY expires_at;                      -- expect: +5 consumed, +20 available

-- expiry: a past-dated credit must not count
INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, status)
VALUES (':cid', CURRENT_DATE - 40, CURRENT_DATE - 10, 'manual', 'available');
SELECT _recovery_balance(':cid');                                  -- expect: 1 (the +20 only)

-- add + revoke RPCs
SELECT add_recovery_credit(':cid', 'prueba', 'tester');            -- balance 2
SELECT revoke_recovery_credit(
  (SELECT id FROM recovery_credits WHERE client_id=':cid' AND note='prueba'), 'tester');  -- balance 1

-- cleanup the test rows
DELETE FROM attendance_records WHERE client_id=':cid' AND date=CURRENT_DATE AND status='recovery';
DELETE FROM recovery_credits WHERE client_id=':cid';
DELETE FROM recovery_credit_ledger WHERE client_id=':cid';
```
Expected: each balance assertion matches the comment. Confirm no rows remain: `SELECT count(*) FROM recovery_credits WHERE client_id=':cid';` → 0.

- [ ] **Step 6: Commit the migration**

```bash
git add supabase/migrations/017_recovery_credits.sql
git commit -m "feat(recovery): recovery_credits table, expiry-aware view + RPCs (migration 017)"
```

---

## Task 5: Frontend service `recoveryService.js` + api.js re-export

**Files:**
- Create: `src/services/recovery/recoveryService.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Create `src/services/recovery/recoveryService.js`**

```javascript
import { supabase } from '../supabase/client'

/**
 * Available recovery credits for a client (not expired, not consumed/revoked),
 * soonest-expiring first.
 * @param {string} clientId
 * @returns {Promise<Array<{id, grantedAt, expiresAt, source, note}>>}
 */
export async function getRecoveryCredits(clientId) {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('recovery_credits')
    .select('id, granted_at, expires_at, source, note')
    .eq('client_id', clientId)
    .eq('status', 'available')
    .gte('expires_at', today)
    .order('expires_at', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(c => ({
    id: c.id,
    grantedAt: c.granted_at,
    expiresAt: c.expires_at,
    source: c.source,
    note: c.note
  }))
}

/**
 * Add one discretionary recovery credit (expires in 30 days) with an optional note.
 * @param {string} clientId
 * @param {string} note
 * @param {string} userName
 * @returns {Promise<{success: boolean, recoveryDaysAvailable: number, creditId: string}>}
 */
export async function addRecoveryCredit(clientId, note, userName) {
  const { data, error } = await supabase.rpc('add_recovery_credit', {
    p_client_id: clientId,
    p_note: note || null,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al agregar día de recupero')
  return data
}

/**
 * Revoke a recovery credit (kept for audit, no longer counts).
 * @param {string} creditId
 * @param {string} userName
 * @returns {Promise<{success: boolean, recoveryDaysAvailable: number}>}
 */
export async function revokeRecoveryCredit(creditId, userName) {
  const { data, error } = await supabase.rpc('revoke_recovery_credit', {
    p_credit_id: creditId,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al remover día de recupero')
  return data
}
```

- [ ] **Step 2: Re-export from `src/services/api.js`**

Append after the attendance re-export block (the file currently ends its attendance export at `} from './attendance/attendanceService'`):

```javascript
export {
  getRecoveryCredits,
  addRecoveryCredit,
  revokeRecoveryCredit
} from './recovery/recoveryService'
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds (no "module not found" / unresolved export). Stop and fix if it fails.

- [ ] **Step 4: Commit**

```bash
git add src/services/recovery/recoveryService.js src/services/api.js
git commit -m "feat(recovery): recoveryService (get/add/revoke credits)"
```

---

## Task 6: `RecoveryCreditsModal` component

**Files:**
- Create: `src/pages/Clients/RecoveryCreditsModal.jsx`

- [ ] **Step 1: Create `src/pages/Clients/RecoveryCreditsModal.jsx`**

```jsx
import { useState } from 'react'
import { Plus, Trash } from 'iconoir-react'
import { differenceInCalendarDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { addRecoveryCredit, revokeRecoveryCredit } from '../../services/api'

const SOURCE_LABELS = {
  justified_absence: 'Falta justificada',
  vacation_post_payment: 'Vacación',
  manual: 'Manual',
  migration: 'Migrado'
}

// Urgency color by days remaining (≤7 red, ≤14 amber, else neutral)
function urgencyClasses(daysLeft) {
  if (daysLeft <= 7) return 'text-red-600'
  if (daysLeft <= 14) return 'text-amber-600'
  return 'text-gray-500'
}

export default function RecoveryCreditsModal({ isOpen, onClose, credits, canMutate, userName, clientId, onChanged }) {
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const [processingId, setProcessingId] = useState(null)
  const [savingAdd, setSavingAdd] = useState(false)

  const handleAdd = async () => {
    setSavingAdd(true)
    try {
      await addRecoveryCredit(clientId, note, userName)
      setNote('')
      setAdding(false)
      await onChanged()
    } catch (e) {
      console.error(e)
    } finally {
      setSavingAdd(false)
    }
  }

  const handleRevoke = async (creditId) => {
    setProcessingId(creditId)
    try {
      await revokeRecoveryCredit(creditId, userName)
      await onChanged()
    } catch (e) {
      console.error(e)
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Días de recupero" size="md">
      {/* Header: total count + add */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-lg bg-indigo-100 text-indigo-700 text-lg font-bold">
            {credits.length}
          </span>
          <span className="text-sm text-gray-500">
            {credits.length === 1 ? 'día disponible' : 'días disponibles'}
          </span>
        </div>
        {canMutate && !adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="w-4 h-4" /> Agregar
          </Button>
        )}
      </div>

      {/* Inline add form */}
      {canMutate && adding && (
        <div className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Nota (opcional)"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          <p className="mt-1 text-xs text-gray-400">Vence en 30 días desde hoy.</p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setNote('') }}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={handleAdd} loading={savingAdd}>Agregar día</Button>
          </div>
        </div>
      )}

      {/* Credit list */}
      {credits.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No hay días de recupero disponibles</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {credits.map(c => {
            const daysLeft = differenceInCalendarDays(new Date(c.expiresAt), new Date())
            return (
              <li key={c.id} className="flex items-center justify-between py-3">
                <div>
                  <p className={`text-sm font-medium ${urgencyClasses(daysLeft)}`}>
                    Vence el {format(new Date(c.expiresAt), "d 'de' MMM", { locale: es })}
                    <span className="font-normal"> · en {daysLeft} {daysLeft === 1 ? 'día' : 'días'}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {SOURCE_LABELS[c.source] || c.source}{c.note ? ` · ${c.note}` : ''}
                  </p>
                </div>
                {canMutate && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(c.id)}
                    disabled={processingId === c.id}
                    className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-50"
                    title="Remover día"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds. The component isn't rendered yet (wired in Task 7), but imports/JSX must compile.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clients/RecoveryCreditsModal.jsx
git commit -m "feat(recovery): RecoveryCreditsModal (list + add + revoke)"
```

---

## Task 7: Wire the button + modal into `ClientDetail`

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Add imports**

In `src/pages/Clients/ClientDetail.jsx`, add `NavArrowRight` to the existing iconoir import on line 3:
```jsx
import { ArrowLeft, Edit, Phone, MapPin, Calendar, MoreVert, Trash, Check, NavArrowDown, NavArrowRight } from 'iconoir-react'
```
Add `getRecoveryCredits` to the `../../services/api` import block (after `unmarkDayRecoveryAttended,` on line 26):
```jsx
  unmarkDayRecoveryAttended,
  getRecoveryCredits,
```
Add the modal component import after the `DeactivateClientModal` import (line 37):
```jsx
import RecoveryCreditsModal from './RecoveryCreditsModal'
```

- [ ] **Step 2: Add state** (after the `uploadingAvatar` state, line 107)

```jsx
  const [recoveryCredits, setRecoveryCredits] = useState([])
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false)
```

- [ ] **Step 3: Load credits in `loadClientData`**

In the `Promise.all` at line 131, add `getRecoveryCredits(id)` and capture it:
```jsx
      const [clientData, attendanceData, invoicesData, pricing, transportPricing, recoveryData] = await Promise.all([
        getClientById(id),
        getClientAttendance(id),
        getClientInvoices(id),
        getPlanPricing(),
        getTransportPricing(),
        getRecoveryCredits(id)
      ])
```
And set it alongside the other setters (after `setClient(clientData)` on line 147):
```jsx
      setRecoveryCredits(recoveryData)
```

- [ ] **Step 4: Add a lightweight refresh** (used by the modal so it doesn't trigger the full-page spinner). Add right after the `loadClientData` function (after line 157):

```jsx
  const refreshRecovery = async () => {
    const [clientData, recoveryData] = await Promise.all([
      getClientById(id),
      getRecoveryCredits(id)
    ])
    setClient(clientData)
    setRecoveryCredits(recoveryData)
  }
```

- [ ] **Step 5: Replace the recovery-days card block with a button**

Replace the block at `src/pages/Clients/ClientDetail.jsx:384-387`:
```jsx
          <div className="text-right">
            <p className="text-sm text-gray-500">Días de recupero</p>
            <p className="text-2xl font-bold text-indigo-600">{client.recoveryDaysAvailable}</p>
          </div>
```
with:
```jsx
          <button
            type="button"
            onClick={() => setRecoveryModalOpen(true)}
            className="flex items-center gap-3 text-right rounded-lg px-2 py-1 hover:bg-gray-50 transition-colors"
          >
            <div>
              <p className="text-sm text-gray-500">Días de recupero</p>
              <p className="text-2xl font-bold text-indigo-600">{client.recoveryDaysAvailable}</p>
              <p className={`text-xs ${nextExpiry.className}`}>{nextExpiry.label}</p>
            </div>
            <NavArrowRight className="w-5 h-5 text-gray-400" />
          </button>
```

- [ ] **Step 6: Compute `nextExpiry`** for the sub-label. Add inside the component body, before the `return` (the main `return (` of `ClientDetail`, just after `loading`/`client` guards — i.e. where `client` is guaranteed non-null). Place it next to other derived values used in the JSX:

```jsx
  const nextExpiry = (() => {
    if (!recoveryCredits.length) return { label: 'Sin días', className: 'text-gray-400' }
    const soonest = recoveryCredits[0].expiresAt // service returns soonest-first
    const daysLeft = differenceInCalendarDays(new Date(soonest), new Date())
    const className = daysLeft <= 7 ? 'text-red-600' : daysLeft <= 14 ? 'text-amber-600' : 'text-gray-400'
    return { label: `Vence el ${format(new Date(soonest), "d 'de' MMM", { locale: es })}`, className }
  })()
```
Add `differenceInCalendarDays` to the existing `date-fns` import on line 4:
```jsx
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, differenceInCalendarDays } from 'date-fns'
```

- [ ] **Step 7: Render the modal**

Add near the other top-level modals in `ClientDetail`'s JSX (e.g. right after the `<DeactivateClientModal ... />` render). NOTE: the top-level `ClientDetail` scope does **not** have an `isDeactivated` variable (that one at line ~559 belongs to the inner billing component). The top-level component checks `client.deletedAt` directly (see lines 303/315/330), so use that for `canMutate`:
```jsx
      <RecoveryCreditsModal
        isOpen={recoveryModalOpen}
        onClose={() => setRecoveryModalOpen(false)}
        credits={recoveryCredits}
        canMutate={!client.deletedAt}
        userName={user?.name}
        clientId={id}
        onChanged={refreshRecovery}
      />
```

- [ ] **Step 8: Recompile Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: writes `src/tailwind.output.css` with no errors.

- [ ] **Step 9: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 10: Manual verification** (run `npm start`, open a client detail)

Confirm:
- The "Días de recupero" block is now a button showing the count, the arrow icon, and a sub-label ("Sin días" when 0).
- Clicking opens the modal: header shows the count + "Agregar"; empty state reads "No hay días de recupero disponibles".
- "Agregar" → optional note → "Agregar día": count increments, a row appears ("Vence el … · en 30 días", source "Manual"), and the card sub-label updates to the soonest expiry.
- The 🗑 on a row removes it (count decrements, row disappears).
- On a deactivated client, the button still opens the modal but "Agregar" and 🗑 are hidden.

- [ ] **Step 11: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx src/tailwind.output.css
git commit -m "feat(recovery): client detail recovery-days button + management modal"
```

---

## Self-Review Notes (coverage check)

- **30-day expiry** → `expires_at = granted_at + 30`, balance filters `expires_at >= CURRENT_DATE` (Tasks 1–4). Lazy, no cron.
- **Card button (arrow + soonest-expiry sub-label)** → Task 7 Steps 5–6.
- **Modal: list with per-credit expiry + remove** → Task 6 (list + Trash → `revokeRecoveryCredit`).
- **Modal header: total count + add** → Task 6 (count badge + Plus → inline note form → `addRecoveryCredit`).
- **FIFO consumption** → `mark_day_recovery_attended` orders `expires_at ASC` (Task 3).
- **Migrate from ledger** → Task 2 backfill (no-op on current data).
- **Add = +1 with note** → `add_recovery_credit` (Task 4) + modal note field (Task 6).
- **Remove = revoke + audit** → `revoke_recovery_credit` sets `status='revoked'`, ledger `-1` (Task 4).
- **Deactivated client hides mutations** → `canMutate={!isDeactivated}` (Task 7 Step 7).
- **Existing reads stay correct** → `clients_full` recomputed; ClientList badge + calendar gate unchanged.
