# Cambios de plan no retroactivos — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Versionar el plan del cliente por vigencia mensual para que cambios de plan/transporte/distancia rijan solo hacia adelante, sin reescribir asistencia ni facturación de meses pasados.

**Architecture:** `client_plans` pasa de una fila por cliente a una fila por período de vigencia (`effective_from` = 1° de mes + snapshot de `distance_range`). La facturación y el calendario resuelven, por mes, la versión con `effective_from` máximo ≤ ese mes. El "plan vigente hoy" (cards/listas) se resuelve por la versión del mes actual vía join lateral. Editar el plan crea/actualiza la versión del mes elegido (default: mes en curso, piso: primer mes no pagado).

**Tech Stack:** PostgreSQL/Supabase (funciones plpgsql, RPC, vistas), React 19, servicios JS en `src/services/`. Migraciones en `supabase/migrations/`, aplicadas vía `mcp__supabase__apply_migration` y verificadas con `mcp__supabase__execute_sql`.

**Spec:** `docs/superpowers/specs/2026-06-04-non-retroactive-plan-changes-design.md`

---

## Notas de implementación

- **No hay test runner JS** para esta lógica. El núcleo testeable es SQL: se verifica con
  un bloque `DO $$ ... $$` que inserta fixtures, hace asserts con `RAISE EXCEPTION`, y
  fuerza `ROLLBACK` levantando `EXCEPTION 'TEST_OK'` al final (no persiste datos). Si el
  mensaje devuelto es `TEST_OK` → pasó; cualquier otro mensaje → falló ese assert.
- **Frontend:** verificación manual (la app contra Supabase). Recompilar Tailwind solo si
  se tocan clases nuevas.
- **`month` es 0-indexed** en toda la app (0=enero). En SQL el mes objetivo se construye
  con `make_date(p_year, p_month + 1, 1)`.
- Convención del repo: sin `;` innecesarios en JS, variables en inglés, textos UI en
  español.

## File Structure

- `supabase/migrations/021_versioned_client_plans.sql` — **crear**. Schema + backfill +
  constraints + redefinición de `calculate_month_billing`, `clients_full`,
  `create_client_full`, `update_client_full`, y nuevo `set_client_plan_version`.
- `src/services/clients/clientService.js` — **modificar**. Agregar
  `getClientPlanVersions`, `setClientPlanVersion`; quitar params de plan de `updateClient`.
- `src/services/clients/clientTransformers.js` — **modificar**. Quitar plan de
  `transformUpdateToDb`; agregar transformer de versiones.
- `src/services/api.js` — **modificar**. Re-exportar las nuevas funciones.
- `src/pages/Clients/ClientDetail.jsx` — **modificar**. Cargar versiones; helper
  `getPlanForMonth`; `MonthCard` usa la versión del mes; sección de historial de plan.
- `src/pages/Clients/AddClient.jsx` — **modificar**. Selector de mes de vigencia en edición
  + llamada a `setClientPlanVersion`.

---

## Task 1: Migración — versionar `client_plans` (schema + backfill)

**Files:**
- Create: `supabase/migrations/021_versioned_client_plans.sql`

- [ ] **Step 1: Crear el archivo de migración con el bloque de schema**

Crear `supabase/migrations/021_versioned_client_plans.sql` con este contenido inicial
(las funciones se agregan en tareas siguientes, al mismo archivo):

```sql
-- 021_versioned_client_plans.sql
-- Plan del cliente versionado por vigencia mensual (no retroactivo).
-- client_plans pasa de 1 fila/cliente a 1 fila/período de vigencia.

-- ── Schema ──────────────────────────────────────────────────────────────────
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS effective_from date;
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS distance_range text;
ALTER TABLE client_plans ADD COLUMN IF NOT EXISTS created_by text;

-- Backfill: versión 1 = 1° del mes de ingreso; distancia desde la dirección actual.
UPDATE client_plans cp
SET effective_from = date_trunc('month', c.start_date)::date
FROM clients c
WHERE cp.client_id = c.id AND cp.effective_from IS NULL;

UPDATE client_plans cp
SET distance_range = a.distance_range
FROM client_addresses a
WHERE cp.client_id = a.client_id AND cp.distance_range IS NULL;

ALTER TABLE client_plans ALTER COLUMN effective_from SET NOT NULL;

-- Reemplazar UNIQUE(client_id) por UNIQUE(client_id, effective_from).
DO $$
DECLARE v_con text;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'client_plans'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE client_plans DROP CONSTRAINT %I', v_con);
  END LOOP;
END $$;

ALTER TABLE client_plans
  ADD CONSTRAINT client_plans_client_effective_uniq UNIQUE (client_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_client_plans_client_effective
  ON client_plans (client_id, effective_from DESC);
```

- [ ] **Step 2: Aplicar la migración (solo el bloque de schema por ahora)**

Aplicar vía `mcp__supabase__apply_migration` con name `021_versioned_client_plans` y el SQL
del Step 1.
Expected: sin error. (La base está recién limpiada, así que el backfill es no-op.)

- [ ] **Step 3: Verificar el schema resultante**

Ejecutar vía `mcp__supabase__execute_sql`:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='client_plans'
  AND column_name IN ('effective_from','distance_range','created_by')
ORDER BY column_name;
```
Expected: 3 filas (`created_by`, `distance_range`, `effective_from`).

```sql
SELECT conname FROM pg_constraint
WHERE conrelid='public.client_plans'::regclass AND contype='u';
```
Expected: `client_plans_client_effective_uniq`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_versioned_client_plans.sql
git commit -m "feat(plans): versioned client_plans schema (effective_from, distance_range)"
```

---

## Task 2: RPC `set_client_plan_version`

**Files:**
- Modify: `supabase/migrations/021_versioned_client_plans.sql` (append)

- [ ] **Step 1: Añadir la función al archivo de migración**

Agregar al final de `021_versioned_client_plans.sql`:

