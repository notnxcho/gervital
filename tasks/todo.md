# Pricing Redesign: Mensualidad + Transporte (granular IVA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar el modelo de precios a dos componentes facturados por separado (mensualidad IVA 22%, transporte IVA 10%), con frecuencia 1–5 y 3 rangos de distancia, manteniendo granularidad neto/IVA/bruto en datos contables y mostrando solo bruto en UI.

**Architecture:**
- DB: nueva tabla `transport_pricing` (15 entradas: 5 freq × 3 distancia), `plan_pricing` rediseñada (15 entradas: 5 freq × 3 turno) con columnas `price_net` y `price_gross`. `monthly_invoices` extendida con 8 columnas nuevas (net/gross × monthly_rate/chargeable × attendance/transport) preservando `chargeable_amount` como total bruto. `client_addresses.distance_range` migrado a 3 rangos.
- RPC `calculate_month_billing` recalcula ambos componentes con la misma lógica de prorrateo (`gross / fullMonthDays × chargeableDays`).
- Frontend: muestra bruto agregado en UI no-contable, expone breakdown solo en `PaymentModal`.

**Tech Stack:** PostgreSQL (Supabase), React 19, supabase-js, Tailwind CSS

**Notas:**
- Trabajar en branch dedicada: `git checkout -b pricing-redesign-2026-04` antes de empezar.
- La migración 015 es destructiva sobre `plan_pricing` (drop+recreate). En dev no hay riesgo; en prod requeriría coordinar.
- No hay test framework instalado: cada task verifica via lectura de archivo, query SQL directa, o smoke test manual en UI.

---

## File Structure

**Crear:**
- `supabase/migrations/015_pricing_redesign.sql` — toda la migración SQL (schema + seed + distance migration + RPCs + view)
- `src/services/pricing/transportPricingService.js` — servicio dedicado para precios de transporte (paralelo al de planes)

**Modificar:**
- `src/services/pricing/pricingService.js` — agregar campos net/gross + función `calculateBillingBreakdownV2` con ambos componentes
- `src/services/invoices/invoiceService.js` — exponer nuevos campos del invoices_view
- `src/services/transport/transportConstants.js` — actualizar `DISTANCE_RANGES` (3 valores), eliminar `TRANSPORT_TRIP_PRICES`
- `src/services/clients/geocodingService.js` — actualizar `distanceToRange` a 3 buckets
- `src/services/dashboard/dashboardService.js` — extender `freqCounts` a 5
- `src/pages/Clients/AddClient.jsx` — extender `FREQUENCY_OPTIONS` a 5, actualizar select de distancia, mostrar precio bruto total con desglose
- `src/pages/Clients/ClientList.jsx` — extender filtro frecuencia a 5
- `src/pages/Clients/ClientDetail.jsx` — actualizar etiqueta de distancia, recálculo live con dos componentes, breakdown en `PaymentModal`

**No tocar:**
- `transport_trip_counts` table y `save_transport_day` RPC — quedan como métricas operativas de viajes (ya no se usan para facturación pero el conteo sigue siendo útil para auditoría operativa).
- `transportService.js` — sin cambios.

---

## Task 1: Crear migración 015 — schema (tablas, columnas, constraints)

**Files:**
- Create: `supabase/migrations/015_pricing_redesign.sql` (sección 1)

- [ ] **Step 1: Crear archivo con schema changes**

```sql
-- ============================================
-- 015: Pricing Redesign
-- - plan_pricing: frequency 1..5, columns price_net + price_gross (drop old price)
-- - new transport_pricing table
-- - client_addresses.distance_range migrated to 3 buckets
-- - monthly_invoices extended with attendance/transport × net/gross granularity
-- - RPCs and views updated
-- ============================================

-- ============================================
-- Step 1 — client_plans: extend frequency to 1..5
-- ============================================

ALTER TABLE client_plans DROP CONSTRAINT IF EXISTS client_plans_frequency_check;
ALTER TABLE client_plans ADD CONSTRAINT client_plans_frequency_check
  CHECK (frequency IN (1, 2, 3, 4, 5));

-- ============================================
-- Step 2 — plan_pricing: extend frequency, add net/gross columns
-- ============================================

DELETE FROM plan_pricing;

ALTER TABLE plan_pricing DROP CONSTRAINT IF EXISTS plan_pricing_frequency_check;
ALTER TABLE plan_pricing ADD CONSTRAINT plan_pricing_frequency_check
  CHECK (frequency IN (1, 2, 3, 4, 5));

ALTER TABLE plan_pricing ADD COLUMN IF NOT EXISTS price_net NUMERIC(12, 2);
ALTER TABLE plan_pricing ADD COLUMN IF NOT EXISTS price_gross NUMERIC(12, 2);

ALTER TABLE plan_pricing ALTER COLUMN price_net SET NOT NULL;
ALTER TABLE plan_pricing ALTER COLUMN price_gross SET NOT NULL;

-- Drop old `price` column (replaced by price_net/price_gross)
ALTER TABLE plan_pricing DROP COLUMN IF EXISTS price;

-- ============================================
-- Step 3 — transport_pricing: new table (frequency × distance_range)
-- ============================================

CREATE TABLE transport_pricing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  frequency INTEGER NOT NULL CHECK (frequency IN (1, 2, 3, 4, 5)),
  distance_range TEXT NOT NULL CHECK (distance_range IN ('0_to_2km', '2_to_5km', '5_to_10km')),
  price_net NUMERIC(12, 2) NOT NULL,
  price_gross NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (frequency, distance_range)
);

ALTER TABLE transport_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transport_pricing_select" ON transport_pricing FOR SELECT TO authenticated USING (true);
CREATE POLICY "transport_pricing_modify" ON transport_pricing FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER set_transport_pricing_updated_at
  BEFORE UPDATE ON transport_pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Step 4 — client_addresses: migrate distance_range to 3 buckets
-- ============================================

-- Drop old constraint to allow temporary mixed values during migration
ALTER TABLE client_addresses DROP CONSTRAINT IF EXISTS client_addresses_distance_range_check;

-- Map old → new (in order, per spec)
UPDATE client_addresses SET distance_range = '0_to_2km' WHERE distance_range = 'under_1km';
UPDATE client_addresses SET distance_range = '2_to_5km' WHERE distance_range = '1_to_5km';
UPDATE client_addresses SET distance_range = '5_to_10km' WHERE distance_range = 'over_10km';
-- '5_to_10km' rows already match the new label

-- Add new constraint with 3 valid values
ALTER TABLE client_addresses ADD CONSTRAINT client_addresses_distance_range_check
  CHECK (distance_range IS NULL OR distance_range IN ('0_to_2km', '2_to_5km', '5_to_10km'));

-- ============================================
-- Step 5 — monthly_invoices: granular attendance/transport columns
-- ============================================

ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS attendance_monthly_rate_net NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS attendance_monthly_rate_gross NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS attendance_chargeable_net NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS attendance_chargeable_gross NUMERIC(12, 2);

ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS transport_monthly_rate_net NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS transport_monthly_rate_gross NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS transport_chargeable_net NUMERIC(12, 2);
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS transport_chargeable_gross NUMERIC(12, 2);

-- Backfill existing rows: chargeable_amount represents legacy attendance gross
UPDATE monthly_invoices
SET
  attendance_chargeable_gross = chargeable_amount,
  attendance_chargeable_net = ROUND(chargeable_amount / 1.22, 2),
  attendance_monthly_rate_gross = monthly_rate,
  attendance_monthly_rate_net = ROUND(monthly_rate / 1.22, 2),
  transport_monthly_rate_net = 0,
  transport_monthly_rate_gross = 0,
  transport_chargeable_net = 0,
  transport_chargeable_gross = 0
WHERE attendance_chargeable_gross IS NULL;

-- monthly_rate becomes redundant once attendance_monthly_rate_gross is in place;
-- keep it for one release cycle to ease rollback. Drop in a future migration.
```

