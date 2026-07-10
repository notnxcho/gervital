# Gerencia — Gestión de planes (precios versionados) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renombrar "Accesos" a "Gerencia" con dos pestañas (Accesos + Gestión de planes), donde el superadmin edita precios de planes y transporte con vigencia por mes.

**Architecture:** Se versionan `plan_pricing` y `transport_pricing` agregando `(effective_year, effective_month)`. El billing elige la versión vigente para cada mes. Editar precios inserta/actualiza la versión del mes de vigencia elegido (escritura inmediata vía RPC `set_pricing`, solo superadmin). Meses ya cobrados/facturados usan su snapshot y no cambian.

**Tech Stack:** Supabase/PostgreSQL (migraciones, RPC plpgsql), React 19, Tailwind, jest (`craco test`).

## Global Constraints

- Variables y código en **inglés**; textos de UI en **español**.
- **No** usar `;` en JS/JSX cuando no es obligatorio.
- Datos/funciones mockeadas se comentan `// MOCKED RES`.
- IVA = 22%. Net se deriva del gross: `ROUND(gross / 1.22, 2)`.
- `effective_month` es **0-indexed** (igual que `monthly_invoices.month`).
- Named exports para servicios; default export para componentes de página.
- Compilar Tailwind tras cambios de estilos: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.
- Branch de trabajo: `feat/gerencia-gestion-planes` (ya creado).

## Estado actual del backend (verificado en DB)

- `plan_pricing` UNIQUE: `plan_pricing_frequency_schedule_key (frequency, schedule)`.
- `transport_pricing` UNIQUE: `transport_pricing_frequency_distance_range_key (frequency, distance_range)`.
- Helpers RLS existentes: `is_superadmin()`, `is_admin_or_superadmin()`.
- RLS `plan_pricing`: SELECT = admin/superadmin; INSERT/UPDATE/DELETE = superadmin (ya endurecido). **No tocar.**
- RLS `transport_pricing`: `transport_pricing_select [SELECT] true`, `transport_pricing_modify [ALL] true` (abierto). **Endurecer.**
- `calculate_month_billing(uuid,int,int)`: versión vigente incluye descuento (`discount_percent`), tarifa determinística (`4×frecuencia`) y corte por `deactivation_date`. La tarea 1 la reescribe cambiando **solo** los dos SELECT de precio.

---

### Task 1: Migración 055 — precios versionados + RPC + billing

**Files:**
- Create: `supabase/migrations/055_versioned_pricing.sql`

**Interfaces:**
- Produces (RPC): `set_pricing(p_effective_year int, p_effective_month int, p_plan_prices jsonb, p_transport_prices jsonb) RETURNS jsonb` → `{success:bool, error?:text}`.
  - `p_plan_prices`: array de `{frequency:int, schedule:text, price_gross:number}`.
  - `p_transport_prices`: array de `{frequency:int, distance_range:text, price_gross:number}`.
- Produces (columnas): `plan_pricing.effective_year/effective_month`, `transport_pricing.effective_year/effective_month`.
- Produces (semántica): `calculate_month_billing` usa la versión con `(effective_year*12+effective_month)` máximo `≤ (p_year*12+p_month)`.

- [ ] **Step 1: Escribir la migración**

Create `supabase/migrations/055_versioned_pricing.sql`:

```sql
-- 055_versioned_pricing.sql
-- Precios de plan/transporte versionados por (effective_year, effective_month).
-- Editar precios desde un mes elegido en adelante; meses anteriores mantienen la versión
-- previa; meses cobrados/facturados conservan su snapshot en monthly_invoices.

BEGIN;

-- 1. Columnas de vigencia (month 0-indexed, como monthly_invoices). DEFAULT (2000,0)
--    hace que las filas existentes apliquen a todo mes histórico (backfill implícito).
ALTER TABLE plan_pricing      ADD COLUMN IF NOT EXISTS effective_year  INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE plan_pricing      ADD COLUMN IF NOT EXISTS effective_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transport_pricing ADD COLUMN IF NOT EXISTS effective_year  INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE transport_pricing ADD COLUMN IF NOT EXISTS effective_month INTEGER NOT NULL DEFAULT 0;

-- 2. Reemplazar UNIQUE para incluir la vigencia (permite múltiples versiones por combo)
ALTER TABLE plan_pricing      DROP CONSTRAINT IF EXISTS plan_pricing_frequency_schedule_key;
ALTER TABLE transport_pricing DROP CONSTRAINT IF EXISTS transport_pricing_frequency_distance_range_key;

ALTER TABLE plan_pricing ADD CONSTRAINT plan_pricing_freq_sched_eff_key
  UNIQUE (frequency, schedule, effective_year, effective_month);
ALTER TABLE transport_pricing ADD CONSTRAINT transport_pricing_freq_dist_eff_key
  UNIQUE (frequency, distance_range, effective_year, effective_month);

-- 3. Endurecer RLS de transport_pricing (plan_pricing ya está endurecido)
DROP POLICY IF EXISTS "transport_pricing_select" ON transport_pricing;
DROP POLICY IF EXISTS "transport_pricing_modify" ON transport_pricing;
CREATE POLICY "transport_pricing_select_admin" ON transport_pricing
  FOR SELECT USING (is_admin_or_superadmin());
CREATE POLICY "transport_pricing_write_superadmin" ON transport_pricing
  FOR ALL USING (is_superadmin()) WITH CHECK (is_superadmin());

-- 4. RPC de escritura (solo superadmin). Net se deriva del gross (IVA 22%).
CREATE OR REPLACE FUNCTION set_pricing(
  p_effective_year INTEGER,
  p_effective_month INTEGER,
  p_plan_prices JSONB,
  p_transport_prices JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_gross NUMERIC;
  v_net NUMERIC;
  v_current_ym INTEGER;
  v_target_ym INTEGER;
BEGIN
  IF NOT is_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
  END IF;

  v_current_ym := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER * 12
                  + (EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER - 1);
  v_target_ym := p_effective_year * 12 + p_effective_month;
  IF v_target_ym < v_current_ym THEN
    RETURN jsonb_build_object('success', false,
      'error', 'El mes de vigencia no puede ser anterior al mes actual');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_plan_prices) LOOP
    v_gross := (v_item->>'price_gross')::NUMERIC;
    v_net := ROUND(v_gross / 1.22, 2);
    INSERT INTO plan_pricing (frequency, schedule, price_net, price_gross, effective_year, effective_month)
    VALUES ((v_item->>'frequency')::INTEGER, v_item->>'schedule', v_net, v_gross,
            p_effective_year, p_effective_month)
    ON CONFLICT (frequency, schedule, effective_year, effective_month)
    DO UPDATE SET price_net = EXCLUDED.price_net,
                  price_gross = EXCLUDED.price_gross,
                  updated_at = NOW();
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_transport_prices) LOOP
    v_gross := (v_item->>'price_gross')::NUMERIC;
    v_net := ROUND(v_gross / 1.22, 2);
    INSERT INTO transport_pricing (frequency, distance_range, price_net, price_gross, effective_year, effective_month)
    VALUES ((v_item->>'frequency')::INTEGER, v_item->>'distance_range', v_net, v_gross,
            p_effective_year, p_effective_month)
    ON CONFLICT (frequency, distance_range, effective_year, effective_month)
    DO UPDATE SET price_net = EXCLUDED.price_net,
                  price_gross = EXCLUDED.price_gross,
                  updated_at = NOW();
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. calculate_month_billing: los dos SELECT de precio pasan a elegir la versión
--    vigente para (p_year, p_month). El resto del cuerpo es idéntico al actual.
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
  v_effective_end DATE;
  v_full_month_days INTEGER := 0;
  v_planned_days INTEGER := 0;
  v_vacation_days INTEGER := 0;
  v_recovery_days INTEGER := 0;
  v_chargeable_days INTEGER;
  v_days_per_month INTEGER;
  v_billed_days INTEGER;
  v_att_rate_net NUMERIC(12,2);
  v_att_rate_gross NUMERIC(12,2);
  v_att_charge_net NUMERIC(12,2) := 0;
  v_att_charge_gross NUMERIC(12,2) := 0;
  v_trans_rate_net NUMERIC(12,2) := 0;
  v_trans_rate_gross NUMERIC(12,2) := 0;
  v_trans_charge_net NUMERIC(12,2) := 0;
  v_trans_charge_gross NUMERIC(12,2) := 0;
  v_has_transport BOOLEAN := FALSE;
  v_day DATE;
  v_day_of_week INTEGER;
  v_day_name TEXT;
  v_proration_factor NUMERIC;
  v_discount NUMERIC := 0;
  v_discount_factor NUMERIC := 1;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'Cliente no encontrado');
  END IF;

  SELECT * INTO v_plan FROM client_plans WHERE client_id = p_client_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Plan no encontrado');
  END IF;

  -- CHANGED: versión de precio vigente para el mes objetivo
  SELECT price_net, price_gross INTO v_plan_price
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule
    AND (effective_year * 12 + effective_month) <= (p_year * 12 + p_month)
  ORDER BY (effective_year * 12 + effective_month) DESC
  LIMIT 1;
  IF v_plan_price IS NULL THEN
    RETURN jsonb_build_object('error', 'Precio de plan no encontrado');
  END IF;
  v_att_rate_net := v_plan_price.price_net;
  v_att_rate_gross := v_plan_price.price_gross;

  IF v_plan.has_transport THEN
    SELECT * INTO v_address FROM client_addresses WHERE client_id = p_client_id;
    IF v_address IS NULL OR v_address.distance_range IS NULL THEN
      RETURN jsonb_build_object('error', 'Cliente con transporte requiere distancia definida');
    END IF;

    -- CHANGED: versión de precio de transporte vigente para el mes objetivo
    SELECT price_net, price_gross INTO v_transport_price
    FROM transport_pricing
    WHERE frequency = v_plan.frequency AND distance_range = v_address.distance_range
      AND (effective_year * 12 + effective_month) <= (p_year * 12 + p_month)
    ORDER BY (effective_year * 12 + effective_month) DESC
    LIMIT 1;
    IF v_transport_price IS NULL THEN
      RETURN jsonb_build_object('error', 'Precio de transporte no encontrado');
    END IF;

    v_trans_rate_net := v_transport_price.price_net;
    v_trans_rate_gross := v_transport_price.price_gross;
    v_has_transport := TRUE;
  END IF;

  SELECT COALESCE(discount_percent, 0) INTO v_discount
  FROM monthly_invoices
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
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday'
      WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
      WHEN 5 THEN 'friday' ELSE NULL
    END;

    IF v_day_name IS NOT NULL AND v_day_name = ANY(v_plan.assigned_days) THEN
      v_full_month_days := v_full_month_days + 1;
      IF v_day >= v_effective_start AND v_day <= v_effective_end THEN
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
    'fullMonthDays', v_full_month_days,
    'plannedDays', v_planned_days,
    'vacationDays', v_vacation_days,
    'recoveryDays', v_recovery_days,
    'daysPerMonth', v_days_per_month,
    'chargeableDays', v_billed_days,
    'rawChargeableDays', v_chargeable_days,
    'isProrated', v_billed_days < v_days_per_month,
    'effectiveEnd', v_effective_end,
    'hasTransport', v_has_transport,
    'discountPercent', v_discount,
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
```

