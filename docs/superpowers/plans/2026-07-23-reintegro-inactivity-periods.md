# Reintegro con fecha/plan + períodos de inactividad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Al reintegrar un cliente dado de baja, elegir una fecha de reintegro (retroactiva/hoy/futura) y un plan (preseleccionado con el que tenía a la baja), guardando el gap de inactividad de forma durable para que los días entre baja y reintegro nunca se marquen como asistidos ni se cobren.

**Architecture:** Nueva tabla `client_inactivity_periods` = fuente de verdad de los gaps. `clients.deactivation_date`/`deleted_at` se conservan como caché de estado actual (no se tocan los ~15 filtros dispersos). Calendario y `calculate_month_billing` excluyen por día cualquier día dentro de un período. Reintegro futuro se auto-cura en carga vía `apply_due_reactivations()`.

**Tech Stack:** React 19, Supabase (PostgreSQL RPC + RLS), date-fns, Tailwind (compilación manual).

## Global Constraints

- Variables/código en inglés; textos de UI en español.
- Sin `;` en JS/JSX cuando no es obligatorio.
- Servicios en `src/services/<domain>/`; `api.js` re-exporta (facade).
- `clients_full` es VIEW `security_invoker=on`: **re-asertar** `ALTER VIEW clients_full SET (security_invoker = on)` tras cualquier `CREATE OR REPLACE VIEW`.
- Agregar params a un RPC crea overloads nuevos: **DROP** de la firma vieja para evitar "function is not unique".
- Recompilar Tailwind tras clases nuevas: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.
- Semántica de corte: inactivo el día `D` ⇔ período con `D >= from_date AND (to_date IS NULL OR D < to_date)`. `to_date` = primer día activo de nuevo.
- Migraciones NO se aplican a producción sin coordinar; se verifican en branch de Supabase.

---

### Task 1: Helper puro `inactivityPeriods.js` (TDD)

**Files:**
- Create: `src/services/clients/inactivityPeriods.js`
- Test: `src/services/clients/inactivityPeriods.test.js`

**Interfaces:**
- Produces:
  - `isInactiveOn(dateStr, periods) => boolean` — `dateStr` en `'YYYY-MM-DD'`; `periods` = array de `{ fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD'|null }`. `true` si el día cae en algún período `[fromDate, toDate)` (toDate NULL = abierto).
  - `dayInAnyPeriod(dateStr, periods)` — alias export (mismo comportamiento) para lectura semántica en calendario.

- [ ] **Step 1: Escribir el test que falla**

```js
import { isInactiveOn } from './inactivityPeriods'

describe('isInactiveOn', () => {
  const periods = [{ fromDate: '2026-03-10', toDate: '2026-06-15' }]

  test('día antes del período: activo', () => {
    expect(isInactiveOn('2026-03-09', periods)).toBe(false)
  })
  test('primer día del gap (from inclusive): inactivo', () => {
    expect(isInactiveOn('2026-03-10', periods)).toBe(true)
  })
  test('día en medio del gap: inactivo', () => {
    expect(isInactiveOn('2026-05-01', periods)).toBe(true)
  })
  test('día de reintegro (to exclusive): activo', () => {
    expect(isInactiveOn('2026-06-15', periods)).toBe(false)
  })
  test('período abierto (to null): inactivo desde from en adelante', () => {
    expect(isInactiveOn('2027-01-01', [{ fromDate: '2026-03-10', toDate: null }])).toBe(true)
  })
  test('múltiples períodos: matchea cualquiera', () => {
    const two = [
      { fromDate: '2026-03-10', toDate: '2026-06-15' },
      { fromDate: '2026-09-01', toDate: null }
    ]
    expect(isInactiveOn('2026-07-01', two)).toBe(false)
    expect(isInactiveOn('2026-09-02', two)).toBe(true)
  })
  test('sin períodos / null: activo', () => {
    expect(isInactiveOn('2026-05-01', [])).toBe(false)
    expect(isInactiveOn('2026-05-01', null)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `CI=true npx react-scripts test src/services/clients/inactivityPeriods.test.js --watchAll=false`
Expected: FAIL ("Cannot find module './inactivityPeriods'").

- [ ] **Step 3: Implementación mínima**

```js
// Períodos de inactividad de un cliente: [fromDate, toDate). toDate null = abierto.
// Comparación por string 'YYYY-MM-DD' (ordena lexicográficamente = cronológicamente).

export function isInactiveOn(dateStr, periods) {
  if (!dateStr || !Array.isArray(periods)) return false
  return periods.some(p =>
    p && dateStr >= p.fromDate && (p.toDate == null || dateStr < p.toDate)
  )
}