- [ ] **Step 2: Verificar que el archivo se guardó**

Run: `head -100 /Users/nacholorenzo/Desktop/nacho/software/gervital/supabase/migrations/015_pricing_redesign.sql`
Expected: muestra los headers y primer bloque de schema.

---

## Task 2: Migración 015 — seed de plan_pricing (15 entradas)

**Files:**
- Modify: `supabase/migrations/015_pricing_redesign.sql` (append section 6)

- [ ] **Step 1: Agregar el INSERT de plan_pricing**

Append:

```sql
-- ============================================
-- Step 6 — Seed plan_pricing (5 frequencies × 3 schedules = 15 entries)
-- price_gross is the cifra "linda" facturada al cliente; price_net is what
-- backs out at IVA 22% (round to nearest peso to match the spec's authoritative values).
-- ============================================

INSERT INTO plan_pricing (frequency, schedule, price_net, price_gross) VALUES
  -- morning (Medio Día Matutino)
  (1, 'morning',    13115, 16000),
  (2, 'morning',    19672, 24000),
  (3, 'morning',    25574, 31200),
  (4, 'morning',    31475, 38400),
  (5, 'morning',    37377, 45600),
  -- afternoon (Medio Día Vespertino)
  (1, 'afternoon',  16393, 20000),
  (2, 'afternoon',  24590, 30000),
  (3, 'afternoon',  31967, 39000),
  (4, 'afternoon',  39344, 48000),
  (5, 'afternoon',  46721, 57000),
  -- full_day (Día Completo)
  (1, 'full_day',   27049, 33000),
  (2, 'full_day',   39344, 48000),
  (3, 'full_day',   49180, 60000),
  (4, 'full_day',   59836, 73000),
  (5, 'full_day',   66393, 81000);
```

- [ ] **Step 2: Releer el archivo y verificar**

Read: `supabase/migrations/015_pricing_redesign.sql` desde la línea del Step 6 hasta el final.
Expected: 15 rows insertadas, 5 frecuencias × 3 turnos.

---

## Task 3: Migración 015 — seed de transport_pricing (15 entradas)

**Files:**
- Modify: `supabase/migrations/015_pricing_redesign.sql` (append section 7)

- [ ] **Step 1: Agregar el INSERT de transport_pricing**

Append:

```sql
-- ============================================
-- Step 7 — Seed transport_pricing (5 frequencies × 3 distance ranges = 15 entries)
-- IVA 10%. price_gross is authoritative round number; price_net backs out.
-- ============================================

INSERT INTO transport_pricing (frequency, distance_range, price_net, price_gross) VALUES
  -- 0 a 2 km
  (1, '0_to_2km',  2327,  2560),
  (2, '0_to_2km',  4655,  5120),
  (3, '0_to_2km',  6982,  7680),
  (4, '0_to_2km',  9309, 10240),
  (5, '0_to_2km', 11636, 12800),
  -- 2 a 5 km
  (1, '2_to_5km',  3782,  4160),
  (2, '2_to_5km',  7564,  8320),
  (3, '2_to_5km', 11345, 12480),
  (4, '2_to_5km', 15127, 16640),
  (5, '2_to_5km', 18909, 20800),
  -- 5 a 10 km
  (1, '5_to_10km',  4655,  5120),
  (2, '5_to_10km',  9309, 10240),
  (3, '5_to_10km', 13964, 15360),
  (4, '5_to_10km', 18618, 20480),
  (5, '5_to_10km', 23273, 25600);
```

- [ ] **Step 2: Verificar lectura**

Read sección 7 del archivo.
Expected: 15 rows con valores exactos del spec.

---

## Task 4: Migración 015 — RPCs `get_plan_price` y `get_transport_price`

**Files:**
- Modify: `supabase/migrations/015_pricing_redesign.sql` (append section 8)

- [ ] **Step 1: Reemplazar `get_plan_price` y crear `get_transport_price`**

Append:

```sql
-- ============================================
-- Step 8 — Pricing RPCs (return both net and gross)
-- ============================================

CREATE OR REPLACE FUNCTION get_plan_price(p_frequency INTEGER, p_schedule TEXT)
RETURNS JSONB AS $$
DECLARE v_net NUMERIC; v_gross NUMERIC;
BEGIN
  SELECT price_net, price_gross INTO v_net, v_gross
  FROM plan_pricing
  WHERE frequency = p_frequency AND schedule = p_schedule;

  IF v_net IS NULL THEN
    RAISE EXCEPTION 'No plan pricing for frequency=% schedule=%', p_frequency, p_schedule;
  END IF;

  RETURN jsonb_build_object('net', v_net, 'gross', v_gross);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_transport_price(p_frequency INTEGER, p_distance_range TEXT)
RETURNS JSONB AS $$
DECLARE v_net NUMERIC; v_gross NUMERIC;
BEGIN
  SELECT price_net, price_gross INTO v_net, v_gross
  FROM transport_pricing
  WHERE frequency = p_frequency AND distance_range = p_distance_range;

  IF v_net IS NULL THEN
    RAISE EXCEPTION 'No transport pricing for frequency=% distance=%', p_frequency, p_distance_range;
  END IF;

  RETURN jsonb_build_object('net', v_net, 'gross', v_gross);
END;
$$ LANGUAGE plpgsql STABLE;
```

- [ ] **Step 2: Verificar lectura**

Read sección 8.
Expected: dos funciones, ambas devuelven JSONB con `net` y `gross`.

---

## Task 5: Migración 015 — `calculate_month_billing` con dos componentes

**Files:**
- Modify: `supabase/migrations/015_pricing_redesign.sql` (append section 9)

- [ ] **Step 1: Reemplazar `calculate_month_billing` con versión granular**

Append:

```sql
-- ============================================
-- Step 9 — calculate_month_billing v2 (attendance + transport)
-- ============================================

CREATE OR REPLACE FUNCTION calculate_month_billing(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_client RECORD;
  v_plan RECORD;
  v_address RECORD;
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

  SELECT * INTO v_plan FROM client_plans WHERE client_id = p_client_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Plan no encontrado');
  END IF;

  -- Attendance pricing (always required)
  SELECT price_net, price_gross INTO v_plan_price
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule;
  IF v_plan_price IS NULL THEN
    RETURN jsonb_build_object('error', 'Precio de plan no encontrado');
  END IF;
  v_att_rate_net := v_plan_price.price_net;
  v_att_rate_gross := v_plan_price.price_gross;

  -- Transport pricing (optional)
  IF v_plan.has_transport THEN
    SELECT * INTO v_address FROM client_addresses WHERE client_id = p_client_id;
    IF v_address IS NULL OR v_address.distance_range IS NULL THEN
      RETURN jsonb_build_object('error', 'Cliente con transporte requiere distancia definida');
    END IF;

    SELECT price_net, price_gross INTO v_transport_price
    FROM transport_pricing
    WHERE frequency = v_plan.frequency AND distance_range = v_address.distance_range;
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

  -- Walk every day of the month, count assigned days
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

  -- Same proration logic for both components
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

    -- Totals (UI uses these)
    'totalChargeableGross', v_att_charge_gross + v_trans_charge_gross,
    'totalMonthlyRateGross', v_att_rate_gross + v_trans_rate_gross,

    -- Backwards-compat aliases (deprecated, drop in next migration)
    'monthlyRate', v_att_rate_gross,
    'chargeableAmount', v_att_charge_gross + v_trans_charge_gross
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Verificar que el snapshot de keys salientes está completo**

Read sección 9.
Expected: `RETURN jsonb_build_object` lista las 15+ keys mencionadas.

---

## Task 6: Migración 015 — `mark_month_paid` snapshotea ambos componentes

**Files:**
- Modify: `supabase/migrations/015_pricing_redesign.sql` (append section 10)

- [ ] **Step 1: Reemplazar `mark_month_paid`**

Append:

```sql
-- ============================================
-- Step 10 — mark_month_paid v2 (snapshot both components)
-- ============================================

CREATE OR REPLACE FUNCTION mark_month_paid(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_amount NUMERIC(12,2),
  p_method TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_paid_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_billing JSONB;
  v_total_gross NUMERIC(12,2);
  v_is_overridden BOOLEAN;
BEGIN
  v_billing := calculate_month_billing(p_client_id, p_year, p_month);
  IF v_billing ? 'error' THEN
    RETURN jsonb_build_object('success', false, 'error', v_billing->>'error');
  END IF;

  v_total_gross := (v_billing->>'totalChargeableGross')::NUMERIC;
  v_is_overridden := p_amount IS DISTINCT FROM v_total_gross AND p_amount IS NOT NULL;

  UPDATE monthly_invoices SET
    payment_status = 'paid',
    paid_at = NOW(),
    paid_date = COALESCE(p_paid_date, CURRENT_DATE),
    paid_amount = COALESCE(p_amount, v_total_gross),
    payment_method = p_method,
    payment_notes = p_notes,

    -- Snapshot day counts
    planned_days = (v_billing->>'plannedDays')::INTEGER,
    chargeable_days = (v_billing->>'chargeableDays')::INTEGER,

    -- Snapshot attendance component (gross + net)
    attendance_monthly_rate_net   = (v_billing->>'attendanceMonthlyRateNet')::NUMERIC,
    attendance_monthly_rate_gross = (v_billing->>'attendanceMonthlyRateGross')::NUMERIC,
    attendance_chargeable_net     = (v_billing->>'attendanceChargeableNet')::NUMERIC,
    attendance_chargeable_gross   = (v_billing->>'attendanceChargeableGross')::NUMERIC,

    -- Snapshot transport component (zero if no transport)
    transport_monthly_rate_net   = (v_billing->>'transportMonthlyRateNet')::NUMERIC,
    transport_monthly_rate_gross = (v_billing->>'transportMonthlyRateGross')::NUMERIC,
    transport_chargeable_net     = (v_billing->>'transportChargeableNet')::NUMERIC,
    transport_chargeable_gross   = (v_billing->>'transportChargeableGross')::NUMERIC,

    -- Total (legacy column kept as gross sum)
    chargeable_amount = v_total_gross,
    monthly_rate = (v_billing->>'attendanceMonthlyRateGross')::NUMERIC,
    is_amount_overridden = v_is_overridden,
    original_chargeable_amount = CASE WHEN v_is_overridden THEN v_total_gross ELSE NULL END,
    updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true, 'billing', v_billing);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Verificar lectura**

