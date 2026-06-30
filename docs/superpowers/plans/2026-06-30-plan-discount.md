# Promociones / Descuento sobre el plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar un descuento porcentual sobre el plan de asistencia (no transporte) a un rango consecutivo de meses no cobrados ni facturados de un cliente, reversible, reflejado en cálculo, cobro y facturación.

**Architecture:** El descuento vive por mes en `monthly_invoices.discount_percent`. El RPC `calculate_month_billing` lo aplica sobre la asistencia cobrable; los snapshots existentes (cobro/factura) lo heredan. Un RPC `apply_plan_discount` valida el rango y escribe el porcentaje. La validación de rango (consecutividad/elegibilidad) se extrae a un helper JS puro testeable. UI: acción en el menú del detalle del cliente + modal + badge por mes.

**Tech Stack:** PostgreSQL (Supabase migrations + RPC plpgsql), React 19, jest (CRA via craco), Tailwind.

**Convenciones del repo:** Variables/código en inglés, textos UI en español, sin `;` en JS/JSX. Tests con `CI=true npx craco test -- --watchAll=false <ruta>`. Migración aplicada vía MCP Supabase (`apply_migration`) y verificada con `execute_sql`. `month` siempre 0-indexed.

---

## File Structure

- **Create** `supabase/migrations/029_plan_discount.sql` — columna `discount_percent`, update de `calculate_month_billing`, RPC `apply_plan_discount`, update de `invoices_view`.
- **Create** `src/services/invoices/discountRange.js` — helper puro: meses elegibles + validación de rango.
- **Create** `src/services/invoices/discountRange.test.js` — tests del helper.
- **Modify** `src/services/invoices/invoiceService.js` — `applyPlanDiscount`, `removePlanDiscount`, map de `discountPercent`.
- **Modify** `src/services/api.js` — re-export.
- **Create** `src/pages/Clients/ApplyDiscountModal.jsx` — modal de aplicación.
- **Modify** `src/pages/Clients/ClientDetail.jsx` — entrada en menú + estado del modal + badge `−X%` con "quitar" en `MonthCard`.
- **Modify** `src/pages/Clients/EmitInvoiceModal.jsx` — sufijo `(X% dto)` en concepto.

---

## Task 1: Helper puro de validación de rango (`discountRange.js`)

**Files:**
- Create: `src/services/invoices/discountRange.js`
- Test: `src/services/invoices/discountRange.test.js`

Un mes se representa como ordinal `year * 12 + month` (month 0-indexed) para comparar y detectar consecutividad. Un invoice es "elegible" si `paymentStatus === 'pending'` && `invoiceStatus === 'pending'`.

- [ ] **Step 1: Write the failing test**

```javascript
import { ordinalOf, eligibleMonths, validateDiscountRange } from './discountRange'

const inv = (year, month, opts = {}) => ({
  year, month,
  paymentStatus: opts.paid ? 'paid' : 'pending',
  invoiceStatus: opts.invoiced ? 'invoiced' : 'pending'
})

describe('ordinalOf', () => {
  test('combines year and 0-indexed month', () => {
    expect(ordinalOf(2026, 0)).toBe(2026 * 12)
    expect(ordinalOf(2026, 11)).toBe(2026 * 12 + 11)
  })
})

describe('eligibleMonths', () => {
  test('keeps only pending/pending, sorted by ordinal', () => {
    const invoices = [
      inv(2026, 5),
      inv(2026, 3, { paid: true }),
      inv(2026, 4, { invoiced: true }),
      inv(2026, 2)
    ]
    expect(eligibleMonths(invoices).map(m => m.month)).toEqual([2, 5])
  })
})

describe('validateDiscountRange', () => {
  const invoices = [inv(2026, 2), inv(2026, 3), inv(2026, 4), inv(2026, 6)]

  test('valid consecutive eligible range of 2+ months', () => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 4, percent: 20 })
    expect(r.valid).toBe(true)
    expect(r.months.map(m => m.month)).toEqual([2, 3, 4])
  })

  test('rejects single-month range', () => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 2, percent: 20 })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/2 meses/i)
  })

  test('rejects end before start', () => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 2, percent: 20 })
    expect(r.valid).toBe(false)
  })

  test('rejects range with a gap (missing month row)', () => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 6, percent: 20 })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/consecut|no disponible|elegible/i)
  })

  test('rejects range containing a paid/invoiced month', () => {
    const withPaid = [inv(2026, 2), inv(2026, 3, { paid: true }), inv(2026, 4)]
    const r = validateDiscountRange(withPaid, { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 4, percent: 20 })
    expect(r.valid).toBe(false)
  })

  test.each([0, -5, 101, NaN])('rejects invalid percent %p', pct => {
    const r = validateDiscountRange(invoices, { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 4, percent: pct })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/porcentaje/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx craco test -- --watchAll=false src/services/invoices/discountRange.test.js`