- [ ] **Step 2: Aplicar la migración**

Usar la herramienta MCP `apply_migration` con name `055_versioned_pricing` y el contenido del archivo.
Expected: sin error.

- [ ] **Step 3: Verificar backfill y que el billing no cambió**

Ejecutar (MCP `execute_sql`):
```sql
SELECT count(*) FILTER (WHERE effective_year=2000 AND effective_month=0) AS backfilled,
       count(*) AS total
FROM plan_pricing;
```
Expected: `backfilled == total` (todas las filas viejas quedaron en (2000,0)).

Luego, para un cliente activo cualquiera, comparar un mes:
```sql
SELECT (calculate_month_billing(id, 2026, 6)->>'totalChargeableGross') AS total
FROM clients WHERE deleted_at IS NULL LIMIT 1;
```
Expected: devuelve un número (no `error`), igual al que daría antes del cambio (la versión (2000,0) es la única, así que el precio es el mismo).

- [ ] **Step 4: Verificar versión futura**

```sql
SELECT set_pricing(
  2000, 0,
  '[]'::jsonb,
  '[]'::jsonb
);
```
Expected: `{"success": false, "error": "El mes de vigencia no puede ser anterior al mes actual"}` (valida el guard de mes pasado).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/055_versioned_pricing.sql
git commit -m "feat(pricing): precios versionados por mes + RPC set_pricing

- effective_year/effective_month en plan_pricing y transport_pricing
- calculate_month_billing elige la versión vigente del mes
- set_pricing (solo superadmin) escribe la versión de un mes de vigencia
- RLS de transport_pricing endurecida (read admin, write superadmin)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Servicios de pricing versionados + `setPricing`

**Files:**
- Modify: `src/services/pricing/pricingService.js`
- Modify: `src/services/pricing/transportPricingService.js`
- Modify: `src/services/api.js`
- Create: `src/services/pricing/pricingService.test.js`

**Interfaces:**
- Consumes: RPC `set_pricing` (Task 1).
- Produces:
  - `getPlanPricing()` → `Array<{frequency, schedule, priceNet, priceGross, effectiveYear, effectiveMonth}>` (todas las versiones).
  - `getPlanPriceSync(pricingData, frequency, schedule, year, month)` → `{priceNet, priceGross}` (versión vigente; `year/month` opcionales, default mes actual).
  - `getTransportPricing()` → `Array<{frequency, distanceRange, priceNet, priceGross, effectiveYear, effectiveMonth}>`.
  - `getTransportPriceSync(pricingData, frequency, distanceRange, year, month)` → `{priceNet, priceGross}`.
  - `setPricing(effectiveYear, effectiveMonth, planPrices, transportPrices)` → `{success}`; `planPrices`=`[{frequency, schedule, price_gross}]`, `transportPrices`=`[{frequency, distance_range, price_gross}]`.

- [ ] **Step 1: Escribir el test de resolución de versión (falla primero)**

Create `src/services/pricing/pricingService.test.js`:

```js
import { getPlanPriceSync } from './pricingService'

const data = [
  { frequency: 2, schedule: 'morning', priceNet: 100, priceGross: 122, effectiveYear: 2000, effectiveMonth: 0 },
  { frequency: 2, schedule: 'morning', priceNet: 200, priceGross: 244, effectiveYear: 2026, effectiveMonth: 6 },
  { frequency: 2, schedule: 'afternoon', priceNet: 150, priceGross: 183, effectiveYear: 2000, effectiveMonth: 0 }
]

test('picks the baseline version for a month before any edit', () => {
  expect(getPlanPriceSync(data, 2, 'morning', 2026, 5)).toEqual({ priceNet: 100, priceGross: 122 })
})

test('picks the newer version from its effective month onward', () => {
  expect(getPlanPriceSync(data, 2, 'morning', 2026, 6)).toEqual({ priceNet: 200, priceGross: 244 })
  expect(getPlanPriceSync(data, 2, 'morning', 2026, 11)).toEqual({ priceNet: 200, priceGross: 244 })
})

test('returns zeros when no combo matches', () => {
  expect(getPlanPriceSync(data, 5, 'full_day', 2026, 6)).toEqual({ priceNet: 0, priceGross: 0 })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `CI=true npm test -- --watchAll=false src/services/pricing/pricingService.test.js`
Expected: FALLA (la firma vieja de `getPlanPriceSync` ignora year/month y devuelve la primera coincidencia).

- [ ] **Step 3: Implementar `pricingService.js` versionado**

Reemplazar el contenido de `getPlanPricing` y `getPlanPriceSync` en `src/services/pricing/pricingService.js` (dejar `calculateProration`, `calculateMonthProration`, `DOW`, `MONTH_NAMES_ES` sin cambios). El bloque nuevo:

```js
/**
 * Get all plan pricing rows (todas las versiones por mes de vigencia).
 * @returns {Promise<Array<{frequency, schedule, priceNet, priceGross, effectiveYear, effectiveMonth}>>}
 */