Read sección 10.
Expected: la función actualiza las 8 columnas granulares + `chargeable_amount` + `monthly_rate`.

---

## Task 7: Migración 015 — `invoices_view` con campos granulares

**Files:**
- Modify: `supabase/migrations/015_pricing_redesign.sql` (append section 11)

- [ ] **Step 1: Reemplazar `invoices_view`**

Append:

```sql
-- ============================================
-- Step 11 — invoices_view (expose granular columns)
-- ============================================

CREATE OR REPLACE VIEW invoices_view AS
SELECT
  mi.id,
  mi.client_id AS "clientId",
  mi.year,
  mi.month,
  mi.planned_days AS "plannedDays",
  mi.chargeable_days AS "chargeableDays",
  mi.chargeable_amount AS "chargeableAmount",
  mi.monthly_rate AS "monthlyRate",

  -- Attendance component
  mi.attendance_monthly_rate_net AS "attendanceMonthlyRateNet",
  mi.attendance_monthly_rate_gross AS "attendanceMonthlyRateGross",
  mi.attendance_chargeable_net AS "attendanceChargeableNet",
  mi.attendance_chargeable_gross AS "attendanceChargeableGross",

  -- Transport component
  mi.transport_monthly_rate_net AS "transportMonthlyRateNet",
  mi.transport_monthly_rate_gross AS "transportMonthlyRateGross",
  mi.transport_chargeable_net AS "transportChargeableNet",
  mi.transport_chargeable_gross AS "transportChargeableGross",

  mi.is_amount_overridden AS "isAmountOverridden",
  mi.original_chargeable_amount AS "originalChargeableAmount",
  mi.invoice_status AS "invoiceStatus",
  mi.invoiced_at AS "invoicedAt",
  mi.invoice_number AS "invoiceNumber",
  mi.invoice_url AS "invoiceUrl",
  mi.payment_status AS "paymentStatus",
  mi.paid_at AS "paidAt",
  mi.paid_date AS "paidDate",
  mi.paid_amount AS "paidAmount",
  mi.payment_method AS "paymentMethod",
  mi.payment_notes AS "paymentNotes",
  mi.created_at AS "createdAt",
  mi.updated_at AS "updatedAt"
FROM monthly_invoices mi;
```

- [ ] **Step 2: Verificar lectura**

Read sección 11.
Expected: vista lista los 8 campos granulares y mantiene los legacy.

---

## Task 8: Aplicar migración 015 en Supabase

**Files:**
- Apply: `supabase/migrations/015_pricing_redesign.sql`

- [ ] **Step 1: Aplicar la migración via Supabase MCP**

Cargar el schema (ToolSearch select:mcp__supabase__apply_migration) y ejecutar:

```
mcp__supabase__apply_migration
  name: "pricing_redesign"
  query: <full content of 015_pricing_redesign.sql>
```

- [ ] **Step 2: Validar plan_pricing**

Run via MCP `execute_sql`:
```sql
SELECT frequency, schedule, price_net, price_gross
FROM plan_pricing
ORDER BY schedule, frequency;
```
Expected: 15 rows. Spot-check:
- (1, 'morning', 13115, 16000)
- (5, 'full_day', 66393, 81000)

- [ ] **Step 3: Validar transport_pricing**

```sql
SELECT frequency, distance_range, price_net, price_gross
FROM transport_pricing
ORDER BY distance_range, frequency;
```
Expected: 15 rows. Spot-check:
- (1, '0_to_2km', 2327, 2560)
- (5, '5_to_10km', 23273, 25600)

- [ ] **Step 4: Validar migración de distance_range**

```sql
SELECT distance_range, COUNT(*) FROM client_addresses GROUP BY distance_range;
```
Expected: solo valores en `('0_to_2km', '2_to_5km', '5_to_10km', NULL)`. Cero en valores legacy.

- [ ] **Step 5: Validar `calculate_month_billing` para un cliente con transporte**

```sql
SELECT calculate_month_billing(
  (SELECT id FROM clients WHERE EXISTS (
    SELECT 1 FROM client_plans cp WHERE cp.client_id = clients.id AND cp.has_transport = true
  ) LIMIT 1),
  2026, 3
);
```
Expected: JSONB con keys `attendanceChargeableGross`, `transportChargeableGross`, `totalChargeableGross`. `transportChargeableGross > 0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/015_pricing_redesign.sql
git commit -m "feat(db): pricing redesign — split mensualidad/transporte with net+gross granularity"
```

---

## Task 9: Frontend — `transportConstants.js` cleanup

**Files:**
- Modify: `src/services/transport/transportConstants.js:41-70`

- [ ] **Step 1: Reemplazar `DISTANCE_RANGES` y eliminar `TRANSPORT_TRIP_PRICES`**

Edit `src/services/transport/transportConstants.js` — replace from line 41 to end of file with:

```js
export const DISTANCE_RANGES = [
  { id: '0_to_2km', label: '0 a 2 km' },
  { id: '2_to_5km', label: '2 a 5 km' },
  { id: '5_to_10km', label: '5 a 10 km' }
]
```

- [ ] **Step 2: Verificar que `TRANSPORT_TRIP_PRICES` no se importa en ningún lado**

Run: `grep -rn "TRANSPORT_TRIP_PRICES" src/`
Expected: sin resultados.

- [ ] **Step 3: Commit**

```bash
git add src/services/transport/transportConstants.js
git commit -m "refactor(transport): drop per-trip pricing, replace with 3 distance buckets"
```

---