```sql
-- ── set_client_plan_version ───────────────────────────────────────────────────
-- Crea o actualiza la versión de plan vigente desde el mes de p_effective_from.
CREATE OR REPLACE FUNCTION public.set_client_plan_version(
  p_client_id uuid,
  p_effective_from date,
  p_frequency integer,
  p_schedule text,
  p_has_transport boolean,
  p_assigned_days text[],
  p_distance_range text DEFAULT NULL,
  p_created_by text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO client_plans (
    client_id, effective_from, frequency, schedule,
    has_transport, assigned_days, distance_range, created_by
  ) VALUES (
    p_client_id, date_trunc('month', p_effective_from)::date, p_frequency, p_schedule,
    COALESCE(p_has_transport, FALSE), COALESCE(p_assigned_days, '{}'), p_distance_range, p_created_by
  )
  ON CONFLICT (client_id, effective_from) DO UPDATE SET
    frequency     = EXCLUDED.frequency,
    schedule      = EXCLUDED.schedule,
    has_transport = EXCLUDED.has_transport,
    assigned_days = EXCLUDED.assigned_days,
    distance_range = EXCLUDED.distance_range,
    updated_at    = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
```

- [ ] **Step 2: Aplicar (re-aplicar la migración con el contenido acumulado)**

Aplicar vía `mcp__supabase__apply_migration` con name `021_versioned_client_plans` y el
contenido **completo** del archivo (idempotente: `ADD COLUMN IF NOT EXISTS`, `CREATE OR
REPLACE`, etc.).
Expected: sin error.

- [ ] **Step 3: Verificación (test transaccional, no persiste datos)**

Ejecutar vía `mcp__supabase__execute_sql`:

```sql
DO $$
DECLARE v_cid uuid; v_vid uuid; v_cnt int; v_freq int;
BEGIN
  INSERT INTO clients (first_name, last_name, start_date)
  VALUES ('TEST', 'PLANVER', '2026-03-15') RETURNING id INTO v_cid;

  -- versión inicial marzo
  PERFORM set_client_plan_version(v_cid, '2026-03-01', 2, 'morning', false, ARRAY['monday','wednesday'], NULL, 'tester');
  -- cambio vigente junio
  v_vid := set_client_plan_version(v_cid, '2026-06-01', 3, 'afternoon', true, ARRAY['monday','tuesday','thursday'], '2_to_5km', 'tester');
  -- re-editar junio (upsert): debe pisar, no duplicar
  PERFORM set_client_plan_version(v_cid, '2026-06-10', 4, 'afternoon', true, ARRAY['monday','tuesday','wednesday','thursday'], '2_to_5km', 'tester');

  SELECT count(*) INTO v_cnt FROM client_plans WHERE client_id = v_cid;
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'esperaba 2 versiones, hay %', v_cnt; END IF;

  SELECT frequency INTO v_freq FROM client_plans WHERE client_id = v_cid AND effective_from = '2026-06-01';
  IF v_freq <> 4 THEN RAISE EXCEPTION 'upsert no piso: freq=%', v_freq; END IF;

  RAISE EXCEPTION 'TEST_OK';
END $$;
```
Expected: error con mensaje `TEST_OK` (los datos se revierten). Cualquier otro mensaje =
falla a corregir.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_versioned_client_plans.sql
git commit -m "feat(plans): set_client_plan_version upsert RPC"
```

---

## Task 3: `calculate_month_billing` consciente del tiempo

**Files:**
- Modify: `supabase/migrations/021_versioned_client_plans.sql` (append)

- [ ] **Step 1: Añadir la redefinición de la función**

Agregar al final del archivo de migración. Es la función actual con DOS cambios: (a) la
resolución del plan por versión del mes; (b) el transporte usa `v_plan.distance_range` en
vez de `client_addresses`. El resto es idéntico (incluida la proración por `start_date`).

```sql
-- ── calculate_month_billing (version-aware) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_month_billing(p_client_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_client RECORD;
  v_plan RECORD;
  v_plan_price RECORD;
  v_transport_price RECORD;
  v_month_start DATE;
  v_month_end DATE;
  v_effective_start DATE;
  v_full_month_days INTEGER := 0;
  v_planned_days INTEGER := 0;
  v_vacation_days INTEGER := 0;
  v_recovery_days INTEGER := 0;
  v_chargeable_days INTEGER;
  v_att_rate_net NUMERIC(12,2);
  v_att_rate_gross NUMERIC(12,2);
  v_att_charge_net NUMERIC(12,2);
  v_att_charge_gross NUMERIC(12,2);
  v_trans_rate_net NUMERIC(12,2) := 0;
  v_trans_rate_gross NUMERIC(12,2) := 0;
  v_trans_charge_net NUMERIC(12,2) := 0;
  v_trans_charge_gross NUMERIC(12,2) := 0;
  v_has_transport BOOLEAN := FALSE;
  v_day DATE;
  v_day_of_week INTEGER;
  v_day_name TEXT;
  v_proration_factor NUMERIC;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'Cliente no encontrado');
  END IF;

  -- Resolver la versión del plan vigente para el mes objetivo.
  SELECT * INTO v_plan
  FROM client_plans
  WHERE client_id = p_client_id
    AND effective_from <= make_date(p_year, p_month + 1, 1)
  ORDER BY effective_from DESC
  LIMIT 1;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Plan no encontrado');
  END IF;

  SELECT price_net, price_gross INTO v_plan_price
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule;
  IF v_plan_price IS NULL THEN
    RETURN jsonb_build_object('error', 'Precio de plan no encontrado');
  END IF;
  v_att_rate_net := v_plan_price.price_net;
  v_att_rate_gross := v_plan_price.price_gross;

  IF v_plan.has_transport THEN
    IF v_plan.distance_range IS NULL THEN
      RETURN jsonb_build_object('error', 'Cliente con transporte requiere distancia definida');
    END IF;

    SELECT price_net, price_gross INTO v_transport_price
    FROM transport_pricing
    WHERE frequency = v_plan.frequency AND distance_range = v_plan.distance_range;
    IF v_transport_price IS NULL THEN
      RETURN jsonb_build_object('error', 'Precio de transporte no encontrado');
    END IF;

    v_trans_rate_net := v_transport_price.price_net;
    v_trans_rate_gross := v_transport_price.price_gross;
    v_has_transport := TRUE;
  END IF;

  v_month_start := _month_start(p_year, p_month);
  v_month_end := _month_end(p_year, p_month);
  v_effective_start := GREATEST(v_client.start_date, v_month_start);

  v_day := v_month_start;
  WHILE v_day <= v_month_end LOOP
    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday'
      WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
      WHEN 5 THEN 'friday' ELSE NULL
    END;

    IF v_day_name IS NOT NULL AND v_day_name = ANY(v_plan.assigned_days) THEN
      v_full_month_days := v_full_month_days + 1;
      IF v_day >= v_effective_start THEN
        v_planned_days := v_planned_days + 1;
        IF EXISTS (
          SELECT 1 FROM attendance_records
          WHERE client_id = p_client_id AND date = v_day AND status = 'vacation'
        ) THEN
          v_vacation_days := v_vacation_days + 1;
        END IF;
      END IF;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;

  SELECT COUNT(*) INTO v_recovery_days
  FROM attendance_records
  WHERE client_id = p_client_id
    AND date BETWEEN v_month_start AND v_month_end
    AND status = 'recovery';

  v_chargeable_days := v_planned_days - v_vacation_days;

  IF v_full_month_days > 0 THEN
    v_proration_factor := v_chargeable_days::NUMERIC / v_full_month_days::NUMERIC;
    v_att_charge_gross := ROUND(v_proration_factor * v_att_rate_gross);
    v_att_charge_net := ROUND(v_proration_factor * v_att_rate_net);
    IF v_has_transport THEN
      v_trans_charge_gross := ROUND(v_proration_factor * v_trans_rate_gross);
      v_trans_charge_net := ROUND(v_proration_factor * v_trans_rate_net);
    END IF;
  ELSE
    v_att_charge_gross := 0;
    v_att_charge_net := 0;
  END IF;

  RETURN jsonb_build_object(
    'fullMonthDays', v_full_month_days,
    'plannedDays', v_planned_days,
    'vacationDays', v_vacation_days,
    'recoveryDays', v_recovery_days,
    'chargeableDays', v_chargeable_days,
    'isProrated', v_effective_start > v_month_start,
    'hasTransport', v_has_transport,
    'attendanceMonthlyRateNet', v_att_rate_net,
    'attendanceMonthlyRateGross', v_att_rate_gross,
    'attendanceChargeableNet', v_att_charge_net,
    'attendanceChargeableGross', v_att_charge_gross,
    'transportMonthlyRateNet', v_trans_rate_net,
    'transportMonthlyRateGross', v_trans_rate_gross,
    'transportChargeableNet', v_trans_charge_net,
    'transportChargeableGross', v_trans_charge_gross,
    'totalChargeableGross', v_att_charge_gross + v_trans_charge_gross,
    'totalMonthlyRateGross', v_att_rate_gross + v_trans_rate_gross,
    'monthlyRate', v_att_rate_gross,
    'chargeableAmount', v_att_charge_gross + v_trans_charge_gross
  );