Expected: FAIL (`Cannot find module './discountRange'`).

- [ ] **Step 3: Write minimal implementation**

```javascript
// Pure helpers for plan-discount month-range selection/validation.
// A month is identified by its ordinal: year * 12 + month (month is 0-indexed).

export function ordinalOf(year, month) {
  return year * 12 + month
}

// Invoice is eligible for a discount only while it is neither paid nor invoiced.
export function isEligible(invoice) {
  return invoice?.paymentStatus === 'pending' && invoice?.invoiceStatus === 'pending'
}

export function eligibleMonths(invoices) {
  return (invoices || [])
    .filter(isEligible)
    .slice()
    .sort((a, b) => ordinalOf(a.year, a.month) - ordinalOf(b.year, b.month))
}

// Validate a discount application range.
// percent === 0 is the "remove" case and skips the 2-month-minimum rule.
export function validateDiscountRange(invoices, { startYear, startMonth, endYear, endMonth, percent }) {
  const pct = Number(percent)
  const isRemoval = pct === 0
  if (!isRemoval && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) {
    return { valid: false, error: 'El porcentaje debe estar entre 1 y 100' }
  }

  const startOrd = ordinalOf(startYear, startMonth)
  const endOrd = ordinalOf(endYear, endMonth)
  if (endOrd < startOrd) {
    return { valid: false, error: 'El mes de fin debe ser posterior o igual al de inicio' }
  }
  if (!isRemoval && endOrd === startOrd) {
    return { valid: false, error: 'Seleccioná un rango de al menos 2 meses' }
  }

  const byOrdinal = new Map((invoices || []).map(inv => [ordinalOf(inv.year, inv.month), inv]))
  const months = []
  for (let ord = startOrd; ord <= endOrd; ord++) {
    const inv = byOrdinal.get(ord)
    if (!inv || !isEligible(inv)) {
      return { valid: false, error: 'El rango debe ser consecutivo y todos los meses deben estar sin cobrar ni facturar' }
    }
    months.push(inv)
  }

  return { valid: true, months }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx craco test -- --watchAll=false src/services/invoices/discountRange.test.js`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/services/invoices/discountRange.js src/services/invoices/discountRange.test.js
git commit -m "feat(promociones): helper puro de validación de rango de descuento

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migración SQL (columna + cálculo + RPC + vista)

**Files:**
- Create: `supabase/migrations/029_plan_discount.sql`

Esta migración se redacta como archivo y se aplica vía MCP Supabase (`apply_migration` con `name: "plan_discount"`). Se verifica con `execute_sql`. La definición vigente de `calculate_month_billing` está en `015_pricing_redesign.sql:211-350`; se copia íntegra y se le agregan las 3 piezas de descuento. La vista `invoices_view` vigente está en `022_biller_integration.sql`.

- [ ] **Step 1: Escribir el archivo de migración**