## Task 10: Frontend — `geocodingService.js` distance buckets

**Files:**
- Modify: `src/services/clients/geocodingService.js:51-56`

- [ ] **Step 1: Reescribir `distanceToRange`**

Edit:

```js
export function distanceToRange(km) {
  if (km < 2) return '0_to_2km'
  if (km < 5) return '2_to_5km'
  return '5_to_10km'
}
```

(removes the `over_10km` branch — clientes lejanos caen en `5_to_10km` por consistencia con la migración manual del spec).

- [ ] **Step 2: Commit**

```bash
git add src/services/clients/geocodingService.js
git commit -m "refactor(geocoding): collapse distance buckets to 3 ranges"
```

---

## Task 11: Frontend — refactor `pricingService.js`

**Files:**
- Modify: `src/services/pricing/pricingService.js` (full rewrite)
- Create: `src/services/pricing/transportPricingService.js`

- [ ] **Step 1: Reescribir `pricingService.js`**

Replace full file content:

```js
import { supabase } from '../supabase/client'

/**
 * Get all plan pricing rows.
 * @returns {Promise<Array<{frequency, schedule, priceNet, priceGross}>>}
 */
export async function getPlanPricing() {
  const { data, error } = await supabase
    .from('plan_pricing')
    .select('frequency, schedule, price_net, price_gross')
    .order('frequency', { ascending: true })
    .order('schedule', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(p => ({
    frequency: p.frequency,
    schedule: p.schedule,
    priceNet: Number(p.price_net),
    priceGross: Number(p.price_gross)
  }))
}

/**
 * Lookup plan price (gross + net) from cached pricing array.
 * @returns {{priceNet: number, priceGross: number}}
 */
export function getPlanPriceSync(pricingData, frequency, schedule) {
  const plan = pricingData.find(p => p.frequency === frequency && p.schedule === schedule)
  if (!plan) return { priceNet: 0, priceGross: 0 }
  return { priceNet: plan.priceNet, priceGross: plan.priceGross }
}

/**
 * Compute prorated amount: monthly × (chargeableDays / fullMonthDays).
 * @returns {number} rounded
 */
export function calculateProration(chargeableDays, fullMonthDays, monthlyAmount) {
  if (fullMonthDays <= 0) return 0
  return Math.round(monthlyAmount * (chargeableDays / fullMonthDays))
}
```

- [ ] **Step 2: Crear `transportPricingService.js`**

Write `src/services/pricing/transportPricingService.js`:

```js
import { supabase } from '../supabase/client'

/**
 * Get all transport pricing rows.
 * @returns {Promise<Array<{frequency, distanceRange, priceNet, priceGross}>>}
 */
export async function getTransportPricing() {
  const { data, error } = await supabase
    .from('transport_pricing')
    .select('frequency, distance_range, price_net, price_gross')
    .order('frequency', { ascending: true })
    .order('distance_range', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(p => ({
    frequency: p.frequency,
    distanceRange: p.distance_range,
    priceNet: Number(p.price_net),
    priceGross: Number(p.price_gross)
  }))
}

/**
 * Lookup transport price (gross + net) from cached pricing array.
 * @returns {{priceNet: number, priceGross: number}}
 */
export function getTransportPriceSync(pricingData, frequency, distanceRange) {
  const row = pricingData.find(p => p.frequency === frequency && p.distanceRange === distanceRange)
  if (!row) return { priceNet: 0, priceGross: 0 }
  return { priceNet: row.priceNet, priceGross: row.priceGross }
}
```

- [ ] **Step 3: Re-export desde `services/api.js`**

Read `src/services/api.js` to find the pricing re-export block, then append/replace with:

```js
export { getPlanPricing, getPlanPriceSync, calculateProration } from './pricing/pricingService'
export { getTransportPricing, getTransportPriceSync } from './pricing/transportPricingService'
```

(remove old exports `calculatePlanPrice`, `calculatePlanPriceSync`, `calculateBillingBreakdown` if they were re-exported there).

- [ ] **Step 4: Buscar callers viejos**

Run: `grep -rn "calculatePlanPriceSync\|calculatePlanPrice\b\|calculateBillingBreakdown" src/`
Expected callers: `AddClient.jsx`, `ClientDetail.jsx`. Anotar para tasks siguientes.

- [ ] **Step 5: Commit**

```bash
git add src/services/pricing/ src/services/api.js
git commit -m "refactor(pricing): split plan and transport services, expose net+gross"
```

---

## Task 12: Frontend — refactor `invoiceService.js`

**Files:**
- Modify: `src/services/invoices/invoiceService.js:27-76`

- [ ] **Step 1: Mapear nuevos campos en `getClientInvoices`**

Edit el `data.map(...)` (líneas 27-47) para incluir los 8 campos granulares:

```js
return data.map(inv => ({
  clientId: inv.clientId,
  year: inv.year,
  month: inv.month,
  plannedDays: inv.plannedDays || 0,
  chargeableDays: inv.chargeableDays || 0,
  chargeableAmount: Number(inv.chargeableAmount) || 0,
  monthlyRate: Number(inv.monthlyRate) || 0,

  attendanceMonthlyRateNet: Number(inv.attendanceMonthlyRateNet) || 0,
  attendanceMonthlyRateGross: Number(inv.attendanceMonthlyRateGross) || 0,
  attendanceChargeableNet: Number(inv.attendanceChargeableNet) || 0,
  attendanceChargeableGross: Number(inv.attendanceChargeableGross) || 0,

  transportMonthlyRateNet: Number(inv.transportMonthlyRateNet) || 0,
  transportMonthlyRateGross: Number(inv.transportMonthlyRateGross) || 0,
  transportChargeableNet: Number(inv.transportChargeableNet) || 0,
  transportChargeableGross: Number(inv.transportChargeableGross) || 0,

  isAmountOverridden: inv.isAmountOverridden || false,
  originalChargeableAmount: inv.originalChargeableAmount ? Number(inv.originalChargeableAmount) : null,
  invoiceStatus: inv.invoiceStatus,
  invoicedAt: inv.invoicedAt,
  invoiceNumber: inv.invoiceNumber,
  invoiceUrl: inv.invoiceUrl,
  paymentStatus: inv.paymentStatus,
  paidAt: inv.paidAt,
  paidDate: inv.paidDate,
  paidAmount: inv.paidAmount ? Number(inv.paidAmount) : null,
  paymentMethod: inv.paymentMethod,
  paymentNotes: inv.paymentNotes
}))
```