export async function getPlanPricing() {
  const { data, error } = await supabase
    .from('plan_pricing')
    .select('frequency, schedule, price_net, price_gross, effective_year, effective_month')
    .order('frequency', { ascending: true })
    .order('schedule', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(p => ({
    frequency: p.frequency,
    schedule: p.schedule,
    priceNet: Number(p.price_net),
    priceGross: Number(p.price_gross),
    effectiveYear: p.effective_year,
    effectiveMonth: p.effective_month
  }))
}

/**
 * Lookup plan price for a target month: version vigente = mayor (effYear,effMonth) <= (year,month).
 * year/month opcionales → default mes actual.
 * @returns {{priceNet: number, priceGross: number}}
 */
export function getPlanPriceSync(pricingData, frequency, schedule, year, month) {
  const now = new Date()
  const targetYm = (year ?? now.getFullYear()) * 12 + (month ?? now.getMonth())
  const match = pricingData
    .filter(p => p.frequency === frequency && p.schedule === schedule)
    .filter(p => (p.effectiveYear * 12 + p.effectiveMonth) <= targetYm)
    .sort((a, b) => (b.effectiveYear * 12 + b.effectiveMonth) - (a.effectiveYear * 12 + a.effectiveMonth))[0]
  if (!match) return { priceNet: 0, priceGross: 0 }
  return { priceNet: match.priceNet, priceGross: match.priceGross }
}
```

Agregar al final del archivo el servicio de escritura:

```js
/**
 * Persist a new price version effective from (effectiveYear, effectiveMonth). Superadmin only.
 * @param {number} effectiveYear
 * @param {number} effectiveMonth - 0-indexed
 * @param {Array<{frequency, schedule, price_gross}>} planPrices
 * @param {Array<{frequency, distance_range, price_gross}>} transportPrices
 */
export async function setPricing(effectiveYear, effectiveMonth, planPrices, transportPrices) {
  const { data, error } = await supabase.rpc('set_pricing', {
    p_effective_year: effectiveYear,
    p_effective_month: effectiveMonth,
    p_plan_prices: planPrices,
    p_transport_prices: transportPrices
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'No se pudieron guardar los precios')
  return data
}
```

- [ ] **Step 4: Implementar `transportPricingService.js` versionado**

Reemplazar el contenido de `src/services/pricing/transportPricingService.js`:

```js
import { supabase } from '../supabase/client'

/**
 * Get all transport pricing rows (todas las versiones por mes de vigencia).
 * @returns {Promise<Array<{frequency, distanceRange, priceNet, priceGross, effectiveYear, effectiveMonth}>>}
 */
export async function getTransportPricing() {
  const { data, error } = await supabase
    .from('transport_pricing')
    .select('frequency, distance_range, price_net, price_gross, effective_year, effective_month')
    .order('frequency', { ascending: true })
    .order('distance_range', { ascending: true })

  if (error) throw new Error(error.message)

  return data.map(p => ({
    frequency: p.frequency,
    distanceRange: p.distance_range,
    priceNet: Number(p.price_net),
    priceGross: Number(p.price_gross),
    effectiveYear: p.effective_year,
    effectiveMonth: p.effective_month
  }))
}

/**
 * Lookup transport price for a target month (version vigente). year/month opcionales.
 * @returns {{priceNet: number, priceGross: number}}
 */
export function getTransportPriceSync(pricingData, frequency, distanceRange, year, month) {
  const now = new Date()
  const targetYm = (year ?? now.getFullYear()) * 12 + (month ?? now.getMonth())
  const match = pricingData
    .filter(p => p.frequency === frequency && p.distanceRange === distanceRange)
    .filter(p => (p.effectiveYear * 12 + p.effectiveMonth) <= targetYm)
    .sort((a, b) => (b.effectiveYear * 12 + b.effectiveMonth) - (a.effectiveYear * 12 + a.effectiveMonth))[0]
  if (!match) return { priceNet: 0, priceGross: 0 }
  return { priceNet: match.priceNet, priceGross: match.priceGross }
}
```

- [ ] **Step 5: Re-exportar `setPricing` desde `api.js`**

En `src/services/api.js` (línea ~111), reemplazar:
```js
export { getPlanPricing, getPlanPriceSync, calculateProration } from './pricing/pricingService'
```
por:
```js
export { getPlanPricing, getPlanPriceSync, calculateProration, setPricing } from './pricing/pricingService'
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `CI=true npm test -- --watchAll=false src/services/pricing/pricingService.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/services/pricing/pricingService.js src/services/pricing/transportPricingService.js src/services/api.js src/services/pricing/pricingService.test.js
git commit -m "feat(pricing): servicios de precios versionados + setPricing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Call-sites de preview pasan mes + `ClientDetail` protege meses finalizados

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx` (~897-913)
- Modify: `src/pages/Clients/AddClient.jsx` (~480-491)
- Modify: `src/pages/Clients/PlanCalculatorModal.jsx` (~101-104)

**Interfaces:**
- Consumes: `getPlanPriceSync(data, freq, schedule, year, month)`, `getTransportPriceSync(data, freq, distance, year, month)` (Task 2).

- [ ] **Step 1: `ClientDetail.jsx` — pasar year/month a los lookups**

En `MonthCard` (la función recibe `year, month`), reemplazar:
```js
  const planPrice = getPlanPriceSync(pricingData, plan.frequency, plan.schedule)
  const transportPrice = plan.hasTransport && plan.distanceRange
    ? getTransportPriceSync(transportPricingData, plan.frequency, plan.distanceRange)
    : { priceNet: 0, priceGross: 0 }
```
por:
```js
  const planPrice = getPlanPriceSync(pricingData, plan.frequency, plan.schedule, year, month)
  const transportPrice = plan.hasTransport && plan.distanceRange
    ? getTransportPriceSync(transportPricingData, plan.frequency, plan.distanceRange, year, month)
    : { priceNet: 0, priceGross: 0 }
```

- [ ] **Step 2: `ClientDetail.jsx` — meses facturados también usan snapshot**

Reemplazar:
```js
  // If paid: use snapshot from invoice; otherwise live calculation
  const displayAmount = isPaid ? (invoice.paidAmount ?? invoice.chargeableAmount) : liveChargeableAmount
```
por:
```js
  // Finalizado (cobrado o facturado): usar el snapshot del invoice, nunca live.
  // Así un cambio de precio del mes corriente no altera meses ya cobrados/facturados.
  const isFinalized = isPaid || isInvoiced
  const displayAmount = isFinalized
    ? (invoice.paidAmount ?? invoice.chargeableAmount)
    : liveChargeableAmount
```
(`isInvoiced` ya está definido arriba en `MonthCard`, línea ~864.)

- [ ] **Step 3: `AddClient.jsx` — pasar mes al preview**

El preview muestra la mensualidad estimada; usar el mes de inicio si existe, si no el mes actual. Reemplazar el bloque `~480-491`:
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
```
por:
```js
  const previewDate = formData.startDate ? new Date(`${formData.startDate}T00:00:00`) : new Date()
  const previewYear = isNaN(previewDate.getTime()) ? new Date().getFullYear() : previewDate.getFullYear()
  const previewMonth = isNaN(previewDate.getTime()) ? new Date().getMonth() : previewDate.getMonth()
  const planPrice = getPlanPriceSync(
    pricingData,
    parseInt(formData.frequency),
    formData.schedule,
    previewYear,
    previewMonth
  )
  const transportPrice = formData.hasTransport && formData.distanceRange
    ? getTransportPriceSync(
        transportPricingData,
        parseInt(formData.frequency),
        formData.distanceRange,
        previewYear,
        previewMonth
      )
    : { priceNet: 0, priceGross: 0 }
```

- [ ] **Step 4: `PlanCalculatorModal.jsx` — pasar el mes visible**

Reemplazar el bloque `~101-104`:
```js
  const planPrice = getPlanPriceSync(pricingData, frequency, schedule)
  const transportPrice = hasTransport && distanceRange
    ? getTransportPriceSync(transportPricingData, frequency, distanceRange)
    : { priceNet: 0, priceGross: 0 }
```
por:
```js
  const planPrice = getPlanPriceSync(pricingData, frequency, schedule, viewYear, viewMonth)
  const transportPrice = hasTransport && distanceRange
    ? getTransportPriceSync(transportPricingData, frequency, distanceRange, viewYear, viewMonth)
    : { priceNet: 0, priceGross: 0 }
```
(`viewYear`/`viewMonth` ya existen en el componente, ver ~95-98.)

- [ ] **Step 5: Verificar compilación**

Run: `CI=true npm test -- --watchAll=false src/services/pricing/pricingService.test.js`
Expected: PASS (regresión rápida — asegura que no se rompió el import).
Además, verificar que la app compila (Task 6 hará el chequeo visual completo).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx src/pages/Clients/AddClient.jsx src/pages/Clients/PlanCalculatorModal.jsx
git commit -m "feat(pricing): previews usan precio vigente del mes; meses facturados usan snapshot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Nav + ruta + página Gerencia con pestañas

**Files:**
- Modify: `src/components/Layout/Navbar.jsx:30`
- Modify: `src/App.js` (import + ruta `accesos`→`gerencia`)
- Create: `src/pages/Management/Gerencia.jsx`

**Interfaces:**
- Consumes: `AccessList` (default export existente), `PlanPricingManager` (Task 5, default export — se crea después; en esta tarea se importa y puede quedar como placeholder mínimo que se completa en Task 5).
- Produces: ruta `/gerencia` gateada por `RequireRole feature="users"`.

- [ ] **Step 1: Crear un stub de `PlanPricingManager` para que Gerencia compile**

Create `src/pages/Management/PlanPricingManager.jsx` (stub — se completa en Task 5):

```jsx
export default function PlanPricingManager() {
  return <div className="text-sm text-gray-500">Gestión de planes</div>
}
```

- [ ] **Step 2: Crear la página Gerencia con pestañas**

Create `src/pages/Management/Gerencia.jsx`:

```jsx
import { useState } from 'react'
import Tabs from '../../components/ui/Tabs'
import AccessList from '../Access/AccessList'
import PlanPricingManager from './PlanPricingManager'

const TABS = [
  { id: 'accesos', label: 'Accesos' },
  { id: 'planes', label: 'Gestión de planes' }
]

export default function Gerencia() {
  const [activeTab, setActiveTab] = useState('accesos')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Gerencia</h1>
        <p className="text-sm text-gray-500 mt-1">Usuarios del sistema y precios de planes</p>
      </div>

      <div className="mb-6">
        <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === 'accesos' ? <AccessList /> : <PlanPricingManager />}
    </div>
  )
}
```

- [ ] **Step 3: `Navbar.jsx` — renombrar ítem (mismo icono)**

En `src/components/Layout/Navbar.jsx:30`, reemplazar:
```js
    { to: '/accesos', label: 'Accesos', icon: Settings, access: 'users' }