END;
$function$;
```

- [ ] **Step 2: Aplicar la migración (contenido completo acumulado)**

Aplicar vía `mcp__supabase__apply_migration`, name `021_versioned_client_plans`.
Expected: sin error.

- [ ] **Step 3: Verificación (no-retroactividad + proración del mes de ingreso)**

Ejecutar vía `mcp__supabase__execute_sql`. Usa el seed de precios existente
(freq 1 morning gross = 20000; freq 3 morning gross = 39000).

```sql
DO $$
DECLARE
  v_cid uuid;
  v_mar jsonb;   -- marzo (plan viejo, 1x jueves)
  v_jun jsonb;   -- junio (plan nuevo, 3x)
BEGIN
  -- Alta el primer jueves de marzo 2026 (2026-03-05). 1x/sem jueves.
  INSERT INTO clients (first_name, last_name, start_date)
  VALUES ('TEST', 'BILLING', '2026-03-05') RETURNING id INTO v_cid;

  PERFORM set_client_plan_version(v_cid, '2026-03-01', 1, 'morning', false, ARRAY['thursday'], NULL, 'tester');
  -- Cambio de plan vigente desde junio: 3x/sem morning.
  PERFORM set_client_plan_version(v_cid, '2026-06-01', 3, 'morning', false, ARRAY['monday','wednesday','thursday'], NULL, 'tester');

  v_mar := calculate_month_billing(v_cid, 2026, 2);  -- month 2 = marzo
  v_jun := calculate_month_billing(v_cid, 2026, 5);  -- month 5 = junio

  -- Marzo: alta el 1er jueves => todos los jueves cuentan => cobro completo (factor 1.0).
  IF (v_mar->>'attendanceMonthlyRateGross')::numeric <> 20000 THEN
    RAISE EXCEPTION 'marzo rate esperado 20000, fue %', v_mar->>'attendanceMonthlyRateGross';
  END IF;
  IF (v_mar->>'attendanceChargeableGross')::numeric <> 20000 THEN
    RAISE EXCEPTION 'marzo cobro esperado 20000 (completo), fue %', v_mar->>'attendanceChargeableGross';
  END IF;

  -- Junio: ya rige el plan nuevo (3x morning => rate 39000), NO el viejo.
  IF (v_jun->>'attendanceMonthlyRateGross')::numeric <> 39000 THEN
    RAISE EXCEPTION 'junio debe usar plan nuevo (39000), fue %', v_jun->>'attendanceMonthlyRateGross';
  END IF;

  RAISE EXCEPTION 'TEST_OK';