- [ ] **Step 2: Mapear nuevos campos en `calculateMonthBilling`**

Edit el return (líneas 66-75) a:

```js
return {
  fullMonthDays: data.fullMonthDays,
  plannedDays: data.plannedDays,
  vacationDays: data.vacationDays,
  recoveryDays: data.recoveryDays,
  chargeableDays: data.chargeableDays,
  isProrated: data.isProrated,
  hasTransport: data.hasTransport,

  attendanceMonthlyRateNet: Number(data.attendanceMonthlyRateNet) || 0,
  attendanceMonthlyRateGross: Number(data.attendanceMonthlyRateGross) || 0,
  attendanceChargeableNet: Number(data.attendanceChargeableNet) || 0,
  attendanceChargeableGross: Number(data.attendanceChargeableGross) || 0,

  transportMonthlyRateNet: Number(data.transportMonthlyRateNet) || 0,
  transportMonthlyRateGross: Number(data.transportMonthlyRateGross) || 0,
  transportChargeableNet: Number(data.transportChargeableNet) || 0,
  transportChargeableGross: Number(data.transportChargeableGross) || 0,

  totalChargeableGross: Number(data.totalChargeableGross) || 0,
  totalMonthlyRateGross: Number(data.totalMonthlyRateGross) || 0,

  // Legacy aliases (UI debe migrar a los granulares)
  monthlyRate: Number(data.monthlyRate) || 0,
  chargeableAmount: Number(data.chargeableAmount) || 0
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/invoices/invoiceService.js
git commit -m "feat(invoices): expose attendance/transport breakdown from billing RPC"
```

---

## Task 13: Frontend — `AddClient.jsx` (frequency=5, distancia, precio total)

**Files:**
- Modify: `src/pages/Clients/AddClient.jsx:6` (import)
- Modify: `src/pages/Clients/AddClient.jsx:12-17` (FREQUENCY_OPTIONS)
- Modify: `src/pages/Clients/AddClient.jsx:285-289` (estimatedPrice)
- Modify: `src/pages/Clients/AddClient.jsx:511-517` (distance options)
- Modify: `src/pages/Clients/AddClient.jsx:592-601` (price preview)

- [ ] **Step 1: Actualizar imports**

Replace line 6:

```js
import { getPlanPricing, getPlanPriceSync } from '../../services/pricing/pricingService'
import { getTransportPricing, getTransportPriceSync } from '../../services/pricing/transportPricingService'
```

- [ ] **Step 2: Extender `FREQUENCY_OPTIONS` a 5**

Replace lines 12-17:

```js
const FREQUENCY_OPTIONS = [
  { value: '1', label: '1 vez por semana' },
  { value: '2', label: '2 veces por semana' },
  { value: '3', label: '3 veces por semana' },
  { value: '4', label: '4 veces por semana' },
  { value: '5', label: '5 veces por semana' }
]
```

- [ ] **Step 3: Cargar transport pricing**

En `AddClient.jsx`, el state existente está en línea 90 y el `useEffect` en líneas 95-97. Agregar **inmediatamente después** del state de `pricingData` (línea 90):

```js
const [transportPricingData, setTransportPricingData] = useState([])
```

Y dentro del `useEffect` existente (líneas 95-97), agregar la segunda llamada:

```js
useEffect(() => {
  getPlanPricing()
    .then(setPricingData)
    .catch(() => {})
  getTransportPricing()
    .then(setTransportPricingData)
    .catch(() => {})
}, [])
```

- [ ] **Step 4: Recalcular `estimatedPrice` con desglose**

Replace lines 285-289:

```js
const planPrice = getPlanPriceSync(
  pricingData,
  parseInt(formData.frequency),
  formData.schedule
)
const transportPrice = formData.hasTransport && formData.distanceRange
  ? getTransportPriceSync(
      transportPricingData,
      parseInt(formData.frequency),
      formData.distanceRange
    )
  : { priceNet: 0, priceGross: 0 }

const estimatedTotalGross = planPrice.priceGross + transportPrice.priceGross
```

- [ ] **Step 5: Actualizar select de distancia**

Replace lines 511-517:

```js
options={[
  { value: '', label: 'Sin definir' },
  { value: '0_to_2km', label: '0 a 2 km' },
  { value: '2_to_5km', label: '2 a 5 km' },
  { value: '5_to_10km', label: '5 a 10 km' }
]}
```

- [ ] **Step 6: Reemplazar bloque de price preview con desglose**

Replace lines 592-601:

```jsx
<div className="bg-indigo-50 rounded-lg p-4 space-y-2">
  <p className="text-sm text-indigo-700">Precio mensual estimado</p>
  <p className="text-2xl font-bold text-indigo-900">
    ${estimatedTotalGross.toLocaleString()}
  </p>
  <div className="text-xs text-indigo-700 space-y-0.5">
    <p>Mensualidad: ${planPrice.priceGross.toLocaleString()}</p>
    {formData.hasTransport && (
      <p>
        Transporte: {transportPrice.priceGross > 0
          ? `$${transportPrice.priceGross.toLocaleString()}`
          : '— (definir distancia)'}
      </p>
    )}
  </div>
  <p className="text-xs text-indigo-600 mt-1">
    {formData.frequency}x/semana · {SCHEDULE_OPTIONS.find(s => s.value === formData.schedule)?.label}
    {formData.hasTransport && ' · Transporte'}
  </p>
</div>
```

- [ ] **Step 7: Smoke test manual**

```bash
npm start
```