export const dayInAnyPeriod = isInactiveOn
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `CI=true npx react-scripts test src/services/clients/inactivityPeriods.test.js --watchAll=false`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/inactivityPeriods.js src/services/clients/inactivityPeriods.test.js
git commit -m "feat(reintegro): helper puro isInactiveOn + tests"
```

---

### Task 2: Migración 070 — tabla, índices, RLS, backfill, RPCs de baja/reintegro

**Files:**
- Create: `supabase/migrations/070_client_inactivity_periods.sql`

**Interfaces:**
- Produces (RPCs consumidas por el frontend en Task 6):
  - `reactivate_client(p_client_id uuid, p_reactivation_date date, p_frequency int, p_schedule text, p_has_transport boolean, p_assigned_days text[], p_distance_range text)` → uuid
  - `apply_due_reactivations()` → integer (cantidad de clientes reactivados)
  - Tabla `client_inactivity_periods` leída por la vista (Task 5) y billing (Task 4).

- [ ] **Step 1: Escribir la migración completa**

```sql
-- 070_client_inactivity_periods.sql
-- Fuente de verdad de los gaps de inactividad de un cliente.
-- clients.deactivation_date / deleted_at se conservan como caché de estado actual.

-- ── 1. Tabla ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_inactivity_periods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  from_date      date NOT NULL,             -- primer día inactivo (corte exclusivo)
  to_date        date,                      -- primer día activo de nuevo; NULL = abierto
  reason         text,
  notes          text,
  deactivated_by uuid,
  reactivated_by uuid,
  reactivated_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cip_dates_check CHECK (to_date IS NULL OR to_date > from_date)
);

CREATE INDEX IF NOT EXISTS idx_cip_client_from ON client_inactivity_periods(client_id, from_date);
-- A lo sumo un período abierto por cliente
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cip_open_per_client
  ON client_inactivity_periods(client_id) WHERE to_date IS NULL;

-- ── 2. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE client_inactivity_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cip_select_all ON client_inactivity_periods;
CREATE POLICY cip_select_all ON client_inactivity_periods
  FOR SELECT USING (true);
-- Escrituras solo vía RPCs SECURITY DEFINER (no policies de INSERT/UPDATE).

-- ── 3. Backfill: clientes actualmente dados de baja → período abierto ───────
INSERT INTO client_inactivity_periods (client_id, from_date, to_date, reason, notes, deactivated_by)
SELECT c.id, c.deactivation_date, NULL, c.deactivation_reason, c.deactivation_notes, c.deactivated_by
FROM clients c
WHERE c.deleted_at IS NOT NULL
  AND c.deactivation_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM client_inactivity_periods p
    WHERE p.client_id = c.id AND p.to_date IS NULL
  );

-- ── 4. deactivate_client: además, abre un período de inactividad ────────────
-- (Base: migración 045. Se recrea completa para mantener una sola definición viva.)
CREATE OR REPLACE FUNCTION public.deactivate_client(
  p_client_id uuid,
  p_reason text,
  p_notes text,
  p_user_id uuid,
  p_deactivation_date date DEFAULT CURRENT_DATE
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_clean_notes TEXT;
  v_date DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM deactivation_reasons WHERE key = p_reason AND is_active) THEN
    RAISE EXCEPTION 'Invalid deactivation reason: %', p_reason;
  END IF;

  v_clean_notes := NULLIF(trim(coalesce(p_notes, '')), '');
  IF p_reason = 'other' AND v_clean_notes IS NULL THEN
    RAISE EXCEPTION 'Notes required when reason is "other"';
  END IF;

  v_date := COALESCE(p_deactivation_date, CURRENT_DATE);

  UPDATE clients
     SET deleted_at = NOW(),
         deactivation_date = v_date,
         deactivation_reason = p_reason,
         deactivation_notes = v_clean_notes,
         deactivated_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_client_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or already deactivated';
  END IF;

  -- Abre el período (defensivo: elimina cualquier abierto huérfano antes)
  DELETE FROM client_inactivity_periods WHERE client_id = p_client_id AND to_date IS NULL;
  INSERT INTO client_inactivity_periods (client_id, from_date, to_date, reason, notes, deactivated_by)
  VALUES (p_client_id, v_date, NULL, p_reason, v_clean_notes, p_user_id);

  RETURN p_client_id;
END;
$function$;

-- ── 5. reactivate_client: fecha de reintegro + plan opcional ────────────────
-- DROP de la firma vieja (p_client_id) para evitar "function is not unique".
DROP FUNCTION IF EXISTS public.reactivate_client(uuid);