END $$;
```
Expected: error con mensaje `TEST_OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_versioned_client_plans.sql
git commit -m "feat(billing): resolve plan version per month in calculate_month_billing"
```

---

## Task 4: Vista `clients_full` — resolver versión vigente hoy

**Files:**
- Modify: `supabase/migrations/021_versioned_client_plans.sql` (append)

- [ ] **Step 1: Añadir la redefinición de la vista**

Agregar al final del archivo. Es la vista actual con UN cambio: el `LEFT JOIN client_plans
cp` pasa a un `LEFT JOIN LATERAL` que toma la versión del mes actual. Mantiene
`security_invoker` (igual que la vista actual, para que aplique la RLS de la tabla base).

```sql
-- ── clients_full (current plan version) ──────────────────────────────────────
CREATE OR REPLACE VIEW public.clients_full
WITH (security_invoker = true) AS
 SELECT c.id,
    c.first_name AS "firstName",
    c.last_name AS "lastName",
    c.email,
    c.phone,
    c.birth_date AS "birthDate",
    c.cognitive_level AS "cognitiveLevel",
    c.start_date AS "startDate",
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
            WHEN mi.id IS NOT NULL THEN jsonb_build_object('dietaryRestrictions', mi.dietary_restrictions, 'medicalRestrictions', mi.medical_restrictions, 'mobilityRestrictions', mi.mobility_restrictions, 'medication', mi.medication, 'medicationSchedule', mi.medication_schedule, 'notes', mi.notes, 'isDiabetic', mi.is_diabetic, 'isCeliac', mi.is_celiac, 'isHypertensive', mi.is_hypertensive)
            ELSE NULL::jsonb
        END AS "medicalInfo"
   FROM clients c
     LEFT JOIN LATERAL (
       SELECT cp2.id, cp2.frequency, cp2.schedule, cp2.has_transport, cp2.assigned_days
       FROM client_plans cp2
       WHERE cp2.client_id = c.id
         AND cp2.effective_from <= date_trunc('month', CURRENT_DATE)::date
       ORDER BY cp2.effective_from DESC
       LIMIT 1
     ) cp ON true
     LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;
```

- [ ] **Step 2: Aplicar la migración (contenido completo)**

Aplicar vía `mcp__supabase__apply_migration`, name `021_versioned_client_plans`.
Expected: sin error.

- [ ] **Step 3: Verificación (una fila por cliente; plan = versión vigente)**

```sql
DO $$
DECLARE v_cid uuid; v_rows int; v_freq int;
BEGIN
  INSERT INTO clients (first_name, last_name, start_date)
  VALUES ('TEST', 'VIEW', '2026-01-10') RETURNING id INTO v_cid;
  PERFORM set_client_plan_version(v_cid, '2026-01-01', 2, 'morning', false, ARRAY['monday','wednesday'], NULL, 'tester');
  PERFORM set_client_plan_version(v_cid, '2026-09-01', 4, 'afternoon', false, ARRAY['monday','tuesday','wednesday','thursday'], NULL, 'tester');

  SELECT count(*) INTO v_rows FROM clients_full WHERE id = v_cid;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'esperaba 1 fila en clients_full, hay %', v_rows; END IF;

  -- Hoy (2026-06) la versión vigente es la de enero (freq 2), NO la futura de septiembre.
  SELECT (plan->>'frequency')::int INTO v_freq FROM clients_full WHERE id = v_cid;
  IF v_freq <> 2 THEN RAISE EXCEPTION 'plan vigente esperado freq 2, fue %', v_freq; END IF;

  RAISE EXCEPTION 'TEST_OK';
END $$;
```
Expected: error con mensaje `TEST_OK`.

> Nota: este test asume "hoy" entre 2026-02 y 2026-08. La fecha actual del proyecto es
> 2026-06-04, así que aplica.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_versioned_client_plans.sql
git commit -m "feat(plans): clients_full resolves current effective plan version"
```

---

## Task 5: `create_client_full` crea la versión 1

**Files:**
- Modify: `supabase/migrations/021_versioned_client_plans.sql` (append)

- [ ] **Step 1: Añadir la redefinición**

Misma firma que la actual (sin cambiar overloads — ver lección de RPC overloads). Solo
cambia el `INSERT INTO client_plans` para incluir `effective_from` (= 1° del mes de
ingreso) y `distance_range` (= `p_addr_distance_range`).

```sql
-- ── create_client_full (crea versión 1 del plan) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.create_client_full(p_first_name text, p_last_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_birth_date date DEFAULT NULL::date, p_cognitive_level text DEFAULT NULL::text, p_start_date date DEFAULT CURRENT_DATE, p_plan_frequency integer DEFAULT NULL::integer, p_plan_schedule text DEFAULT NULL::text, p_plan_has_transport boolean DEFAULT false, p_plan_assigned_days text[] DEFAULT '{}'::text[], p_ec_name text DEFAULT NULL::text, p_ec_relationship text DEFAULT NULL::text, p_ec_phone text DEFAULT NULL::text, p_addr_street text DEFAULT NULL::text, p_addr_access_notes text DEFAULT NULL::text, p_addr_doorbell text DEFAULT NULL::text, p_addr_concierge text DEFAULT NULL::text, p_addr_distance_range text DEFAULT NULL::text, p_med_dietary text DEFAULT NULL::text, p_med_medical text DEFAULT NULL::text, p_med_mobility text DEFAULT NULL::text, p_med_medication text DEFAULT NULL::text, p_med_medication_schedule text DEFAULT NULL::text, p_med_notes text DEFAULT NULL::text, p_med_is_diabetic boolean DEFAULT false, p_med_is_celiac boolean DEFAULT false, p_med_is_hypertensive boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date)
  RETURNING id INTO v_client_id;
  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, effective_from, frequency, schedule, has_transport, assigned_days, distance_range)
    VALUES (v_client_id, date_trunc('month', p_start_date)::date, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days, p_addr_distance_range);
  END IF;
  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (v_client_id, p_ec_name, p_ec_relationship, p_ec_phone);
  END IF;
  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range);
  END IF;
  INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive)
  VALUES (v_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, p_med_is_diabetic, p_med_is_celiac, p_med_is_hypertensive);
  RETURN v_client_id;
END;
$function$;
```

- [ ] **Step 2: Aplicar la migración (contenido completo)**