Probar:
1. Ir a "Agregar cliente". El select de Frecuencia muestra 5 opciones.
2. El select de Distancia muestra 3 opciones (0-2, 2-5, 5-10) + "Sin definir".
3. Step 2: con frecuencia 5, turno full_day, sin transporte → el preview debe mostrar `$81.000`.
4. Tildar transporte y elegir distancia 5-10km → preview muestra `$81.000 + $25.600 = $106.600`, con desglose.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Clients/AddClient.jsx
git commit -m "feat(clients): support 5 freq + transport breakdown in add/edit form"
```

---

## Task 14: Frontend — `ClientList.jsx` filtro frecuencia 1-5

**Files:**
- Modify: `src/pages/Clients/ClientList.jsx:42-51`

- [ ] **Step 1: Extender opciones del filtro**

Replace lines 42-51:

```js
{
  key: 'frequency',
  label: 'Frecuencia',
  options: [
    { value: 1, label: '1x' },
    { value: 2, label: '2x' },
    { value: 3, label: '3x' },
    { value: 4, label: '4x' },
    { value: 5, label: '5x' }
  ]
},
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Clients/ClientList.jsx
git commit -m "feat(clients): add 5x/semana to frequency filter"
```

---

## Task 15: Frontend — `dashboardService.js` freqCounts 1-5

**Files:**
- Modify: `src/services/dashboard/dashboardService.js:73`

- [ ] **Step 1: Extender `freqCounts`**

Replace line 73:

```js
const freqCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
```

- [ ] **Step 2: Commit**

```bash
git add src/services/dashboard/dashboardService.js
git commit -m "feat(dashboard): track 5x/semana in frequency stats"
```

---

## Task 16: Frontend — `ClientDetail.jsx` (display + cálculo + PaymentModal)

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx:10` (imports)
- Modify: `src/pages/Clients/ClientDetail.jsx:91` (state)
- Modify: `src/pages/Clients/ClientDetail.jsx:125-139` (useEffect loading)
- Modify: `src/pages/Clients/ClientDetail.jsx:464,478` (prop a MonthCard) y `:513` (signature de MonthCard)
- Modify: `src/pages/Clients/ClientDetail.jsx:329-333` (distance label)
- Modify: `src/pages/Clients/ClientDetail.jsx:576-582` (live amount calc)
- Modify: `src/pages/Clients/ClientDetail.jsx:976-993` (PaymentModal billing breakdown)

- [ ] **Step 1: Actualizar imports y state**

En la línea 10 (import block), reemplazar la línea de pricing con:

```js
import { getPlanPricing, getPlanPriceSync } from '../../services/pricing/pricingService'
import { getTransportPricing, getTransportPriceSync } from '../../services/pricing/transportPricingService'
```

Inmediatamente después de `const [pricingData, setPricingData] = useState([])` (línea 91), agregar:

```js
const [transportPricingData, setTransportPricingData] = useState([])
```

En el `useEffect` (cerca de líneas 125-139), agregar la carga paralela:

```js
const [pricing, transportPricing] = await Promise.all([
  getPlanPricing(),
  getTransportPricing()
])
setPricingData(pricing)
setTransportPricingData(transportPricing)
```

(Read líneas 120-145 antes de editar para ver el shape exacto del effect actual y mantener su estilo.)

- [ ] **Step 1b: Pasar `transportPricingData` como prop a `MonthCard`**

En las líneas 464 y 478 (donde se renderiza `<MonthCard ... pricingData={pricingData} ... />`), agregar:

```jsx
transportPricingData={transportPricingData}
```

En la signature de `MonthCard` (línea 513):

```js
function MonthCard({ client, year, month, invoice, attendance, pricingData, transportPricingData, user, onRefresh }) {
```

- [ ] **Step 2: Etiqueta de distancia**

Replace lines 329-333:

```jsx
{client.plan.hasTransport && client.address?.distanceRange && (
  <span className="text-sm font-normal text-gray-500 ml-1">
    ({({ '0_to_2km': '0-2km', '2_to_5km': '2-5km', '5_to_10km': '5-10km' })[client.address.distanceRange]})
  </span>
)}
```

- [ ] **Step 3: Recalcular `liveChargeableAmount` con dos componentes**

Replace lines 576-582:

```js
const planPrice = getPlanPriceSync(pricingData, client.plan.frequency, client.plan.schedule)
const transportPrice = client.plan.hasTransport && client.address?.distanceRange
  ? getTransportPriceSync(transportPricingData, client.plan.frequency, client.address.distanceRange)
  : { priceNet: 0, priceGross: 0 }

const monthlyTotalGross = planPrice.priceGross + transportPrice.priceGross
const liveChargeableAmount = fullMonthDays > 0
  ? Math.round((chargeableDays / fullMonthDays) * monthlyTotalGross)
  : 0

const displayAmount = isPaid ? (invoice.paidAmount ?? invoice.chargeableAmount) : liveChargeableAmount
```

(Si hay variables `monthlyRate` referenciadas más abajo en este componente que aún esperan un solo número, mapearlas a `monthlyTotalGross`. Buscar con `grep -n "monthlyRate\b" src/pages/Clients/ClientDetail.jsx` antes de continuar.)

- [ ] **Step 4: PaymentModal — mostrar desglose**

Replace lines 976-993 (el bloque `{billing && (`):

```jsx
{billing && (
  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
    <div className="flex justify-between text-gray-600">
      <span>Días planificados:</span><span>{billing.plannedDays}/{billing.fullMonthDays}</span>
    </div>
    {billing.vacationDays > 0 && (
      <div className="flex justify-between text-orange-600">
        <span>Vacaciones:</span><span>-{billing.vacationDays} días</span>
      </div>
    )}
    <div className="flex justify-between font-medium text-gray-800 border-t border-gray-200 pt-1">
      <span>Días a cobrar:</span><span>{billing.chargeableDays}</span>
    </div>
    <div className="flex justify-between text-gray-700 pt-1">
      <span>Mensualidad:</span><span>${billing.attendanceChargeableGross.toLocaleString()}</span>
    </div>
    {billing.hasTransport && (
      <div className="flex justify-between text-gray-700">
        <span>Transporte:</span><span>${billing.transportChargeableGross.toLocaleString()}</span>
      </div>
    )}
    <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-300 pt-1">
      <span>Total a cobrar:</span><span>${billing.totalChargeableGross.toLocaleString()}</span>
    </div>
  </div>
)}
```