```
por:
```js
    { to: '/gerencia', label: 'Gerencia', icon: Settings, access: 'users' }
```

- [ ] **Step 4: `App.js` — ruta gerencia**

Reemplazar el import:
```js
import AccessList from './pages/Access/AccessList'
```
por:
```js
import Gerencia from './pages/Management/Gerencia'
```
y la ruta protegida:
```js
            <Route element={<RequireRole feature="users" />}>
              <Route path="accesos" element={<AccessList />} />
```
por:
```js
            <Route element={<RequireRole feature="users" />}>
              <Route path="gerencia" element={<Gerencia />} />
```
(Dejar el resto del bloque `RequireRole` intacto.)

- [ ] **Step 5: Verificación visual**

Usar la skill `run` o `npm start`. Loguearse como superadmin → el nav muestra "Gerencia" con el icono de engranaje → abre `/gerencia` → se ven dos pestañas; "Accesos" muestra la lista de usuarios; "Gestión de planes" muestra el stub.
Verificar que un usuario admin/operador NO ve el ítem "Gerencia".

- [ ] **Step 6: Commit**

```bash
git add src/pages/Management/Gerencia.jsx src/pages/Management/PlanPricingManager.jsx src/components/Layout/Navbar.jsx src/App.js
git commit -m "feat(gerencia): renombra Accesos a Gerencia con pestañas (Accesos + Gestión de planes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `PlanPricingManager` — tabla + edición + mes de vigencia