Aplicar vía `mcp__supabase__apply_migration`, name `021_versioned_client_plans`.
Expected: sin error.

- [ ] **Step 3: Verificación (versión 1 con effective_from = mes de ingreso + distancia)**

```sql
DO $$
DECLARE v_cid uuid; v_eff date; v_dist text;
BEGIN
  v_cid := create_client_full(
    'TEST','CREATE', NULL, NULL, NULL, 'A', '2026-04-20',
    2, 'morning', true, ARRAY['monday','wednesday'],
    NULL, NULL, NULL,
    'Calle Falsa 123', NULL, NULL, NULL, '2_to_5km',
    NULL, NULL, NULL, NULL, NULL, NULL, false, false, false
  );
  SELECT effective_from, distance_range INTO v_eff, v_dist
  FROM client_plans WHERE client_id = v_cid;
  IF v_eff <> DATE '2026-04-01' THEN RAISE EXCEPTION 'effective_from esperado 2026-04-01, fue %', v_eff; END IF;
  IF v_dist <> '2_to_5km' THEN RAISE EXCEPTION 'distance_range esperado 2_to_5km, fue %', v_dist; END IF;
  RAISE EXCEPTION 'TEST_OK';
END $$;
```
Expected: error con mensaje `TEST_OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_versioned_client_plans.sql
git commit -m "feat(plans): create_client_full inserts version 1 with effective_from"
```

---

## Task 6: `update_client_full` — desacoplar el plan

**Files:**
- Modify: `supabase/migrations/021_versioned_client_plans.sql` (append)

- [ ] **Step 1: Añadir la redefinición (sin el bloque de plan)**

Misma firma (mantiene los params `p_plan_*` para no romper overloads ni el cliente), pero
**elimina** el bloque `IF p_plan_frequency IS NOT NULL ... client_plans ...`. El plan ahora
se gestiona solo vía `set_client_plan_version`.

```sql
-- ── update_client_full (sin tocar el plan) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_client_full(p_client_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_birth_date date DEFAULT NULL::date, p_cognitive_level text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_plan_frequency integer DEFAULT NULL::integer, p_plan_schedule text DEFAULT NULL::text, p_plan_has_transport boolean DEFAULT NULL::boolean, p_plan_assigned_days text[] DEFAULT NULL::text[], p_ec_name text DEFAULT NULL::text, p_ec_relationship text DEFAULT NULL::text, p_ec_phone text DEFAULT NULL::text, p_addr_street text DEFAULT NULL::text, p_addr_access_notes text DEFAULT NULL::text, p_addr_doorbell text DEFAULT NULL::text, p_addr_concierge text DEFAULT NULL::text, p_addr_distance_range text DEFAULT NULL::text, p_med_dietary text DEFAULT NULL::text, p_med_medical text DEFAULT NULL::text, p_med_mobility text DEFAULT NULL::text, p_med_medication text DEFAULT NULL::text, p_med_medication_schedule text DEFAULT NULL::text, p_med_notes text DEFAULT NULL::text, p_med_is_diabetic boolean DEFAULT NULL::boolean, p_med_is_celiac boolean DEFAULT NULL::boolean, p_med_is_hypertensive boolean DEFAULT NULL::boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE clients SET
    first_name = COALESCE(p_first_name, first_name),
    last_name = COALESCE(p_last_name, last_name),
    email = COALESCE(p_email, email),
    phone = COALESCE(p_phone, phone),
    birth_date = COALESCE(p_birth_date, birth_date),
    cognitive_level = COALESCE(p_cognitive_level, cognitive_level),
    start_date = COALESCE(p_start_date, start_date),
    updated_at = NOW()
  WHERE id = p_client_id;

  -- El plan NO se modifica acá. Se gestiona vía set_client_plan_version (no retroactivo).

  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (p_client_id, p_ec_name, p_ec_relationship, p_ec_phone)
    ON CONFLICT (client_id) DO UPDATE SET
      name = EXCLUDED.name,
      relationship = EXCLUDED.relationship,
      phone = EXCLUDED.phone,
      updated_at = NOW();
  END IF;

  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (p_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range)
    ON CONFLICT (client_id) DO UPDATE SET
      street = EXCLUDED.street,
      access_notes = EXCLUDED.access_notes,
      doorbell = EXCLUDED.doorbell,
      concierge = EXCLUDED.concierge,
      distance_range = COALESCE(EXCLUDED.distance_range, client_addresses.distance_range),
      updated_at = NOW();
  END IF;

  IF p_med_dietary IS NOT NULL OR p_med_medical IS NOT NULL OR p_med_mobility IS NOT NULL
     OR p_med_medication IS NOT NULL OR p_med_medication_schedule IS NOT NULL OR p_med_notes IS NOT NULL
     OR p_med_is_diabetic IS NOT NULL OR p_med_is_celiac IS NOT NULL OR p_med_is_hypertensive IS NOT NULL THEN
    INSERT INTO medical_info (
      client_id, dietary_restrictions, medical_restrictions,
      mobility_restrictions, medication, medication_schedule, notes,
      is_diabetic, is_celiac, is_hypertensive
    ) VALUES (
      p_client_id, p_med_dietary, p_med_medical,
      p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes,
      COALESCE(p_med_is_diabetic, FALSE), COALESCE(p_med_is_celiac, FALSE), COALESCE(p_med_is_hypertensive, FALSE)
    )
    ON CONFLICT (client_id) DO UPDATE SET
      dietary_restrictions = COALESCE(EXCLUDED.dietary_restrictions, medical_info.dietary_restrictions),
      medical_restrictions = COALESCE(EXCLUDED.medical_restrictions, medical_info.medical_restrictions),
      mobility_restrictions = COALESCE(EXCLUDED.mobility_restrictions, medical_info.mobility_restrictions),
      medication = COALESCE(EXCLUDED.medication, medical_info.medication),
      medication_schedule = COALESCE(EXCLUDED.medication_schedule, medical_info.medication_schedule),
      notes = COALESCE(EXCLUDED.notes, medical_info.notes),
      is_diabetic = COALESCE(p_med_is_diabetic, medical_info.is_diabetic),
      is_celiac = COALESCE(p_med_is_celiac, medical_info.is_celiac),
      is_hypertensive = COALESCE(p_med_is_hypertensive, medical_info.is_hypertensive),
      updated_at = NOW();
  END IF;

  RETURN TRUE;
END;
$function$;
```