Y en el `useEffect` del PaymentModal (líneas 940-951), cambiar la línea que setea el monto inicial:

```js
.then(b => { setBilling(b); setAmount(String(b.totalChargeableGross)) })
```

- [ ] **Step 5: Smoke test manual**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
npm start
```

Probar:
1. Detalle de un cliente con transporte → debajo de "Transporte: Incluido" aparece "(0-2km / 2-5km / 5-10km)" según corresponda.
2. Calendario → el monto mensual mostrado refleja plan + transporte (sumar mentalmente). Cliente sin transporte → solo plan.
3. Click en "Cobrar mes" → el modal muestra "Mensualidad", "Transporte" (si aplica), y "Total a cobrar". El input `Monto cobrado` viene precargado con el total bruto.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(clients): show attendance/transport breakdown in detail and payment modal"
```

---

## Task 17: Verificación end-to-end

**Files:**
- Verify: `src/`, `supabase/`

- [ ] **Step 1: Buscar referencias residuales a campos viejos**

Run en paralelo:

```bash
grep -rn "under_1km\|over_10km\|TRANSPORT_TRIP_PRICES\|calculatePlanPriceSync\|calculatePlanPrice\b\|calculateBillingBreakdown" src/ supabase/
```

Expected: solo dentro de migraciones viejas (001_schema, 012_transport_scheduling) — históricas, no se modifican. Cero matches en `src/`.

- [ ] **Step 2: Compilar Tailwind y arrancar app**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
npm start
```

Expected: arranca sin errores de lint/import.

- [ ] **Step 3: Smoke test de flujos críticos en navegador**

1. **Dashboard** → carga sin error, métricas de frecuencia incluyen `5: N` (aunque sea 0).
2. **Clientes** → filtro de frecuencia muestra 1-5.
3. **Alta cliente** wizard step 2 → frecuencia 5 disponible, distancia 3 opciones, preview con desglose mensualidad/transporte cuando aplica.
4. **Detalle cliente con transporte** → label de distancia correcto. Calendario: monto mensual = plan + transporte. PaymentModal muestra breakdown.
5. **Detalle cliente sin transporte** → no menciona transporte. PaymentModal sin línea de transporte.
6. **Marcar mes como pagado** → query `monthly_invoices` por ese row y verificar que las 8 columnas granulares quedaron snapshoteadas.

   Via MCP:
   ```sql
   SELECT
     attendance_monthly_rate_net, attendance_monthly_rate_gross,
     attendance_chargeable_net, attendance_chargeable_gross,
     transport_monthly_rate_net, transport_monthly_rate_gross,
     transport_chargeable_net, transport_chargeable_gross,
     chargeable_amount, monthly_rate
   FROM monthly_invoices
   WHERE client_id = '<id>' AND year = 2026 AND month = 3;
   ```
   Expected: `attendance_chargeable_gross + transport_chargeable_gross = chargeable_amount`.

- [ ] **Step 4: Commit final si quedaron ajustes**

```bash
git status
# si hay cambios derivados del smoke test
git add -A
git commit -m "chore: pricing redesign smoke-test fixes"
```

---

## Self-Review Checklist (post-write)

- ✅ **Spec coverage**:
  - 30 → 15+15 precios (tablas separadas): Tasks 2, 3
  - IVA 22% / IVA 10% guardados como `price_net` + `price_gross`: Tasks 1, 2, 3
  - Frecuencia 1-5: Tasks 1, 13, 14, 15
  - Distancias 3 buckets + migración: Tasks 1 (step 4), 9, 10, 13
  - Granularidad neto/IVA/bruto en `monthly_invoices`: Tasks 1 (step 5), 5, 6, 7
  - Prorrateo transporte = misma lógica que mensualidad: Task 5 (`v_proration_factor`)
  - UI muestra solo bruto agregado, breakdown solo en PaymentModal: Tasks 13 (step 6), 16 (step 4)
  - Eliminación de `TRANSPORT_TRIP_PRICES`: Task 9
  - Mapeo en orden + `over_10km → 5_to_10km`: Task 1 (step 4)
- ✅ **Sin placeholders**: cada step muestra código completo o comando exacto.
- ✅ **Type consistency**: `priceNet`/`priceGross` en JS, `price_net`/`price_gross` en SQL. `attendanceChargeableGross` consistente entre RPC return, view, invoiceService, ClientDetail.

---

## Decisiones técnicas

1. **Backwards-compat aliases (`monthlyRate`, `chargeableAmount`)** se mantienen una release: el RPC los devuelve, la vista los expone, los UIs viejos no rompen. Se eliminan en migración futura.
2. **Override de monto** sigue aplicando al total (single override), no por componente. Mantiene la simplicidad del flow actual; si el contador necesita override por componente, se agrega después.
3. **Cliente con transporte sin distancia** falla `calculate_month_billing` con error explícito (Task 5). Bloqueante intencional: forzar a definir distancia o desmarcar transporte.
4. **`transport_trip_counts` no se borra**: queda como métrica operativa de uso real del transporte (auditoría: cuántos viajes se ejecutaron). No participa de facturación.
5. **`monthly_rate` legacy column** no se dropea en esta migración para permitir rollback. Se elimina en migración 016 cuando todo quede estable.

---

## Execution choice

Plan completo y guardado en `tasks/todo.md`. Dos opciones de ejecución:

**1. Subagent-Driven (recommended)** — un subagent fresco por task, review entre tasks, iteración rápida.

**2. Inline Execution** — ejecutar tasks en esta sesión con checkpoints de review.

¿Cuál preferís?