**Files:**
- Modify: `src/pages/Management/PlanPricingManager.jsx` (reemplaza el stub)

**Interfaces:**
- Consumes: `getPlanPricing`, `getPlanPriceSync`, `setPricing` (pricingService); `getTransportPricing`, `getTransportPriceSync` (transportPricingService); `DISTANCE_RANGES` (transportConstants); `formatCurrency` (format).

- [ ] **Step 1: Implementar el componente completo**

Constantes de UI (dentro del archivo): frecuencias `[1,2,3,4,5]`, horarios `[{id:'morning',label:'Mañana'},{id:'afternoon',label:'Tarde'},{id:'full_day',label:'Día completo'}]`, rangos = `DISTANCE_RANGES`.

Reemplazar el contenido de `src/pages/Management/PlanPricingManager.jsx`:

```jsx
import { useState, useEffect, useMemo } from 'react'
import { Edit } from 'iconoir-react'
import {
  getPlanPricing, getPlanPriceSync, setPricing,
  getTransportPricing, getTransportPriceSync
} from '../../services/api'
import { DISTANCE_RANGES } from '../../services/transport/transportConstants'
import { formatCurrency } from '../../utils/format'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Select } from '../../components/ui/Input'

const FREQUENCIES = [1, 2, 3, 4, 5]
const SCHEDULES = [
  { id: 'morning', label: 'Mañana' },
  { id: 'afternoon', label: 'Tarde' },
  { id: 'full_day', label: 'Día completo' }
]

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Opciones de vigencia: mes actual + próximos 12 meses.
function buildEffectiveOptions() {
  const now = new Date()
  const opts = []
  for (let i = 0; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    opts.push({ value: `${y}-${m}`, label: `${MONTH_NAMES[m]} ${y}`, year: y, month: m })
  }
  return opts
}

const netOf = (gross) => Math.round((Number(gross) || 0) / 1.22)

export default function PlanPricingManager() {
  const [planData, setPlanData] = useState([])
  const [transportData, setTransportData] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const effectiveOptions = useMemo(buildEffectiveOptions, [])
  const [effectiveKey, setEffectiveKey] = useState(effectiveOptions[0].value)
  // Draft de precios en edición: gross por celda. { plan: {"freq|schedule": gross}, transport: {"freq|range": gross} }
  const [draft, setDraft] = useState({ plan: {}, transport: {} })

  const now = new Date()
  const viewYear = now.getFullYear()
  const viewMonth = now.getMonth()

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [plan, transport] = await Promise.all([getPlanPricing(), getTransportPricing()])
      setPlanData(plan)
      setTransportData(transport)
    } catch (e) {
      setError(e.message || 'Error cargando precios')
    } finally {
      setLoading(false)
    }
  }

  // Precio vigente del mes actual para cada celda (lo que se muestra por defecto).
  const planGross = (freq, schedule) => getPlanPriceSync(planData, freq, schedule, viewYear, viewMonth).priceGross
  const transportGross = (freq, range) => getTransportPriceSync(transportData, freq, range, viewYear, viewMonth).priceGross

  const startEdit = () => {
    const plan = {}
    const transport = {}
    FREQUENCIES.forEach(f => {
      SCHEDULES.forEach(s => { plan[`${f}|${s.id}`] = String(planGross(f, s.id)) })
      DISTANCE_RANGES.forEach(r => { transport[`${f}|${r.id}`] = String(transportGross(f, r.id)) })
    })
    setDraft({ plan, transport })
    setError('')
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setError('') }

  const setPlanCell = (freq, schedule, value) =>
    setDraft(d => ({ ...d, plan: { ...d.plan, [`${freq}|${schedule}`]: value } }))
  const setTransportCell = (freq, range, value) =>
    setDraft(d => ({ ...d, transport: { ...d.transport, [`${freq}|${range}`]: value } }))

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const opt = effectiveOptions.find(o => o.value === effectiveKey)
      const planPrices = []
      const transportPrices = []
      FREQUENCIES.forEach(f => {
        SCHEDULES.forEach(s => {
          planPrices.push({ frequency: f, schedule: s.id, price_gross: Number(draft.plan[`${f}|${s.id}`]) || 0 })
        })
        DISTANCE_RANGES.forEach(r => {
          transportPrices.push({ frequency: f, distance_range: r.id, price_gross: Number(draft.transport[`${f}|${r.id}`]) || 0 })
        })
      })
      await setPricing(opt.year, opt.month, planPrices, transportPrices)
      await load()
      setEditing(false)
    } catch (e) {
      setError(e.message || 'No se pudieron guardar los precios')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Precios de planes y transporte</h2>
          <p className="text-sm text-gray-500 mt-1">
            {editing
              ? 'Ingresá los precios con IVA. El neto se calcula automáticamente (÷1,22).'
              : `Vigentes en ${MONTH_NAMES[viewMonth]} ${viewYear}.`}
          </p>
        </div>
        {editing ? (
          <div className="flex items-end gap-3">
            <Select
              label="Rige desde"
              value={effectiveKey}
              onChange={(e) => setEffectiveKey(e.target.value)}
              options={effectiveOptions.map(o => ({ value: o.value, label: o.label }))}
            />
            <Button variant="secondary" onClick={cancelEdit} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving}>Guardar</Button>
          </div>
        ) : (
          <Button onClick={startEdit}>
            <Edit className="w-5 h-5" />
            Editar
          </Button>
        )}
      </div>

      {editing && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          El precio nuevo rige desde el mes elegido en adelante. Los meses ya cobrados o facturados no cambian.
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Tabla de planes */}
      <Card className="p-4 mb-6 overflow-x-auto">
        <h3 className="font-medium text-gray-900 mb-3">Planes de asistencia</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4 font-medium">Frecuencia</th>
              {SCHEDULES.map(s => <th key={s.id} className="py-2 px-4 font-medium">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {FREQUENCIES.map(f => (
              <tr key={f} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-700">{f}× / semana</td>
                {SCHEDULES.map(s => (
                  <td key={s.id} className="py-2 px-4">
                    <PriceCell
                      editing={editing}
                      value={editing ? draft.plan[`${f}|${s.id}`] : planGross(f, s.id)}
                      onChange={(v) => setPlanCell(f, s.id, v)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Tabla de transporte */}
      <Card className="p-4 overflow-x-auto">
        <h3 className="font-medium text-gray-900 mb-3">Transporte</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4 font-medium">Frecuencia</th>
              {DISTANCE_RANGES.map(r => <th key={r.id} className="py-2 px-4 font-medium">{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {FREQUENCIES.map(f => (
              <tr key={f} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-700">{f}× / semana</td>
                {DISTANCE_RANGES.map(r => (
                  <td key={r.id} className="py-2 px-4">
                    <PriceCell
                      editing={editing}
                      value={editing ? draft.transport[`${f}|${r.id}`] : transportGross(f, r.id)}
                      onChange={(v) => setTransportCell(f, r.id, v)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// Celda: en lectura muestra gross (grande) + neto (chico, gris); en edición input de gross.
function PriceCell({ editing, value, onChange }) {
  if (editing) {
    return (
      <div>
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="text-xs text-gray-400 mt-1">neto {formatCurrency(netOf(value))}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="text-gray-900">{formatCurrency(value)}</div>
      <div className="text-xs text-gray-400">neto {formatCurrency(netOf(value))}</div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar que `formatCurrency` y `Select` existen con esa firma**

Run:
```bash
grep -n "export function formatCurrency\|export const formatCurrency" src/utils/format.js
grep -n "export function Select\|export const Select\|export { .*Select" src/components/ui/Input.jsx
```
Expected: `formatCurrency` exportada en `src/utils/format.js`; `Select` exportado en `Input.jsx` (named). Si `Select` no acepta `options`/`label`/`value`/`onChange`, ajustar el uso al API real (revisar el componente) — patrón ya usado en `AccessList.jsx`.

- [ ] **Step 3: Verificación visual completa**

`npm start`, login superadmin, `/gerencia` → pestaña "Gestión de planes":
- Se ven ambas tablas con precio con IVA (grande) y neto (chico).
- "Editar" → celdas se vuelven inputs, aparece "Rige desde" (mes actual por defecto), aviso ámbar, botones Guardar/Cancelar.
- Cambiar un precio del plan, dejar "Rige desde" = mes actual, Guardar → recarga y muestra el nuevo precio.
- Verificar el efecto en billing (ver Task 6, verificación de negocio).

- [ ] **Step 4: Compilar Tailwind (si se agregaron clases nuevas)**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`