- [ ] **Step 2: Aplicar la migración (contenido completo)**

Aplicar vía `mcp__supabase__apply_migration`, name `021_versioned_client_plans`.
Expected: sin error.

- [ ] **Step 3: Verificación (update no crea ni duplica versiones de plan)**

```sql
DO $$
DECLARE v_cid uuid; v_cnt int;
BEGIN
  v_cid := create_client_full(
    'TEST','UPD', NULL, NULL, NULL, 'A', '2026-05-10',
    2, 'morning', false, ARRAY['monday','wednesday'],
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, false, false, false
  );
  -- update_client_full con params de plan distintos: NO debe crear ni cambiar versión.
  PERFORM update_client_full(v_cid, 'TESTX', NULL, NULL, NULL, NULL, NULL, NULL,
    4, 'afternoon', true, ARRAY['monday','tuesday','wednesday','thursday']);
  SELECT count(*) INTO v_cnt FROM client_plans WHERE client_id = v_cid;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'update no debe crear versiones, hay %', v_cnt; END IF;
  IF EXISTS (SELECT 1 FROM client_plans WHERE client_id = v_cid AND frequency <> 2) THEN
    RAISE EXCEPTION 'update no debe cambiar el plan';
  END IF;
  RAISE EXCEPTION 'TEST_OK';
END $$;
```
Expected: error con mensaje `TEST_OK`.

- [ ] **Step 4: Verificar advisors de seguridad**