CREATE OR REPLACE FUNCTION public.reactivate_client(
  p_client_id uuid,
  p_reactivation_date date,
  p_frequency integer DEFAULT NULL,
  p_schedule text DEFAULT NULL,
  p_has_transport boolean DEFAULT NULL,
  p_assigned_days text[] DEFAULT NULL,
  p_distance_range text DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_from DATE;
BEGIN
  IF p_reactivation_date IS NULL THEN
    RAISE EXCEPTION 'Reactivation date required';
  END IF;

  -- Toma el período abierto (baja vigente)
  SELECT from_date INTO v_from
  FROM client_inactivity_periods
  WHERE client_id = p_client_id AND to_date IS NULL;

  IF v_from IS NULL THEN
    RAISE EXCEPTION 'Client not found or not deactivated';
  END IF;

  IF p_reactivation_date <= v_from THEN
    RAISE EXCEPTION 'Reactivation date must be after deactivation date (%)', v_from;
  END IF;

  -- Cierra el período
  UPDATE client_inactivity_periods
     SET to_date = p_reactivation_date,
         reactivated_at = NOW()
   WHERE client_id = p_client_id AND to_date IS NULL;

  -- Estado actual: activo ya si el reintegro es hoy o pasado; si es futuro, sigue baja.
  IF p_reactivation_date <= CURRENT_DATE THEN
    UPDATE clients
       SET deleted_at = NULL,
           deactivation_date = NULL,
           deactivation_reason = NULL,
           deactivation_notes = NULL,
           deactivated_by = NULL,
           updated_at = NOW()
     WHERE id = p_client_id;
  END IF;

  -- Plan opcional: solo si se pasaron los campos. set_client_plan_version es idempotente
  -- (upsert por mes) y trunca effective_from al inicio de mes.
  IF p_frequency IS NOT NULL AND p_schedule IS NOT NULL AND p_assigned_days IS NOT NULL THEN
    PERFORM set_client_plan_version(
      p_client_id,
      date_trunc('month', p_reactivation_date)::date,
      p_frequency,
      p_schedule,
      COALESCE(p_has_transport, false),
      p_assigned_days,
      p_distance_range,
      NULL
    );
  END IF;

  RETURN p_client_id;
END;
$function$;

-- ── 6. apply_due_reactivations: self-heal de reintegros futuros vencidos ─────
-- No hay cron. Voltea a activo cualquier cliente todavía marcado dado de baja
-- cuyo período abierto NO exista pero cuya baja quedó pendiente de flip porque
-- el reintegro era futuro y ya llegó. Idempotente.
CREATE OR REPLACE FUNCTION public.apply_due_reactivations()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH due AS (
    SELECT c.id
    FROM clients c
    WHERE c.deleted_at IS NOT NULL
      -- sin período abierto (el reintegro ya fue registrado con to_date)
      AND NOT EXISTS (
        SELECT 1 FROM client_inactivity_periods p
        WHERE p.client_id = c.id AND p.to_date IS NULL
      )
      -- el período más reciente ya venció (to_date <= hoy)
      AND EXISTS (
        SELECT 1 FROM client_inactivity_periods p
        WHERE p.client_id = c.id AND p.to_date IS NOT NULL AND p.to_date <= CURRENT_DATE
      )
  ), upd AS (
    UPDATE clients c
       SET deleted_at = NULL,
           deactivation_date = NULL,
           deactivation_reason = NULL,
           deactivation_notes = NULL,
           deactivated_by = NULL,
           updated_at = NOW()
     FROM due
    WHERE c.id = due.id
    RETURNING c.id
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;
```

- [ ] **Step 2: Sanity syntax check (no aplicar a prod)**

La verificación real es en branch (Task 11). Acá solo revisar visualmente: firma nueva de `reactivate_client`, DROP de la vieja, backfill idempotente.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/070_client_inactivity_periods.sql
git commit -m "feat(reintegro): migración tabla inactivity_periods + RPCs baja/reintegro"
```

---

### Task 3: Migración 071 — billing version-aware + exclusión por período + vista

**Files:**
- Create: `supabase/migrations/071_billing_view_inactivity.sql`

**Interfaces:**
- Consumes: tabla `client_inactivity_periods` (Task 2).
- Produces: `clients_full.inactivityPeriods` (jsonb array de `{fromDate,toDate}`) y `clients_full.scheduledReactivationDate` (Task 6/8 los consumen). `calculate_month_billing` corregido.

- [ ] **Step 1: Escribir la migración completa**

```sql
-- 071_billing_view_inactivity.sql
-- (a) calculate_month_billing: elige la versión de plan vigente para el mes objetivo
--     y excluye días dentro de cualquier período de inactividad.
-- (b) clients_full: expone inactivityPeriods y scheduledReactivationDate.

-- ── (a) calculate_month_billing ─────────────────────────────────────────────
-- Base: migración 068. Cambios marcados con CHANGED.
CREATE OR REPLACE FUNCTION calculate_month_billing(
  p_client_id UUID, p_year INTEGER, p_month INTEGER
) RETURNS JSONB AS $$
DECLARE
  v_client RECORD; v_plan RECORD; v_address RECORD;
  v_plan_price RECORD; v_transport_price RECORD;
  v_month_start DATE; v_month_end DATE; v_effective_start DATE; v_effective_end DATE;
  v_full_month_days INTEGER := 0; v_planned_days INTEGER := 0; v_vacation_days INTEGER := 0;
  v_recovery_days INTEGER := 0; v_chargeable_days INTEGER; v_days_per_month INTEGER; v_billed_days INTEGER;
  v_att_rate_net NUMERIC(12,2); v_att_rate_gross NUMERIC(12,2);
  v_att_charge_net NUMERIC(12,2) := 0; v_att_charge_gross NUMERIC(12,2) := 0;
  v_trans_rate_net NUMERIC(12,2) := 0; v_trans_rate_gross NUMERIC(12,2) := 0;
  v_trans_charge_net NUMERIC(12,2) := 0; v_trans_charge_gross NUMERIC(12,2) := 0;
  v_has_transport BOOLEAN := FALSE;
  v_day DATE; v_day_of_week INTEGER; v_day_name TEXT;
  v_proration_factor NUMERIC; v_discount NUMERIC := 0; v_discount_factor NUMERIC := 1;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client IS NULL THEN RETURN jsonb_build_object('error', 'Cliente no encontrado'); END IF;

  -- CHANGED: versión de plan vigente para el mes objetivo (antes tomaba una fila arbitraria)
  SELECT * INTO v_plan FROM client_plans
  WHERE client_id = p_client_id
    AND effective_from <= _month_start(p_year, p_month)
  ORDER BY effective_from DESC LIMIT 1;
  IF v_plan IS NULL THEN RETURN jsonb_build_object('error', 'Plan no encontrado'); END IF;

  SELECT price_net, price_gross INTO v_plan_price FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule
    AND (effective_year * 12 + effective_month) <= (p_year * 12 + p_month)
  ORDER BY (effective_year * 12 + effective_month) DESC LIMIT 1;
  IF v_plan_price IS NULL THEN RETURN jsonb_build_object('error', 'Precio de plan no encontrado'); END IF;
  v_att_rate_net := v_plan_price.price_net; v_att_rate_gross := v_plan_price.price_gross;

  IF v_plan.has_transport THEN
    SELECT * INTO v_address FROM client_addresses WHERE client_id = p_client_id;
    IF v_address IS NULL OR v_address.distance_range IS NULL THEN
      RETURN jsonb_build_object('error', 'Cliente con transporte requiere distancia definida');
    END IF;
    SELECT price_net, price_gross INTO v_transport_price FROM transport_pricing
    WHERE frequency = v_plan.frequency AND distance_range = v_address.distance_range
      AND (effective_year * 12 + effective_month) <= (p_year * 12 + p_month)
    ORDER BY (effective_year * 12 + effective_month) DESC LIMIT 1;
    IF v_transport_price IS NULL THEN RETURN jsonb_build_object('error', 'Precio de transporte no encontrado'); END IF;
    v_trans_rate_net := v_transport_price.price_net; v_trans_rate_gross := v_transport_price.price_gross;
    v_has_transport := TRUE;
  END IF;

  SELECT COALESCE(discount_percent, 0) INTO v_discount FROM monthly_invoices
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;
  v_discount := COALESCE(v_discount, 0);
  v_discount_factor := 1 - (v_discount / 100.0);

  v_month_start := _month_start(p_year, p_month);
  v_month_end := _month_end(p_year, p_month);
  v_effective_start := GREATEST(v_client.start_date, v_month_start);
  v_effective_end := LEAST(COALESCE(v_client.deactivation_date - 1, v_month_end), v_month_end);

  v_day := v_month_start;
  WHILE v_day <= v_month_end LOOP
    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
      WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' ELSE NULL END;

    IF v_day_name IS NOT NULL AND v_day_name = ANY(v_plan.assigned_days) THEN
      v_full_month_days := v_full_month_days + 1;
      -- CHANGED: excluye días dentro de cualquier período de inactividad [from, to)
      IF v_day >= v_effective_start AND v_day <= v_effective_end
         AND NOT EXISTS (
           SELECT 1 FROM client_inactivity_periods p
           WHERE p.client_id = p_client_id
             AND v_day >= p.from_date
             AND (p.to_date IS NULL OR v_day < p.to_date)
         ) THEN
        v_planned_days := v_planned_days + 1;
        IF EXISTS (
          SELECT 1 FROM attendance_records
          WHERE client_id = p_client_id AND date = v_day AND status = 'absent' AND is_chargeable = false
        ) THEN
          v_vacation_days := v_vacation_days + 1;
        END IF;
      END IF;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;

  SELECT COUNT(*) INTO v_recovery_days FROM attendance_records
  WHERE client_id = p_client_id AND date BETWEEN v_month_start AND v_month_end AND status = 'recovery';

  v_chargeable_days := v_planned_days - v_vacation_days;
  v_days_per_month := 4 * v_plan.frequency;
  v_billed_days := LEAST(GREATEST(v_chargeable_days, 0), v_days_per_month);

  IF v_days_per_month > 0 THEN
    v_proration_factor := v_billed_days::NUMERIC / v_days_per_month::NUMERIC;
    v_att_charge_gross := ROUND(v_proration_factor * v_att_rate_gross * v_discount_factor);
    v_att_charge_net := ROUND(v_proration_factor * v_att_rate_net * v_discount_factor);
    IF v_has_transport THEN
      v_trans_charge_gross := ROUND(v_proration_factor * v_trans_rate_gross);
      v_trans_charge_net := ROUND(v_proration_factor * v_trans_rate_net);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'fullMonthDays', v_full_month_days, 'plannedDays', v_planned_days,
    'vacationDays', v_vacation_days, 'recoveryDays', v_recovery_days,
    'daysPerMonth', v_days_per_month, 'chargeableDays', v_billed_days,
    'rawChargeableDays', v_chargeable_days, 'isProrated', v_billed_days < v_days_per_month,
    'effectiveEnd', v_effective_end, 'hasTransport', v_has_transport, 'discountPercent', v_discount,
    'attendanceMonthlyRateNet', v_att_rate_net, 'attendanceMonthlyRateGross', v_att_rate_gross,
    'attendanceChargeableNet', v_att_charge_net, 'attendanceChargeableGross', v_att_charge_gross,
    'transportMonthlyRateNet', v_trans_rate_net, 'transportMonthlyRateGross', v_trans_rate_gross,
    'transportChargeableNet', v_trans_charge_net, 'transportChargeableGross', v_trans_charge_gross,
    'totalChargeableGross', v_att_charge_gross + v_trans_charge_gross,
    'totalMonthlyRateGross', v_att_rate_gross + v_trans_rate_gross,
    'monthlyRate', v_att_rate_gross, 'chargeableAmount', v_att_charge_gross + v_trans_charge_gross
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── (b) clients_full: + inactivityPeriods + scheduledReactivationDate ───────
-- Base: migración 050 (transcrita verbatim), se agregan 2 columnas al final.
CREATE OR REPLACE VIEW clients_full AS
 SELECT c.id,
    c.first_name AS "firstName", c.last_name AS "lastName", c.email, c.phone,
    c.birth_date AS "birthDate", c.cognitive_level AS "cognitiveLevel", c.start_date AS "startDate",
    c.document_type AS "documentType", c.document_number AS "documentNumber",
    c.marital_status AS "maritalStatus", c.residence_type AS "residenceType", c.lives_with AS "livesWith",
    c.biller_client_id AS "billerClientId", c.biller_branch_id AS "billerBranchId",
    c.biller_synced_at AS "billerSyncedAt", c.biller_sync_error AS "billerSyncError",
    ( SELECT count(*)::integer FROM recovery_credits rc
       WHERE rc.client_id = c.id AND rc.status = 'available'::text AND rc.expires_at >= CURRENT_DATE) AS "recoveryDaysAvailable",
    c.avatar_url AS "avatarUrl", c.deleted_at AS "deletedAt",
    c.deactivation_reason AS "deactivationReason", c.deactivation_notes AS "deactivationNotes",
    c.created_at AS "createdAt",
    CASE WHEN cp.id IS NOT NULL THEN jsonb_build_object('frequency', cp.frequency, 'schedule', cp.schedule, 'hasTransport', cp.has_transport, 'assignedDays', cp.assigned_days) ELSE NULL::jsonb END AS plan,
    CASE WHEN ec.id IS NOT NULL THEN jsonb_build_object('name', ec.name, 'relationship', ec.relationship, 'phone', ec.phone) ELSE NULL::jsonb END AS "emergencyContact",
    CASE WHEN ca.id IS NOT NULL THEN jsonb_build_object('street', ca.street, 'accessNotes', ca.access_notes, 'doorbell', ca.doorbell, 'concierge', ca.concierge, 'latitude', ca.latitude, 'longitude', ca.longitude, 'distanceRange', ca.distance_range) ELSE NULL::jsonb END AS address,
    CASE WHEN mi.id IS NOT NULL THEN jsonb_build_object('healthEmergencyService', mi.health_emergency_service, 'healthProvider', mi.health_provider, 'healthNotes', mi.health_notes, 'medicationNotes', mi.medication_notes, 'historyNotes', mi.history_notes, 'educationLevel', mi.education_level, 'occupation', mi.occupation, 'significantInterests', mi.significant_interests, 'significantBonds', mi.significant_bonds, 'musicTaste', mi.music_taste, 'favoriteFoods', mi.favorite_foods, 'character', mi.personality_type, 'personalResources', mi.personal_resources, 'vulnerabilities', mi.vulnerabilities) ELSE NULL::jsonb END AS "medicalInfo",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', m.name, 'schedule', m.schedule, 'dose', m.dose, 'indicatedFor', m.indicated_for) ORDER BY m."position", m.created_at) FROM client_medications m WHERE m.client_id = c.id), '[]'::jsonb) AS medications,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('diagnosisType', d.diagnosis_type, 'behaviorDisorder', d.behavior_disorder) ORDER BY d."position", d.created_at) FROM client_diagnoses d WHERE d.client_id = c.id), '[]'::jsonb) AS diagnoses,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('condition', h.condition, 'comment', h.comment) ORDER BY h.created_at) FROM client_medical_history h WHERE h.client_id = c.id), '[]'::jsonb) AS "medicalHistory",
    c.transfer_responsible AS "transferResponsible",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', ec2.name, 'relationship', ec2.relationship, 'phone', ec2.phone) ORDER BY ec2."position", ec2.created_at) FROM emergency_contacts ec2 WHERE ec2.client_id = c.id), '[]'::jsonb) AS "emergencyContacts",
    c.deactivation_date AS "deactivationDate",
    c.client_type AS "clientType",
    EXISTS ( SELECT 1 FROM monthly_invoices minv WHERE minv.client_id = c.id AND minv.discount_percent > 0 AND minv.year = EXTRACT(YEAR FROM CURRENT_DATE)::int AND minv.month = (EXTRACT(MONTH FROM CURRENT_DATE)::int - 1)) AS "hasActiveDiscount",
    -- NEW: períodos de inactividad (para calendario/billing preview)
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('fromDate', p.from_date, 'toDate', p.to_date) ORDER BY p.from_date) FROM client_inactivity_periods p WHERE p.client_id = c.id), '[]'::jsonb) AS "inactivityPeriods",
    -- NEW: reintegro programado a futuro (to_date > hoy del período abierto/reciente)
    ( SELECT max(p.to_date) FROM client_inactivity_periods p WHERE p.client_id = c.id AND p.to_date > CURRENT_DATE) AS "scheduledReactivationDate"
   FROM clients c
     LEFT JOIN LATERAL ( SELECT cp2.id, cp2.frequency, cp2.schedule, cp2.has_transport, cp2.assigned_days
           FROM client_plans cp2 WHERE cp2.client_id = c.id AND cp2.effective_from <= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date
          ORDER BY cp2.effective_from DESC LIMIT 1) cp ON true
     LEFT JOIN LATERAL ( SELECT ec1.id, ec1.name, ec1.relationship, ec1.phone
           FROM emergency_contacts ec1 WHERE ec1.client_id = c.id ORDER BY ec1."position", ec1.created_at LIMIT 1) ec ON true
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

ALTER VIEW clients_full SET (security_invoker = on);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/071_billing_view_inactivity.sql
git commit -m "feat(reintegro): billing version-aware + exclusión por período + vista"
```

---

### Task 4: Servicio — reactivateClient extendido + apply_due_reactivations + inactivityPeriods

**Files:**
- Modify: `src/services/clients/clientService.js:140-150` (reactivateClient)
- Modify: `src/services/api.js` (re-export applyDueReactivations)

**Interfaces:**
- Consumes: RPCs `reactivate_client` (nueva firma), `apply_due_reactivations` (Task 2).
- Produces:
  - `reactivateClient(id, { reactivationDate, plan }) => Promise<client>` — `plan` opcional `{ frequency, schedule, hasTransport, assignedDays, distanceRange }`.
  - `applyDueReactivations() => Promise<number>`.
  - `getClientById`/`clients_full` ya devuelven `inactivityPeriods` y `scheduledReactivationDate` (via view; verificar que el transformer no los descarte — Task 5 nota).

- [ ] **Step 1: Reescribir reactivateClient y agregar applyDueReactivations**

```js
/**
 * Reactivate (reintegrar) a client with an effective date and optional new plan.
 * @param {string} id
 * @param {object} payload
 * @param {string} payload.reactivationDate - YYYY-MM-DD (> fecha de baja)
 * @param {object} [payload.plan] - { frequency, schedule, hasTransport, assignedDays, distanceRange }
 */
export async function reactivateClient(id, { reactivationDate, plan } = {}) {
  const { error } = await supabase.rpc('reactivate_client', {
    p_client_id: id,
    p_reactivation_date: reactivationDate,
    p_frequency: plan?.frequency ?? null,
    p_schedule: plan?.schedule ?? null,
    p_has_transport: plan?.hasTransport ?? null,
    p_assigned_days: plan?.assignedDays ?? null,
    p_distance_range: plan?.distanceRange ?? null
  })
  if (error) throw new Error(error.message)
  return getClientById(id)
}

/**
 * Self-heal: flip clients whose scheduled future reactivation date has arrived.
 * @returns {Promise<number>} count reactivated
 */
export async function applyDueReactivations() {
  const { data, error } = await supabase.rpc('apply_due_reactivations')
  if (error) throw new Error(error.message)
  return data ?? 0
}
```

- [ ] **Step 2: Re-exportar en api.js**

Agregar `applyDueReactivations` a los imports/exports desde `./clients/clientService` en `src/services/api.js` (junto a `reactivateClient`).

- [ ] **Step 3: Verificar el transformer de cliente**

Confirmar que `clientTransformers.js` (usado por `getClientById`) no filtra campos desconocidos — que `inactivityPeriods` y `scheduledReactivationDate` lleguen al objeto `client`. Si mapea explícitamente, agregar ambos.

- [ ] **Step 4: Commit**

```bash
git add src/services/clients/clientService.js src/services/api.js src/services/clients/clientTransformers.js
git commit -m "feat(reintegro): servicio reactivateClient con fecha/plan + applyDueReactivations"
```

---

### Task 5: `ReactivateClientModal.jsx`

**Files:**
- Create: `src/pages/Clients/ReactivateClientModal.jsx`

**Interfaces:**
- Consumes: `getClientPlanVersions` (clientService). Props: `{ isOpen, onClose, client: { id, firstName, lastName, deactivationDate }, onConfirm, loading }`.
- Produces: `onConfirm({ reactivationDate, plan })` con `plan = { frequency, schedule, hasTransport, assignedDays, distanceRange }`.

Comportamiento:
- Fecha default = hoy; `min` = día siguiente a `deactivationDate`; futura permitida (sin `max`). Nota contextual: "retroactiva" si `< hoy`, "programada" si `> hoy`.
- Al abrir: carga `getClientPlanVersions(client.id)`, elige la versión vigente a la fecha de baja (última con `effectiveFrom <= mesDeLaBaja`) y pre-carga frecuencia/horario/días/transporte/distancia. Fallback al plan más reciente si no hay match.
- Reutilizar `SCHEDULE_OPTIONS`/`DAYS_OPTIONS` (extraerlos a un módulo compartido `src/pages/Clients/planOptions.js` o duplicar las constantes localmente — preferir extraer para DRY).
- Validación: exactamente `frequency` días seleccionados; fecha válida.

- [ ] **Step 1: Extraer constantes de plan a módulo compartido**

Create `src/pages/Clients/planOptions.js` exportando `SCHEDULE_OPTIONS` y `DAYS_OPTIONS` (copiar de `AddClient.jsx:50-64`), y actualizar `AddClient.jsx` para importarlas (borrar las locales).

- [ ] **Step 2: Escribir el modal**

(Componente con `Modal`, input date, selector de frecuencia, `Select` de horario, grid de días toggle, y — si `hasTransport` — selector de rango de distancia. Precarga desde plan-at-baja. Botón "Confirmar reintegro" deshabilitado si inválido. Seguir el estilo de `DeactivateClientModal.jsx`.)

- [ ] **Step 3: Compilar Tailwind + build**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
CI=true npm run build
```
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients/ReactivateClientModal.jsx src/pages/Clients/planOptions.js src/pages/Clients/AddClient.jsx src/tailwind.output.css
git commit -m "feat(reintegro): modal de reintegro con fecha y plan"
```

---

### Task 6: Calendario — usar períodos en getDayStatus y billing preview

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx` (import helper; `getDayStatus` ~947; `plannedDays`/`vacationDays` ~886-899; `handleReactivate` ~216-226; banner y wiring del modal)

**Interfaces:**
- Consumes: `isInactiveOn` (Task 1), `client.inactivityPeriods`, `ReactivateClientModal` (Task 5), `reactivateClient({reactivationDate, plan})` (Task 4).

- [ ] **Step 1: Reemplazar el guard de baja por chequeo de períodos**

En `getDayStatus`, reemplazar la línea 947 (`if (deactDate && day >= deactDate) ...`) por:
```js
if (isInactiveOn(dateStr, client.inactivityPeriods)) return { status: 'not_scheduled', isJustified: false, isChargeable: true, isAssigned: false }
```
(mantener el resto). En `plannedDays`/`vacationDays`, reemplazar `(!deactDate || d < deactDate)` / `if (deactDate && d >= deactDate) return false` por `!isInactiveOn(format(d,'yyyy-MM-dd'), client.inactivityPeriods)`.

- [ ] **Step 2: Reemplazar handleReactivate + montar modal**

- Agregar estado `reactivateModal`.
- `handleReactivate` pasa a abrir el modal; el confirm del modal llama `reactivateClient(id, { reactivationDate, plan })`, refetchea el cliente y planVersions, cierra modal.
- Botón "Reactivar" abre el modal.
- Banner de baja: si `client.scheduledReactivationDate`, mostrar "Reintegro programado para {fecha}".

- [ ] **Step 3: Build**

```bash
CI=true npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(reintegro): calendario/billing excluyen períodos + modal en detalle"
```

---

### Task 7: ChurnCardModal + self-heal en carga de tableros

**Files:**
- Modify: `src/pages/Churn/ChurnCardModal.jsx` (handleReactivate ~181-196, botón ~408)
- Modify: `src/pages/Churn/ChurnBoard.jsx` (llamar applyDueReactivations en load)
- Modify: `src/pages/Clients/ClientList.jsx` (llamar applyDueReactivations en load)

- [ ] **Step 1: Reemplazar window.confirm por ReactivateClientModal**

En `ChurnCardModal`, montar `ReactivateClientModal` con `client={{ id: clientId, firstName: card.firstName, lastName: card.lastName, deactivationDate: card.deactivationDate }}`. Confirm → `reactivateClient(clientId, { reactivationDate, plan })` → `onReactivated?.()` + `onClose()`.

- [ ] **Step 2: Self-heal en carga**

En el `useEffect`/loader de `ChurnBoard.jsx` y `ClientList.jsx`, invocar `applyDueReactivations().catch(() => {})` antes (o en paralelo no-bloqueante) del fetch principal. Idempotente y barato.

- [ ] **Step 3: Build + Tailwind**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
CI=true npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Churn/ChurnCardModal.jsx src/pages/Churn/ChurnBoard.jsx src/pages/Clients/ClientList.jsx src/tailwind.output.css
git commit -m "feat(reintegro): modal en churn board + self-heal de reintegros vencidos"
```

---

### Task 8: Verificación en branch de Supabase (flujo real)

**Files:** ninguno (verificación).

- [ ] **Step 1: Crear branch de Supabase y aplicar 070 + 071**
- [ ] **Step 2: Escenarios (flujo real vía servicio con auth, NO SQL directo):**
  - Cliente activo → baja el 10/03 → verificar período abierto y calendario gris desde 10/03.
  - Reintegro retroactivo 15/05 con **mismo** plan → días 10/03–14/05 gris/no cobrados; 15/05+ activos; billing marzo/abril = $0 en asistencia planificada del gap; mayo prorrateado desde 15/05.
  - Reintegro con **otro** plan (distinta frecuencia/días) → mes de reintegro usa el nuevo plan.
  - Reintegro **futuro** (ej. hoy+30) → cliente sigue dado de baja; calendario activo desde esa fecha; `apply_due_reactivations` no lo voltea aún.
  - Segundo ciclo baja/reintegro → dos períodos, ambos excluidos.
- [ ] **Step 3: Merge del branch a prod (coordinado, ventana tranquila).**

---

## Self-Review

- **Cobertura del spec:** tabla+backfill (T2), deactivate abre período (T2), reactivate fecha+plan+futuro (T2), self-heal (T2/T7), billing por-día+version-aware (T3), vista (T3), helper+tests (T1), servicio (T4), modal (T5), calendario/preview (T6), churn+carga (T7), verificación real (T8). ✓
- **Placeholders:** T5 Step 2 describe el JSX sin código completo — es UI mecánica siguiendo `DeactivateClientModal`; aceptable como spec de UI. Resto con código completo.
- **Consistencia de tipos:** `reactivateClient(id, { reactivationDate, plan })` usado igual en T4/T6/T7. `isInactiveOn(dateStr, periods)` con `periods=[{fromDate,toDate}]` consistente T1/T6. Vista expone `inactivityPeriods`/`scheduledReactivationDate` (camelCase) consumidos en T6.
- **Ojo (riesgo):** `set_client_plan_version` — verificar su firma exacta de params en migración 021 antes de T2 Step1 (el `PERFORM` debe matchear orden/tipos). El frontend la llama con `(p_client_id, p_effective_from, p_frequency, p_schedule, p_has_transport, p_assigned_days, p_distance_range, p_created_by)`.