```sql
-- ============================================
-- 029 — Plan discount (promociones)
-- ============================================
-- 1. discount_percent por mes en monthly_invoices
-- 2. calculate_month_billing aplica el descuento SOLO a la asistencia
-- 3. apply_plan_discount: valida rango y escribe el %
-- 4. invoices_view expone discountPercent
-- ============================================

ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
  CHECK (discount_percent >= 0 AND discount_percent <= 100);

-- ── calculate_month_billing v3 (asistencia con descuento) ──
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

  SELECT price_net, price_gross INTO v_plan_price
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule;
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

  -- Descuento del mes (solo asistencia)
  SELECT COALESCE(discount_percent, 0) INTO v_discount
  FROM monthly_invoices
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;
  v_discount := COALESCE(v_discount, 0);
  v_discount_factor := 1 - (v_discount / 100.0);

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
    'chargeableDays', v_chargeable_days,
    'isProrated', v_effective_start > v_month_start,
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

-- ── apply_plan_discount: valida rango y escribe el % ──
CREATE OR REPLACE FUNCTION apply_plan_discount(
  p_client_id UUID,
  p_start_year INTEGER,
  p_start_month INTEGER,
  p_end_year INTEGER,
  p_end_month INTEGER,
  p_percent NUMERIC
)
RETURNS JSONB AS $$
DECLARE
  v_start_ord INTEGER;
  v_end_ord INTEGER;
  v_is_removal BOOLEAN;
  v_range_count INTEGER;
  v_eligible_count INTEGER;
  v_updated INTEGER;
BEGIN
  IF p_percent < 0 OR p_percent > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El porcentaje debe estar entre 0 y 100');
  END IF;
  v_is_removal := (p_percent = 0);

  v_start_ord := p_start_year * 12 + p_start_month;
  v_end_ord := p_end_year * 12 + p_end_month;

  IF v_end_ord < v_start_ord THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rango inválido');
  END IF;
  IF NOT v_is_removal AND v_end_ord = v_start_ord THEN
    RETURN jsonb_build_object('success', false, 'error', 'El rango debe tener al menos 2 meses');
  END IF;

  v_range_count := v_end_ord - v_start_ord + 1;

  -- Cuántos meses del rango existen y están sin cobrar ni facturar
  SELECT COUNT(*) INTO v_eligible_count
  FROM monthly_invoices
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord
    AND payment_status = 'pending'
    AND invoice_status = 'pending';

  IF v_eligible_count <> v_range_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'El rango debe ser consecutivo y todos los meses deben estar sin cobrar ni facturar');
  END IF;

  UPDATE monthly_invoices
  SET discount_percent = p_percent,
      updated_at = now()
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'monthsUpdated', v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── invoices_view: exponer discountPercent ──
-- Se re-crea la vista agregando la columna. La definición base está en
-- 022_biller_integration.sql; este bloque solo añade discountPercent al SELECT.
-- (Al implementar: copiar el CREATE VIEW vigente y agregar la línea de discount_percent.)
```

> **Nota de implementación:** El bloque final de `invoices_view` requiere copiar la definición vigente de la vista desde `022_biller_integration.sql` (líneas ~240-259) y añadir `mi.discount_percent AS "discountPercent"`. Hacerlo en el Step 2 leyendo el archivo real antes de aplicar.

- [ ] **Step 2: Completar `invoices_view` en el archivo**

Leer `supabase/migrations/022_biller_integration.sql` para copiar el `CREATE ... VIEW invoices_view` vigente, reemplazar el placeholder del Step 1 con un `CREATE OR REPLACE VIEW invoices_view ... security_invoker = on` idéntico al actual **más** la columna `mi.discount_percent AS "discountPercent"`.

- [ ] **Step 3: Aplicar la migración (MCP Supabase)**

Usar la tool `mcp__supabase__apply_migration` con `name: "plan_discount"` y el contenido completo del archivo `029_plan_discount.sql`.
Expected: sin error.