- [ ] **Step 5: Commit**

```bash
git add src/pages/Management/PlanPricingManager.jsx src/tailwind.output.css
git commit -m "feat(gerencia): tabla de precios editable con mes de vigencia

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verificación de negocio end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Baseline — editar precio del mes corriente**

En la UI (superadmin): en Gestión de planes, editar un precio de plan (ej. subir 2× mañana), "Rige desde" = mes actual, Guardar.

- [ ] **Step 2: Cliente pendiente del mes corriente refleja el precio nuevo**

Abrir un cliente con ese plan (2× mañana), sin transporte, cuyo mes actual esté **pendiente** (no pago ni facturado). El monto del mes corriente debe reflejar el precio nuevo (live).

- [ ] **Step 3: Cliente cobrado/facturado del mes corriente NO cambia**

Abrir un cliente con el mismo plan cuyo mes actual esté **pago** o **facturado**. El monto NO debe cambiar (usa snapshot).

Verificación en DB del snapshot vs. live:
```sql
-- Debe seguir mostrando el importe snapshot, no el recalculado
SELECT year, month, payment_status, invoice_status, chargeable_amount, paid_amount
FROM monthly_invoices
WHERE client_id = '<id_cliente_pago>' AND year = <año_actual> AND month = <mes_actual_0idx>;
```

- [ ] **Step 4: Vigencia futura no afecta meses previos**

Editar de nuevo con "Rige desde" = mes actual + 2. Verificar en DB para un cliente:
```sql
SELECT
  (calculate_month_billing('<id>', <year>, <mes_actual_0idx>)->>'attendanceMonthlyRateGross')      AS mes_actual,
  (calculate_month_billing('<id>', <year>, <mes_actual_0idx + 2>)->>'attendanceMonthlyRateGross')  AS mes_mas_2;