Ejecutar `mcp__supabase__get_advisors` con type `security`.
Expected: ninguna advertencia NUEVA sobre `clients_full` ni las funciones tocadas (la vista
mantiene `security_invoker`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/021_versioned_client_plans.sql
git commit -m "feat(plans): decouple plan from update_client_full (managed via versions)"
```

---

## Task 7: Servicios JS — versiones de plan

**Files:**
- Modify: `src/services/clients/clientService.js`
- Modify: `src/services/clients/clientTransformers.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Revisar `transformUpdateToDb` y quitar params de plan**

Leer `src/services/clients/clientTransformers.js`. Localizar `transformUpdateToDb` y
**quitar** las propiedades `p_plan_frequency`, `p_plan_schedule`, `p_plan_has_transport`,
`p_plan_assigned_days` del objeto de params que arma (el RPC ya las ignora; no enviarlas
deja claro el desacople). No tocar `transformClientToDb` (alta sigue mandando el plan).

- [ ] **Step 2: Agregar funciones de versiones en `clientService.js`**

Agregar al final de `src/services/clients/clientService.js`:

```javascript
/**
 * Get all plan versions for a client, ascending by effectiveFrom
 * @param {string} clientId
 * @returns {Promise<Array>}
 */
export async function getClientPlanVersions(clientId) {
  const { data, error } = await supabase
    .from('client_plans')
    .select('id, effective_from, frequency, schedule, has_transport, assigned_days, distance_range')
    .eq('client_id', clientId)
    .order('effective_from', { ascending: true })

  if (error) throw new Error(error.message)

  return (data || []).map(v => ({
    id: v.id,
    effectiveFrom: v.effective_from,
    frequency: v.frequency,
    schedule: v.schedule,
    hasTransport: v.has_transport,
    assignedDays: v.assigned_days || [],
    distanceRange: v.distance_range
  }))
}

/**
 * Create or update the plan version effective from a given month
 * @param {string} clientId
 * @param {string} effectiveFrom - YYYY-MM-DD (will be truncated to month start)
 * @param {object} plan - { frequency, schedule, hasTransport, assignedDays, distanceRange }
 * @param {string} createdBy - optional user name
 */
export async function setClientPlanVersion(clientId, effectiveFrom, plan, createdBy = null) {
  const { data, error } = await supabase.rpc('set_client_plan_version', {
    p_client_id: clientId,
    p_effective_from: effectiveFrom,
    p_frequency: plan.frequency,
    p_schedule: plan.schedule,
    p_has_transport: plan.hasTransport,
    p_assigned_days: plan.assignedDays,
    p_distance_range: plan.distanceRange ?? null,
    p_created_by: createdBy
  })
  if (error) throw new Error(error.message)
  return data
}
```

- [ ] **Step 3: Re-exportar en `api.js`**

En `src/services/api.js`, localizar el bloque que re-exporta de `clientService` y agregar
`getClientPlanVersions` y `setClientPlanVersion` a ese export.

- [ ] **Step 4: Verificar que compila**

Run: `npx eslint src/services/clients/clientService.js src/services/clients/clientTransformers.js src/services/api.js`
Expected: sin errores nuevos. (Si no hay eslint configurado, correr `npm run build` y
confirmar que compila.)

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/clientService.js src/services/clients/clientTransformers.js src/services/api.js
git commit -m "feat(plans): plan version service fns; drop plan from updateClient params"
```

---

## Task 8: `ClientDetail` — calendario por versión

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Cargar las versiones del plan junto al cliente**

En `loadClientData` (≈línea 135), agregar `getClientPlanVersions(id)` al `Promise.all` e
incorporar las versiones al objeto `client`. Importar la función arriba.

Cambiar el import existente de servicios para incluir `getClientPlanVersions`. Luego:

```javascript
      const [clientData, attendanceData, invoicesData, pricing, transportPricing, recoveryData, planVersions] = await Promise.all([
        getClientById(id),
        getClientAttendance(id),
        getClientInvoices(id),
        getPlanPricing(),
        getTransportPricing(),
        getRecoveryCredits(id),
        getClientPlanVersions(id)
      ])
```

Y donde hace `setClient(clientData)`:

```javascript
      setClient({ ...clientData, planVersions })
```

- [ ] **Step 2: Agregar el helper `getPlanForMonth` (module scope)**

Agregar cerca de los otros helpers de módulo (arriba del componente, junto a
`DAY_INDEX_TO_NAME`):

```javascript
// Resolve the plan version effective for a given (year, month) — month is 0-indexed.
// Falls back to the current `client.plan` if no versions are loaded.
function getPlanForMonth(planVersions, fallbackPlan, year, month) {
  if (!planVersions || planVersions.length === 0) return fallbackPlan
  const monthStartTs = new Date(year, month, 1).getTime()
  let chosen = null
  for (const v of planVersions) {
    // effectiveFrom is YYYY-MM-DD (month start); parse as local date
    const [vy, vm] = v.effectiveFrom.split('-').map(Number)
    const vTs = new Date(vy, vm - 1, 1).getTime()
    if (vTs <= monthStartTs && (!chosen || vTs >= chosen.ts)) {
      chosen = { ts: vTs, plan: v }
    }
  }
  return chosen ? chosen.plan : (planVersions[0] || fallbackPlan)
}
```

- [ ] **Step 3: Usar la versión del mes dentro de `MonthCard`**

En `MonthCard` (≈línea 614), justo después de calcular `monthStart`/`monthEnd`, resolver el
plan del mes y usarlo en lugar de `client.plan`:

```javascript
  const plan = getPlanForMonth(client.planVersions, client.plan, year, month)
```

Luego reemplazar dentro de `MonthCard` **todas** las referencias a `client.plan.` por
`plan.` y la distancia por el snapshot de la versión:

- Línea ≈656: `client.plan.assignedDays.includes(name)` → `plan.assignedDays.includes(name)`
- Línea ≈663: `client.plan.assignedDays.includes(name)` → `plan.assignedDays.includes(name)`
- Línea ≈668: `client.plan.assignedDays.includes(name)` → `plan.assignedDays.includes(name)`
- Línea ≈679: `getPlanPriceSync(pricingData, client.plan.frequency, client.plan.schedule)` →
  `getPlanPriceSync(pricingData, plan.frequency, plan.schedule)`
- Línea ≈680-682: el bloque de transporte usa la distancia **de la versión**:

```javascript
  const transportPrice = plan.hasTransport && plan.distanceRange
    ? getTransportPriceSync(transportPricingData, plan.frequency, plan.distanceRange)
    : { priceNet: 0, priceGross: 0 }
```

- Línea ≈701: `const isAssigned = name && client.plan.assignedDays.includes(name)` →
  `const isAssigned = name && plan.assignedDays.includes(name)`

> No tocar la tarjeta de resumen del header (fuera de `MonthCard`), que sigue mostrando
> `client.plan` (el plan vigente hoy). El día de ingreso ya se cuenta inclusive
> (`d >= effectiveStart` y `day < clientStart` excluye solo días anteriores al ingreso),
> consistente con el backend.

- [ ] **Step 4: Verificación manual**

Run: `npm run build`
Expected: compila sin errores.

Verificación funcional (con un cliente de prueba en la app): crear un cliente, registrar un
cambio de plan vigente desde un mes futuro (Task 9), y confirmar en el calendario que los
meses anteriores conservan el plan viejo (días asignados/turno/monto) y los meses ≥ vigencia
muestran el nuevo. Eliminar el cliente de prueba al terminar.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(plans): MonthCard resolves plan version per month in calendar/billing"
```

---

## Task 9: `AddClient` — selector de mes de vigencia (edición)

**Files:**
- Modify: `src/pages/Clients/AddClient.jsx`

- [ ] **Step 1: Importar servicios y agregar estado**

En el import de servicios (≈línea 4) agregar `getClientInvoices`, `setClientPlanVersion`.

Agregar estado para el mes de vigencia y el piso (solo relevante en edición). Cerca de los
otros `useState`:

```javascript
  const [planEffectiveFrom, setPlanEffectiveFrom] = useState('') // 'YYYY-MM'
  const [planFloorMonth, setPlanFloorMonth] = useState('')       // earliest selectable 'YYYY-MM'
```

- [ ] **Step 2: Calcular piso y default al cargar (modo edición)**

En el `useEffect` de carga de cliente (≈línea 114, `if (!isEditMode) return`), tras setear
el form, calcular el piso (primer mes no pagado) y el default (mes en curso, no menor al
piso). Agregar dentro del bloque de carga, después de `getClientById`:

```javascript
        const invoices = await getClientInvoices(id).catch(() => [])
        const unpaid = invoices
          .filter(inv => inv.paymentStatus !== 'paid')
          .sort((a, b) => (a.year - b.year) || (a.month - b.month))
        const now = new Date()
        const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        const floorKey = unpaid.length
          ? `${unpaid[0].year}-${String(unpaid[0].month + 1).padStart(2, '0')}`
          : currentKey
        setPlanFloorMonth(floorKey)
        setPlanEffectiveFrom(currentKey < floorKey ? floorKey : currentKey)
```

> `inv.month` es 0-indexed; el `+1` y `padStart` lo pasan a `MM`.

- [ ] **Step 3: Renderizar el selector en el Step 2 (solo edición)**

En el Step 2 del wizard (≈línea 558, "Plan y asistencia"), agregar al inicio del bloque —
solo en `isEditMode` — un selector de mes. Construir las opciones del piso hasta +6 meses:

```jsx
            {isEditMode && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vigente desde
                </label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={planEffectiveFrom}
                  onChange={e => setPlanEffectiveFrom(e.target.value)}
                >
                  {buildEffectiveMonthOptions(planFloorMonth).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Los cambios de plan aplican desde este mes en adelante. Los meses
                  anteriores no se modifican.
                </p>
              </div>
            )}
```

Agregar el helper a nivel de módulo (arriba del componente):

```javascript
const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// Build month options from floorKey ('YYYY-MM') through floor + 6 months.
function buildEffectiveMonthOptions(floorKey) {
  if (!floorKey) return []
  const [fy, fm] = floorKey.split('-').map(Number)
  const options = []
  for (let i = 0; i <= 6; i++) {
    const d = new Date(fy, fm - 1 + i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${MONTH_NAMES_ES[d.getMonth()]} ${d.getFullYear()}`
    options.push({ value, label })
  }
  return options
}
```

- [ ] **Step 4: Guardar el plan como versión en `handleSubmit` (edición)**

En `handleSubmit`, dentro de la rama `if (isEditMode)` (≈línea 277), después de
`await updateClient(id, clientData)`, persistir el plan como versión. El `effectiveFrom` se
arma desde `planEffectiveFrom` (`YYYY-MM` → `YYYY-MM-01`). La distancia es la del form
(`formData.distanceRange || geoData.distanceRange`).

```javascript
      if (isEditMode) {
        await updateClient(id, clientData)
        const effFrom = `${planEffectiveFrom}-01`
        await setClientPlanVersion(id, effFrom, {
          frequency: parseInt(formData.frequency),
          schedule: formData.schedule,
          hasTransport: formData.hasTransport,
          assignedDays: formData.assignedDays,
          distanceRange: clientData.address.distanceRange
        })
        if (geoData.lat && geoData.lng) {
          await updateClientAddressCoords(id, geoData.lat, geoData.lng).catch(console.error)
        }
        if (avatarFile) {
          await uploadClientAvatar(id, avatarFile).catch(console.error)
        }
        navigate(`/clientes/${id}`)
      } else {
```

> El alta (`else`) no cambia: `createClient` ya crea la versión 1 (Task 5).

- [ ] **Step 5: Verificación**

Run: `npm run build`
Expected: compila sin errores.

Funcional (app): editar un cliente existente, cambiar frecuencia y elegir "vigente desde"
un mes futuro; guardar; abrir el detalle y confirmar (a) meses anteriores intactos, (b)
mes elegido en adelante con el plan nuevo. Confirmar que el selector no ofrece meses
anteriores al primer mes no pagado.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/AddClient.jsx
git commit -m "feat(plans): effective-month selector on client edit; save plan as version"
```

---

## Task 10: Historial de plan en la UI

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Renderizar la lista de versiones**

En `ClientDetail` (en el cuerpo del componente principal, donde está disponible
`client.planVersions`), agregar una sección de solo lectura que liste las versiones, más
reciente primero. Ubicarla junto a la tarjeta de resumen del plan. Usar los componentes UI
existentes (`Card`) y `date-fns`/labels ya importados.

```jsx
        {client.planVersions && client.planVersions.length > 1 && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Historial de plan</h3>
            <ul className="space-y-2">
              {[...client.planVersions].reverse().map(v => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium text-gray-700">
                    {MONTH_NAMES_ES[Number(v.effectiveFrom.split('-')[1]) - 1]} {v.effectiveFrom.split('-')[0]}
                  </span>
                  <span className="text-gray-500">
                    {v.frequency}×/sem · {SCHEDULE_LABELS[v.schedule]}
                    {v.hasTransport ? ` · transporte (${v.distanceRange || 's/d'})` : ''}
                  </span>
                  <span className="text-gray-400">
                    {v.assignedDays.map(d => DAY_LABELS[d]).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
```

> Reusar `DAY_LABELS` (ya existe, usado en línea 395). Si `SCHEDULE_LABELS` y
> `MONTH_NAMES_ES` no existen en `ClientDetail.jsx`, agregarlos como constantes de módulo:

```javascript
const SCHEDULE_LABELS = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }
const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
```

- [ ] **Step 2: Verificación**

Run: `npm run build`
Expected: compila sin errores.

Funcional: un cliente con ≥2 versiones muestra el historial; uno con 1 sola versión no
muestra la sección.

- [ ] **Step 3: Recompilar Tailwind (si se usaron clases nuevas)**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: archivo regenerado sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx src/tailwind.output.css
git commit -m "feat(plans): plan history section in client detail"
```

---

## Task 11: Verificación end-to-end y limpieza

- [ ] **Step 1: Confirmar que no quedó data de prueba en la base**

```sql
SELECT count(*) AS test_rows FROM clients WHERE last_name IN ('PLANVER','BILLING','VIEW','CREATE','UPD') OR first_name LIKE 'TEST%';
```
Expected: `0`. (Los tests SQL hacen rollback vía `RAISE EXCEPTION 'TEST_OK'`; si quedó
algo de pruebas manuales del frontend, borrar esos clientes.)

- [ ] **Step 2: Build limpio**

Run: `npm run build`
Expected: compila sin errores ni warnings nuevos.

- [ ] **Step 3: Verificar la lista de migraciones**

Ejecutar `mcp__supabase__list_migrations`.
Expected: aparece `021_versioned_client_plans`.

- [ ] **Step 4: Commit final si hubo limpieza**

```bash
git add -A
git commit -m "chore(plans): e2e verification and cleanup" || echo "nada que commitear"
```

---

## Self-Review (cobertura del spec)

- §1 Modelo de datos → Task 1. ✅
- §2 Resolución (mes / hoy) → Task 3 (billing) + Task 4 (clients_full) + Task 8 (calendario). ✅
- Invariante de proración (día de ingreso inclusive) → Task 3 Step 3 (assert marzo completo) + nota Task 8. ✅
- §3 Facturación version-aware + transporte por snapshot → Task 3. ✅
- §4 Calendario por versión + `getClientPlanVersions` → Task 7 + Task 8. ✅
- §5 Edición + fecha de vigencia + piso (primer mes no pagado) + `set_client_plan_version` +
  desacople de `update_client_full` → Task 2 + Task 6 + Task 9. ✅
- §6 Historial en UI → Task 10. ✅
- §7 Migración/backfill/advisors → Task 1 + Task 6 Step 4. ✅
- §8 Casos borde (pagados congelados, piso, has_transport=false) → cubiertos por la
  resolución de versión + el piso del selector. ✅
- Fuera de alcance (borrar versiones futuras, intra-mes) → no implementado, correcto.