- [ ] **Step 4: Verificar columna y RPC con `execute_sql`**

Ejecutar:
```sql
-- columna existe con default 0
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'monthly_invoices' AND column_name = 'discount_percent';

-- discountPercent presente en la vista
SELECT "discountPercent" FROM invoices_view LIMIT 1;
```
Expected: la columna aparece (`numeric`, default `0`); la vista responde sin error.

- [ ] **Step 5: Verificar comportamiento del cálculo con un cliente real**

Elegir un cliente con invoices pending (`SELECT client_id, year, month FROM monthly_invoices WHERE payment_status='pending' AND invoice_status='pending' LIMIT 1`). Llamar:
```sql
SELECT calculate_month_billing('<client_id>', <year>, <month>);
```
Anotar `attendanceChargeableGross` y `transportChargeableGross` SIN descuento. Luego aplicar 20%:
```sql
SELECT apply_plan_discount('<client_id>', <year>, <month>, <year>, <month+1>, 20);
SELECT calculate_month_billing('<client_id>', <year>, <month>);
```
Expected: `success: true`; el nuevo `attendanceChargeableGross` ≈ anterior × 0.8 (±1 por redondeo); `transportChargeableGross` **sin cambios**; `discountPercent` = 20. Revertir:
```sql
SELECT apply_plan_discount('<client_id>', <year>, <month>, <year>, <month+1>, 0);
```
Expected: `discountPercent` vuelve a 0 y asistencia vuelve al valor original.

- [ ] **Step 6: Verificar rechazo de rango inválido**

```sql
-- mes único debe fallar
SELECT apply_plan_discount('<client_id>', <year>, <month>, <year>, <month>, 20);
```
Expected: `{ success: false, error: 'El rango debe tener al menos 2 meses' }`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/029_plan_discount.sql
git commit -m "feat(promociones): migración descuento de plan (columna, cálculo, RPC, vista)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Capa de servicio (`invoiceService.js` + `api.js`)

**Files:**
- Modify: `src/services/invoices/invoiceService.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Map de `discountPercent` en lecturas**

En `getClientInvoices` (objeto mapeado, después de `chargeableDays`), agregar:
```javascript
    discountPercent: Number(inv.discountPercent) || 0,
```
En `calculateMonthBilling` (objeto de retorno, junto a `chargeableDays`/`hasTransport`), agregar:
```javascript
    discountPercent: Number(data.discountPercent) || 0,
```

- [ ] **Step 2: Agregar funciones de aplicación/remoción**

Al final de `invoiceService.js`:
```javascript
/**
 * Apply a plan discount to a consecutive range of uninvoiced/unpaid months.
 * percent === 0 removes the discount.
 * @param {string} clientId
 * @param {number} startYear
 * @param {number} startMonth - 0-indexed
 * @param {number} endYear
 * @param {number} endMonth - 0-indexed
 * @param {number} percent - 0..100
 */