```
Expected: `mes_actual` = precio de la vigencia del paso 1; `mes_mas_2` = precio de la nueva vigencia futura. Los meses intermedios mantienen la vigencia del paso 1.

- [ ] **Step 5: Re-guardar el mismo mes no duplica filas**

```sql
SELECT frequency, schedule, count(*)
FROM plan_pricing
GROUP BY frequency, schedule, effective_year, effective_month
HAVING count(*) > 1;
```
Expected: 0 filas (el UNIQUE + ON CONFLICT evita duplicados).

- [ ] **Step 6: Permisos**

Loguear como admin y operador: no ven el ítem "Gerencia". (Opcional) Un `set_pricing` invocado sin ser superadmin devuelve `{success:false, error:'No autorizado'}`.

- [ ] **Step 7: Suite completa**

Run: `CI=true npm test -- --watchAll=false`
Expected: PASS (sin regresiones).

---

## Self-Review (cobertura del spec)

- **Nav Accesos→Gerencia (mismo icono):** Task 4 (Navbar).
- **Dos pestañas Accesos + Gestión de planes:** Task 4 (Gerencia.jsx).
- **Tabla precios plan + transporte, con/sin IVA:** Task 5 (PriceCell muestra gross + neto).
- **Botón Editar + mes de vigencia (default actual, solo actual/futuro):** Task 5 (buildEffectiveOptions, Select "Rige desde") + guard en RPC (Task 1).
- **Cambio inmediato, no programado:** Task 1 (set_pricing escribe versión al instante).
- **Versionado por mes:** Task 1 (columnas + calculate_month_billing) + Task 2 (getPlanPriceSync/getTransportPriceSync).
- **Mes corriente ya cobrado/facturado no se actualiza:** Task 3 (isFinalized usa snapshot) + Task 6 (verificación).
- **Solo superadmin:** Task 4 (RequireRole users) + Task 1 (RLS + guard en set_pricing).
- **IVA 22%, neto derivado:** Task 1 (RPC) + Task 5 (netOf en preview).
```