export async function applyPlanDiscount(clientId, startYear, startMonth, endYear, endMonth, percent) {
  const { data, error } = await supabase.rpc('apply_plan_discount', {
    p_client_id: clientId,
    p_start_year: startYear,
    p_start_month: startMonth,
    p_end_year: endYear,
    p_end_month: endMonth,
    p_percent: percent
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al aplicar el descuento')
  return data
}

/**
 * Remove a plan discount from a range (sets percent to 0).
 */
export async function removePlanDiscount(clientId, startYear, startMonth, endYear, endMonth) {
  return applyPlanDiscount(clientId, startYear, startMonth, endYear, endMonth, 0)
}
```

- [ ] **Step 3: Re-export en `api.js`**

Localizar el bloque que re-exporta de `./invoices/invoiceService` y agregar `applyPlanDiscount` y `removePlanDiscount` a la lista (mismo estilo que los exports existentes como `markMonthPaid`).

- [ ] **Step 4: Verificar build/compilación**

Run: `CI=true npx craco test -- --watchAll=false src/services/invoices/discountRange.test.js`
Expected: PASS (sanity de que el árbol de imports no rompió; no hay test nuevo aquí).

- [ ] **Step 5: Commit**

```bash
git add src/services/invoices/invoiceService.js src/services/api.js
git commit -m "feat(promociones): servicios applyPlanDiscount/removePlanDiscount + map discountPercent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Modal `ApplyDiscountModal.jsx`

**Files:**
- Create: `src/pages/Clients/ApplyDiscountModal.jsx`

Usa los componentes UI existentes (`Modal`, `Button`, `Input`, `Select` desde `../../components/ui/Input`), `formatCurrency` de `../../utils/format`, `date-fns` (`format`, `es`) y el helper `validateDiscountRange`/`eligibleMonths` de `../../services/invoices/discountRange`. Revisar la firma real de `Select` en `src/components/ui/Input.jsx` antes de escribir (options vs children).

- [ ] **Step 1: Escribir el componente**

```jsx
import { useState, useMemo, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input, { Select } from '../../components/ui/Input'
import { formatCurrency } from '../../utils/format'
import { eligibleMonths, validateDiscountRange } from '../../services/invoices/discountRange'
import { applyPlanDiscount } from '../../services/api'

const monthLabel = (year, month) =>
  format(new Date(year, month, 1), 'MMMM yyyy', { locale: es })

const keyOf = (inv) => `${inv.year}-${inv.month}`

export default function ApplyDiscountModal({ isOpen, onClose, client, invoices, onRefresh }) {
  const months = useMemo(() => eligibleMonths(invoices), [invoices])
  const [startKey, setStartKey] = useState('')
  const [endKey, setEndKey] = useState('')
  const [percent, setPercent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen) return
    setStartKey(months[0] ? keyOf(months[0]) : '')
    setEndKey(months[1] ? keyOf(months[1]) : (months[0] ? keyOf(months[0]) : ''))
    setPercent('')
    setError(null)
  }, [isOpen, months])

  const start = months.find(m => keyOf(m) === startKey)
  const end = months.find(m => keyOf(m) === endKey)

  const validation = useMemo(() => {
    if (!start || !end) return { valid: false, error: null }
    return validateDiscountRange(invoices, {
      startYear: start.year, startMonth: start.month,
      endYear: end.year, endMonth: end.month,
      percent: Number(percent)
    })
  }, [invoices, start, end, percent])

  const pct = Number(percent)
  const preview = validation.valid
    ? validation.months.map(inv => ({
        key: keyOf(inv),
        label: monthLabel(inv.year, inv.month),
        before: inv.attendanceChargeableGross || 0,
        after: Math.round((inv.attendanceChargeableGross || 0) * (1 - pct / 100))
      }))
    : []

  const handleApply = async () => {
    if (!validation.valid) return
    setSubmitting(true)
    setError(null)
    try {
      await applyPlanDiscount(client.id, start.year, start.month, end.year, end.month, pct)
      await onRefresh()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (months.length < 2) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Aplicar descuento" size="md">
        <p className="text-sm text-gray-500 py-6 text-center">
          Se necesitan al menos 2 meses sin cobrar ni facturar para aplicar un descuento.
        </p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Aplicar descuento" size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          El descuento aplica solo sobre el plan de asistencia. El transporte no se ve afectado.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Select label="Mes de inicio" value={startKey} onChange={e => setStartKey(e.target.value)}>
            {months.map(m => (
              <option key={keyOf(m)} value={keyOf(m)}>{monthLabel(m.year, m.month)}</option>
            ))}
          </Select>
          <Select label="Mes de fin" value={endKey} onChange={e => setEndKey(e.target.value)}>
            {months.map(m => (
              <option key={keyOf(m)} value={keyOf(m)}>{monthLabel(m.year, m.month)}</option>
            ))}
          </Select>
        </div>

        <Input
          label="Porcentaje de descuento"
          type="number"
          min="1"
          max="100"
          value={percent}
          onChange={e => setPercent(e.target.value)}
          placeholder="Ej: 15"
        />

        {validation.error && (
          <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">{validation.error}</div>
        )}

        {preview.length > 0 && (
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
            {preview.map(p => (
              <div key={p.key} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="capitalize text-gray-700">{p.label}</span>
                <span className="text-gray-500">
                  <span className="line-through mr-2">{formatCurrency(p.before)}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(p.after)}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleApply} loading={submitting} disabled={!validation.valid}>Aplicar descuento</Button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Verificar firma de `Select` y compilación**

Leer `src/components/ui/Input.jsx` y confirmar que `Select` acepta `label`, `value`, `onChange` y `children` (`<option>`). Si la API real usa una prop `options`, adaptar el render de los dos selects en consecuencia.
Run: `CI=true npx craco test -- --watchAll=false src/App.test.js`
Expected: PASS (compila sin errores de import).

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clients/ApplyDiscountModal.jsx
git commit -m "feat(promociones): modal de aplicar descuento con preview y validación

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integración en `ClientDetail.jsx` (entrada + badge)

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

`ClientDetail` ya tiene `useAuth`/`roleHasAccess`, el menú `MoreVert` (~línea 391-408), y `MonthCard` (desde ~705) que muestra los badges de pago/factura y usa `roleHasAccess(user?.role, 'billing')` como `canViewBilling`. `invoices` (lista) está disponible en el componente padre que renderiza los `MonthCard`.

- [ ] **Step 1: Import + estado del modal**

En los imports superiores agregar:
```javascript
import ApplyDiscountModal from './ApplyDiscountModal'
```
En el cuerpo del componente principal (junto a otros `useState` como `showOptionsMenu`), agregar:
```javascript
  const [showDiscountModal, setShowDiscountModal] = useState(false)
```
Confirmar que existen en scope: la lista `invoices`, `loadClientData` (refresh) y `roleHasAccess`/`user`. Si el refresh se llama distinto (p. ej. `loadClientData`), usar ese nombre.

- [ ] **Step 2: Item en el menú de opciones**

Dentro del dropdown del `MoreVert` (el `<div className="absolute right-0 top-full ...">`), antes/encima de "Dar de baja", agregar (gated por billing y cliente activo):
```jsx
                {!client.deletedAt && roleHasAccess(user?.role, 'billing') && (
                  <button
                    onClick={() => { setShowOptionsMenu(false); setShowDiscountModal(true) }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <Percentage className="w-4 h-4" />
                    Aplicar descuento
                  </button>
                )}
```
Agregar `Percentage` (o el icono disponible más cercano, p. ej. `Discount`/`PriceTag`) al import de `iconoir-react` existente. Verificar el nombre real exportado por `iconoir-react` antes de usarlo; si no existe `Percentage`, usar `PriceTag`.

- [ ] **Step 3: Render del modal**

Cerca del render de `EmitInvoiceModal` (al final del componente principal, no dentro de `MonthCard`), agregar:
```jsx
      <ApplyDiscountModal
        isOpen={showDiscountModal}
        onClose={() => setShowDiscountModal(false)}
        client={client}
        invoices={invoices}
        onRefresh={loadClientData}
      />
```
Usar el nombre real de la variable de invoices y de la función de refresh del componente.

- [ ] **Step 4: Badge `−X%` en `MonthCard`**

En `MonthCard`, donde se renderizan los badges del mes (junto a los de pago/factura, dentro del bloque `canViewBilling`), agregar cuando `invoice?.discountPercent > 0`:
```jsx
                {canViewBilling && invoice?.discountPercent > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                    −{invoice.discountPercent}%
                    {invoice.paymentStatus === 'pending' && invoice.invoiceStatus === 'pending' && (
                      <button
                        onClick={async () => {
                          try { await removePlanDiscount(client.id, year, month, year, month); await onRefresh() }
                          catch (e) { window.alert(e.message) }
                        }}
                        className="ml-0.5 text-violet-500 hover:text-violet-800"
                        title="Quitar descuento"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                )}
```
Importar `removePlanDiscount` desde `../../services/api` (agregar al import existente de servicios). `MonthCard` ya recibe `client`, `year`, `month`, `invoice`, `onRefresh` como props.

- [ ] **Step 5: Verificar compilación**

Run: `CI=true npx craco test -- --watchAll=false src/App.test.js`
Expected: PASS (compila; sin errores de import/símbolo).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(promociones): entrada de descuento en menú + badge por mes con quitar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Sufijo `(X% dto)` en `EmitInvoiceModal.jsx`

**Files:**
- Modify: `src/pages/Clients/EmitInvoiceModal.jsx`

El effect de pre-poblado (líneas ~65-77) arma `attConcepto`. `billing` ya trae `discountPercent` (Task 3). Solo falta concatenar el sufijo.

- [ ] **Step 1: Concatenar el sufijo al concepto de asistencia**

Reemplazar la línea:
```javascript
    setAttConcepto(`Plan ${freq} días x semana – ${SCHEDULE_LABEL[sched] ?? sched}`)
```
por:
```javascript
    const dtoSuffix = billing.discountPercent > 0 ? ` (${billing.discountPercent}% dto)` : ''
    setAttConcepto(`Plan ${freq} días x semana – ${SCHEDULE_LABEL[sched] ?? sched}${dtoSuffix}`)
```

- [ ] **Step 2: Verificar compilación**

Run: `CI=true npx craco test -- --watchAll=false src/App.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clients/EmitInvoiceModal.jsx
git commit -m "feat(promociones): sufijo (X% dto) en concepto de asistencia al facturar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Verificación end-to-end + Tailwind

**Files:** ninguno (verificación)

- [ ] **Step 1: Compilar Tailwind**

Si se agregaron clases nuevas (`bg-violet-50`, etc.), recompilar:
Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: build OK.

- [ ] **Step 2: Suite de tests completa**

Run: `CI=true npx craco test -- --watchAll=false`
Expected: PASS (incluye `discountRange.test.js` y los existentes).

- [ ] **Step 3: Smoke manual (usar skill `run` o `npm start`)**

Como admin: abrir un cliente con ≥2 meses pending → menú ⋯ → "Aplicar descuento" → elegir rango y % → confirmar. Verificar: badge `−X%` en los meses, monto de asistencia reducido en el detalle del mes, transporte sin cambios. Quitar el descuento desde el badge → vuelve a 0. Como operador: el item "Aplicar descuento" NO aparece.

- [ ] **Step 4: Commit final (si hubo cambios de tailwind.output.css)**

```bash
git add src/tailwind.output.css
git commit -m "chore(promociones): recompila Tailwind

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** columna (T2) · cálculo solo-asistencia (T2) · RPC apply + validación backend (T2) · vista (T2) · servicios (T3) · entrada gated por billing (T5) · modal con rango/% y preview (T4) · validación consecutividad/elegibilidad (T1 helper + T2 RPC) · reversibilidad/badge quitar (T5) · sufijo factura (T6) · tests (T1, T2 verif, T7). Todo cubierto.
- **Placeholders:** El único diferido intencional es la copia literal de `invoices_view` (T2 Step 2) y la confirmación de nombres reales (`Select` API en T4, icono iconoir en T5, nombres de `invoices`/`loadClientData` en T5) — todos con instrucción explícita de verificar contra el archivo real, no inventar.
- **Type consistency:** `discountPercent` (camelCase) consistente en vista→servicio→UI; `percent`/`p_percent` numérico 0–100; `month` 0-indexed en helper, RPC y UI.
