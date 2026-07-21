# Modelo unificado de faltas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar la lógica de faltas en un criterio completo y predecible: toda falta es
`absent` descrita por `is_justified` + `is_chargeable` (+ motivo), y el recupero se genera
sii `is_justified AND is_chargeable`. Se elimina el status legacy `vacation`.

**Architecture:** La derivación (¿cobrable? ¿genera recupero?) vive en un módulo puro
JS testeable (`absenceModel.js`, patrón de `dayRoster.js`/`invoiceAmounts.js`) que también
provee el mapeo de color/label del calendario. La misma regla se replica en SQL en una
familia de RPCs (`register_absence` / `register_absence_range` / `unregister_absence`), única
fuente de verdad server-side. Billing y dashboard dejan de mirar el status `vacation` y pasan
a mirar `is_chargeable`.

**Tech Stack:** React 19 (CRA + CRACO), jest (`craco test`), Supabase/PostgreSQL
(migraciones SQL numeradas, aplicadas vía MCP `apply_migration`).

## Global Constraints

- Variables y código en inglés; textos de UI en español.
- Sin `;` en JS/JSX cuando no es obligatorio.
- Marcar datos/funciones mockeadas con `// MOCKED RES` (no aplica aquí).
- Named exports para servicios; default export para componentes de página.
- Recompilar Tailwind si aparecen clases nuevas: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css` (el build NO lo hace).
- Verificación por flujo real (servicios + auth / app), no SQL directo, para el comportamiento end-to-end.
- Regla de derivación (única, replicada en JS y SQL):
  `is_chargeable = NOT (is_justified AND date > today AND NOT month_paid)`;
  `generates_credit = is_justified AND is_chargeable`.
- Vigencia del crédito: `granted_at = fecha_falta`, `expires_at = fecha_falta + 30`; `created_at` (auto) = día de creación.
- Fecha "futuro" = estrictamente `> CURRENT_DATE` (hoy y pasado NO son futuro), alineado con migración 067.

---

## File Structure

- **Create** `src/services/attendance/absenceModel.js` — lógica pura: `deriveAbsence(...)`, `dayStyle(...)`, `dayTooltip(...)`, `outcomePreview(...)`.
- **Create** `src/services/attendance/absenceModel.test.js` — tests jest de la lógica pura.
- **Create** `supabase/migrations/068_unified_absence_model.sql` — columna `is_chargeable`, backfill, vista, RPCs nuevas, drop de las viejas, CHECK sin `vacation`, billing y stats actualizados.
- **Modify** `src/services/attendance/attendanceService.js` — reemplaza fns de vacation por `registerAbsence`/`unregisterAbsence`/`registerAbsenceRange`; expone `isChargeable`.
- **Modify** `src/services/api.js` — re-exports.
- **Modify** `src/pages/Clients/ClientDetail.jsx` — display via `absenceModel`, billing mirror por `is_chargeable`, wiring de modal/undo, preview.
- **Modify** `src/services/attendance/dayRoster.js` — `ABSENT_STATUSES = ['absent']`.
- **Modify** `src/services/dashboard/attendanceStats.js` + `.test.js` y `src/services/dashboard/dashboardService.js` — bucket de faltas por cobrabilidad (former `vacation` → no-cobrable, fuera del denominador).

---

## Task 1: Módulo puro `absenceModel.js` (lógica + display)

**Files:**
- Create: `src/services/attendance/absenceModel.js`
- Test: `src/services/attendance/absenceModel.test.js`

**Interfaces:**
- Produces:
  - `deriveAbsence({ isJustified: boolean, date: string 'YYYY-MM-DD', today: string 'YYYY-MM-DD', monthPaid: boolean }) => { status: 'absent', isJustified: boolean, isChargeable: boolean, generatesCredit: boolean }`
  - `dayStyle(status: string, isJustified: boolean, isChargeable: boolean) => string` (clases Tailwind)
  - `dayTooltip(status: string, isJustified: boolean, isChargeable: boolean, notes: string|null) => { title: string, reason: string|null }`
  - `outcomePreview({ isJustified, date, today, monthPaid }) => string` (texto para el modal)

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/attendance/absenceModel.test.js
import { deriveAbsence, dayStyle, dayTooltip, outcomePreview } from './absenceModel'

const TODAY = '2026-07-20'

describe('deriveAbsence', () => {
  test('injustificada (futuro, impago) → cobrable, sin crédito', () => {
    expect(deriveAbsence({ isJustified: false, date: '2026-08-01', today: TODAY, monthPaid: false }))
      .toEqual({ status: 'absent', isJustified: false, isChargeable: true, generatesCredit: false })
  })
  test('justificada hoy (impago) → cobrable, +crédito', () => {
    expect(deriveAbsence({ isJustified: true, date: TODAY, today: TODAY, monthPaid: false }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: true, generatesCredit: true })
  })
  test('justificada pasado (impago) → cobrable, +crédito', () => {
    expect(deriveAbsence({ isJustified: true, date: '2026-07-10', today: TODAY, monthPaid: false }).generatesCredit).toBe(true)
  })
  test('justificada futuro + mes pago → cobrable, +crédito', () => {
    expect(deriveAbsence({ isJustified: true, date: '2026-08-01', today: TODAY, monthPaid: true }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: true, generatesCredit: true })
  })
  test('justificada futuro + mes NO pago → no cobrable, sin crédito', () => {
    expect(deriveAbsence({ isJustified: true, date: '2026-08-01', today: TODAY, monthPaid: false }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: false, generatesCredit: false })
  })
})

describe('dayStyle', () => {
  test('injustificada = rojo fuerte', () => {
    expect(dayStyle('absent', false, true)).toBe('bg-red-500 text-white')
  })
  test('justificada cobrable = rojo claro', () => {
    expect(dayStyle('absent', true, true)).toBe('bg-red-300 text-white')
  })
  test('justificada no cobrable = naranja', () => {
    expect(dayStyle('absent', true, false)).toBe('bg-orange-400 text-white')
  })
  test('attended/recovery/scheduled sin cambios', () => {
    expect(dayStyle('attended', false, true)).toBe('bg-green-500 text-white')
    expect(dayStyle('recovery', false, true)).toBe('bg-blue-500 text-white')
    expect(dayStyle('scheduled', false, true)).toBe('bg-gray-200 text-gray-600')
  })
})

describe('dayTooltip', () => {
  test('justificada cobrable → +1 recupero, con motivo', () => {
    expect(dayTooltip('absent', true, true, 'Enfermo/a'))
      .toEqual({ title: 'Falta justificada (+1 recupero)', reason: 'Enfermo/a' })
  })
  test('justificada no cobrable → no cobrable', () => {
    expect(dayTooltip('absent', true, false, null))
      .toEqual({ title: 'Falta justificada (no cobrable)', reason: null })
  })
  test('injustificada', () => {
    expect(dayTooltip('absent', false, true, null))
      .toEqual({ title: 'Falta no justificada', reason: null })
  })
})

describe('outcomePreview', () => {
  test('injustificada', () => {
    expect(outcomePreview({ isJustified: false, date: TODAY, today: TODAY, monthPaid: false }))
      .toBe('Se cobra el día igual. Sin crédito de recupero.')
  })
  test('justificada con crédito', () => {
    expect(outcomePreview({ isJustified: true, date: TODAY, today: TODAY, monthPaid: false }))
      .toBe('Se cobra el día y se acredita 1 día de recupero.')
  })
  test('justificada sin crédito (futuro impago)', () => {
    expect(outcomePreview({ isJustified: true, date: '2026-08-01', today: TODAY, monthPaid: false }))
      .toBe('No se cobra el día (sin recupero).')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `CI=true npx craco test src/services/attendance/absenceModel.test.js`
Expected: FAIL con "Cannot find module './absenceModel'".

- [ ] **Step 3: Implementar el módulo**

```js
// src/services/attendance/absenceModel.js
/**
 * Lógica pura del modelo unificado de faltas. Toda falta es status 'absent',
 * descrita por is_justified + is_chargeable. El recupero se genera sii
 * (is_justified AND is_chargeable). Espejo exacto de la RPC register_absence.
 *
 * is_chargeable = NOT (justificada AND futuro AND mes NO pago)
 *   - futuro = date > today (estrictamente; hoy y pasado NO son futuro)
 */

/**
 * @param {{ isJustified: boolean, date: string, today: string, monthPaid: boolean }} p
 *   date/today en formato 'YYYY-MM-DD' (comparación lexicográfica válida).
 * @returns {{ status: 'absent', isJustified: boolean, isChargeable: boolean, generatesCredit: boolean }}
 */
export function deriveAbsence({ isJustified, date, today, monthPaid }) {
  const isFuture = date > today
  const isChargeable = !(isJustified && isFuture && !monthPaid)
  const generatesCredit = isJustified && isChargeable
  return { status: 'absent', isJustified: !!isJustified, isChargeable, generatesCredit }
}

/** Clases Tailwind de la celda del calendario por status + atributos de falta. */
export function dayStyle(status, isJustified, isChargeable) {
  if (status === 'attended') return 'bg-green-500 text-white'
  if (status === 'absent') {
    if (!isJustified) return 'bg-red-500 text-white'
    return isChargeable ? 'bg-red-300 text-white' : 'bg-orange-400 text-white'
  }
  if (status === 'recovery') return 'bg-blue-500 text-white'
  if (status === 'scheduled') return 'bg-gray-200 text-gray-600'
  return ''
}

/** { title, reason } — reason es el motivo libre (notes) cuando la falta lo tiene. */
export function dayTooltip(status, isJustified, isChargeable, notes) {
  let title = ''
  if (status === 'attended') title = 'Asistió'
  else if (status === 'absent') {
    if (!isJustified) title = 'Falta no justificada'
    else title = isChargeable ? 'Falta justificada (+1 recupero)' : 'Falta justificada (no cobrable)'
  }
  else if (status === 'recovery') title = 'Día recuperado'
  else if (status === 'scheduled') title = 'Programado'
  const reason = status === 'absent' && notes ? notes : null
  return { title, reason }
}

/** Texto predecible del resultado, para el modal de registro de falta. */
export function outcomePreview({ isJustified, date, today, monthPaid }) {
  if (!isJustified) return 'Se cobra el día igual. Sin crédito de recupero.'
  const { generatesCredit } = deriveAbsence({ isJustified, date, today, monthPaid })
  return generatesCredit
    ? 'Se cobra el día y se acredita 1 día de recupero.'
    : 'No se cobra el día (sin recupero).'
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `CI=true npx craco test src/services/attendance/absenceModel.test.js`
Expected: PASS (todos los tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/attendance/absenceModel.js src/services/attendance/absenceModel.test.js
git commit -m "feat(faltas): módulo puro absenceModel (derivación + display)"
```

---

## Task 2: Migración 068 — modelo unificado en la base

**Files:**
- Create: `supabase/migrations/068_unified_absence_model.sql`

**Interfaces:**
- Consumes: tablas `attendance_records`, `recovery_credits`, `recovery_credit_ledger`, `monthly_invoices`, `client_plans`; helper `_recovery_balance(uuid)`; vista `attendance_view`; fns `calculate_month_billing`, `get_attendance_stats`.
- Produces (RPCs que el frontend consume):
  - `register_absence(p_client_id uuid, p_date date, p_is_justified boolean, p_notes text, p_created_by text) RETURNS jsonb` → `{ success, isChargeable, creditEarned }`
  - `register_absence_range(p_client_id uuid, p_from_date date, p_to_date date, p_is_justified boolean, p_notes text, p_created_by text) RETURNS jsonb` → `{ success, daysMarked }`
  - `unregister_absence(p_client_id uuid, p_date date, p_created_by text) RETURNS jsonb` → `{ success, creditRevoked }`
  - `attendance_view` gana `isChargeable`.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/068_unified_absence_model.sql` con este contenido exacto:

```sql
-- 068_unified_absence_model.sql
-- Modelo unificado de faltas: toda falta es 'absent', descrita por
-- is_justified + is_chargeable. Recupero sii (justificada AND cobrable).
-- Se elimina el status legacy 'vacation'.
--   is_chargeable = NOT (justificada AND futuro AND mes NO pago)
--   futuro = fecha > CURRENT_DATE (hoy/pasado NO son futuro)

-- ── 1. Columna is_chargeable ───────────────────────────────────────────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS is_chargeable BOOLEAN NOT NULL DEFAULT true;

-- ── 2. Backfill: 'vacation' → 'absent' justificada NO cobrable ─────────────
-- (preserva notes; NO toca recovery_credits: los créditos históricos siguen vivos)
UPDATE attendance_records
SET status = 'absent', is_justified = true, is_chargeable = false, updated_at = NOW()
WHERE status = 'vacation';

-- ── 3. CHECK sin 'vacation' ────────────────────────────────────────────────
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;
ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('scheduled', 'attended', 'absent', 'recovery'));

-- ── 4. attendance_view expone isChargeable ────────────────────────────────
CREATE OR REPLACE VIEW attendance_view AS
SELECT
  ar.id,
  ar.client_id AS "clientId",
  ar.date::TEXT AS date,
  ar.shift,
  ar.status,
  ar.is_justified AS "isJustified",
  ar.is_chargeable AS "isChargeable",
  ar.notes,
  ar.created_at AS "createdAt",
  ar.updated_at AS "updatedAt"
FROM attendance_records ar;

-- ── 5. register_absence — única fuente de verdad ───────────────────────────
CREATE OR REPLACE FUNCTION public.register_absence(
  p_client_id uuid,
  p_date date,
  p_is_justified boolean DEFAULT false,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
  v_year INTEGER; v_month INTEGER; v_month_paid BOOLEAN;
  v_is_future BOOLEAN; v_is_chargeable BOOLEAN; v_grants_credit BOOLEAN;
  v_clean_notes TEXT;
BEGIN
  v_clean_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1;
  SELECT (payment_status = 'paid') INTO v_month_paid FROM monthly_invoices
  WHERE client_id = p_client_id AND year = v_year AND month = v_month;
  v_month_paid := COALESCE(v_month_paid, false);

  v_is_future := p_date > CURRENT_DATE;
  v_is_chargeable := NOT (p_is_justified AND v_is_future AND NOT v_month_paid);
  v_grants_credit := p_is_justified AND v_is_chargeable;

  INSERT INTO attendance_records (client_id, date, status, is_justified, is_chargeable, notes)
  VALUES (p_client_id, p_date, 'absent', p_is_justified, v_is_chargeable, v_clean_notes)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'absent',
    is_justified = EXCLUDED.is_justified,
    is_chargeable = EXCLUDED.is_chargeable,
    notes = EXCLUDED.notes,
    updated_at = NOW()
  RETURNING id INTO v_record_id;

  -- Re-marca idempotente: revoca cualquier crédito vivo previo de este registro
  DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';

  IF v_grants_credit THEN
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, note, grant_attendance_id, created_by_name)
    VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_clean_notes, v_record_id, p_created_by)
    RETURNING id INTO v_credit_id;
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
    VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by, v_credit_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'isChargeable', v_is_chargeable, 'creditEarned', v_grants_credit);
END;
$function$;

-- ── 6. register_absence_range — evalúa cada día asignado por separado ───────
CREATE OR REPLACE FUNCTION public.register_absence_range(
  p_client_id uuid,
  p_from_date date,
  p_to_date date,
  p_is_justified boolean DEFAULT false,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_day DATE; v_day_of_week INTEGER; v_day_name TEXT;
  v_assigned_days TEXT[]; v_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM client_plans WHERE client_id = p_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan no encontrado');
  END IF;
  v_day := p_from_date;
  WHILE v_day <= p_to_date LOOP
    SELECT assigned_days INTO v_assigned_days
    FROM client_plans
    WHERE client_id = p_client_id AND effective_from <= date_trunc('month', v_day)::date
    ORDER BY effective_from DESC LIMIT 1;

    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
      WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' ELSE NULL END;
    IF v_day_name IS NOT NULL AND v_assigned_days IS NOT NULL AND v_day_name = ANY(v_assigned_days) THEN
      PERFORM register_absence(p_client_id, v_day, p_is_justified, p_notes, p_created_by);
      v_count := v_count + 1;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;
  RETURN jsonb_build_object('success', true, 'daysMarked', v_count);
END;
$function$;

-- ── 7. unregister_absence — reversa unificada ──────────────────────────────
CREATE OR REPLACE FUNCTION public.unregister_absence(
  p_client_id uuid,
  p_date date,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_had_credit BOOLEAN := false; v_new_balance INTEGER;
BEGIN
  SELECT id INTO v_record_id FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date AND status = 'absent';
  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No existe falta para este día');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available'
  ) INTO v_had_credit;

  IF v_had_credit THEN
    DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';
  END IF;

  -- Hoy/pasado → 'attended'; futuro estricto → 'scheduled' (alineado con 067)
  UPDATE attendance_records SET
    status = CASE WHEN p_date > CURRENT_DATE THEN 'scheduled' ELSE 'attended' END,
    is_justified = NULL,
    is_chargeable = true,
    notes = NULL,
    updated_at = NOW()
  WHERE id = v_record_id;

  IF v_had_credit THEN
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_justified_absence', v_record_id, v_new_balance, p_created_by);
  END IF;

  RETURN jsonb_build_object('success', true, 'creditRevoked', v_had_credit);
END;
$function$;

-- ── 8. Drop de las RPCs legacy (todas las firmas) ──────────────────────────
DROP FUNCTION IF EXISTS public.mark_day_absent(uuid, date, boolean, text, text);
DROP FUNCTION IF EXISTS public.mark_day_absent(uuid, date, boolean, text);
DROP FUNCTION IF EXISTS public.unmark_day_absent(uuid, date, text);
DROP FUNCTION IF EXISTS public.mark_day_vacation(uuid, date, text, text);
DROP FUNCTION IF EXISTS public.mark_day_vacation(uuid, date, text);
DROP FUNCTION IF EXISTS public.unmark_day_vacation(uuid, date, text);
DROP FUNCTION IF EXISTS public.mark_vacation_range(uuid, date, date, text, text);
DROP FUNCTION IF EXISTS public.mark_vacation_range(uuid, date, date, text);

-- ── 9. Billing: cobrable = planned - (absent AND NOT is_chargeable) ────────
-- Reemplaza SOLO la detección de días descontados dentro de calculate_month_billing.
-- (Base: migración 055. El resto de la función queda idéntico; se recrea completa
--  para mantener una sola definición viva.)
```

Luego, **en la misma migración**, pegar la definición COMPLETA de
`calculate_month_billing` copiada de `supabase/migrations/055_versioned_pricing.sql`,
cambiando únicamente el bloque de detección de días descontados:

```sql
        -- ANTES (055):
        -- IF EXISTS (SELECT 1 FROM attendance_records
        --   WHERE client_id = p_client_id AND date = v_day AND status = 'vacation') THEN
        --   v_vacation_days := v_vacation_days + 1; END IF;
        -- AHORA:
        IF EXISTS (
          SELECT 1 FROM attendance_records
          WHERE client_id = p_client_id AND date = v_day
            AND status = 'absent' AND is_chargeable = false
        ) THEN
          v_vacation_days := v_vacation_days + 1;
        END IF;
```

Nota: se mantiene el nombre de variable `v_vacation_days` y la clave de salida
`vacationDays` en el `jsonb_build_object` para no romper consumidores (PaymentModal).
Su semántica ahora es "días no cobrables". No cambiar nada más de la función.

- [ ] **Step 2: Añadir la actualización de `get_attendance_stats` a la misma migración**

Al final de 068, recrear `get_attendance_stats` (base: `supabase/migrations/038_dashboard_analytics_and_churn.sql`) cambiando SOLO los conteos de faltas para el nuevo modelo. La columna `vacation` de salida pasa a significar "falta justificada no cobrable":

```sql
-- get_attendance_stats: 'vacation' ya no existe como status.
--   absentJustified   = absent AND is_justified AND is_chargeable      (cobrada, cuenta como ausencia)
--   absentUnjustified = absent AND NOT is_justified                    (cobrada, cuenta como ausencia)
--   vacation          = absent AND is_justified AND NOT is_chargeable  (no cobrable, EXCLUIDA del denominador)
```

Pegar la definición COMPLETA de `get_attendance_stats` de 038, reemplazando los
`COUNT(... FILTER ...)` de faltas por:

```sql
    COUNT(*) FILTER (WHERE ar.status = 'absent' AND ar.is_justified = true AND ar.is_chargeable = true)::int,   -- absentJustified
    COUNT(*) FILTER (WHERE ar.status = 'absent' AND (ar.is_justified = false OR ar.is_justified IS NULL))::int,  -- absentUnjustified
    COUNT(*) FILTER (WHERE ar.status = 'recovery')::int,                                                          -- recovery
    COUNT(*) FILTER (WHERE ar.status = 'absent' AND ar.is_justified = true AND ar.is_chargeable = false)::int,   -- vacation (no cobrable)
```

(Respetar el orden/nombres de columnas de retorno tal como los declara 038; solo cambian las expresiones de conteo. Verificar el orden exacto en 038 antes de pegar.)

- [ ] **Step 3: Aplicar la migración**

Aplicar `068_unified_absence_model.sql` con la tool MCP `apply_migration` (name: `unified_absence_model`).
Expected: sin error. Si aparece "function is not unique" al recrear, verificar que los `DROP FUNCTION` cubran la firma exacta en DB (`\df register_absence` / listar con `list_migrations`).

- [ ] **Step 4: Verificación SQL directa (solo estructura, no flujo)**

Vía MCP `execute_sql`:
```sql
-- Ninguna fila 'vacation' debe quedar
SELECT count(*) AS vacation_rows FROM attendance_records WHERE status = 'vacation';  -- 0
-- La vista expone isChargeable
SELECT "isChargeable" FROM attendance_view LIMIT 1;
-- Las RPCs nuevas existen y las viejas no
SELECT proname FROM pg_proc WHERE proname IN
 ('register_absence','register_absence_range','unregister_absence',
  'mark_day_vacation','unmark_day_vacation','mark_vacation_range','mark_day_absent','unmark_day_absent')
 ORDER BY proname;  -- solo las 3 register_*
```
Expected: `vacation_rows = 0`; la vista devuelve la columna; solo aparecen `register_absence`, `register_absence_range`, `unregister_absence`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/068_unified_absence_model.sql
git commit -m "feat(faltas): migración 068 modelo unificado (is_chargeable + register_absence)"
```

---

## Task 3: Servicio de asistencia + facade

**Files:**
- Modify: `src/services/attendance/attendanceService.js`
- Modify: `src/services/api.js:67-71`

**Interfaces:**
- Consumes: RPCs `register_absence`, `register_absence_range`, `unregister_absence` (Task 2).
- Produces:
  - `registerAbsence(clientId, date, isJustified, userName, notes) => Promise<{success, isChargeable, creditEarned}>`
  - `registerAbsenceRange(clientId, fromDate, toDate, isJustified, userName, notes) => Promise<{success, daysMarked}>`
  - `unregisterAbsence(clientId, date, userName) => Promise<{success, creditRevoked}>`
  - `getClientAttendance` ahora incluye `isChargeable` en cada registro.

- [ ] **Step 1: Reemplazar las funciones de vacation/absent por la familia register_***

En `src/services/attendance/attendanceService.js`, borrar `markDayAbsent`, `unmarkDayAbsent`, `markDayVacation`, `unmarkDayVacation`, `markVacationRange` (líneas 68-164) y agregar en su lugar:

```js
/**
 * Registra una falta (única fuente de verdad server-side). El backend deriva
 * si es cobrable y si genera recupero. Ver absenceModel.deriveAbsence.
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {boolean} isJustified
 * @param {string} userName
 * @param {string|null} notes - Motivo (chip o texto libre)
 * @returns {Promise<{success: boolean, isChargeable: boolean, creditEarned: boolean}>}
 */
export async function registerAbsence(clientId, date, isJustified, userName, notes = null) {
  const { data, error } = await supabase.rpc('register_absence', {
    p_client_id: clientId,
    p_date: date,
    p_is_justified: isJustified,
    p_notes: notes,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al registrar falta')
  return data
}

/**
 * Registra faltas en un rango; cada día asignado se evalúa por separado.
 * @returns {Promise<{success: boolean, daysMarked: number}>}
 */
export async function registerAbsenceRange(clientId, fromDate, toDate, isJustified, userName, notes = null) {
  const { data, error } = await supabase.rpc('register_absence_range', {
    p_client_id: clientId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_is_justified: isJustified,
    p_notes: notes,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al registrar rango de faltas')
  return data
}

/**
 * Deshace una falta: revierte el día a attended/scheduled y revoca el crédito
 * de recupero si la falta lo había generado.
 * @returns {Promise<{success: boolean, creditRevoked: boolean}>}
 */
export async function unregisterAbsence(clientId, date, userName) {
  const { data, error } = await supabase.rpc('unregister_absence', {
    p_client_id: clientId,
    p_date: date,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al deshacer falta')
  return data
}
```

- [ ] **Step 2: Exponer `isChargeable` en `getClientAttendance`**

En `getClientAttendance` (líneas 17-23), añadir el campo:

```js
  return data.map(r => ({
    date: r.date,
    status: r.status,
    isJustified: r.isJustified,
    isChargeable: r.isChargeable,
    shift: r.shift,
    notes: r.notes
  }))
```

- [ ] **Step 3: Actualizar el facade `api.js`**

En `src/services/api.js`, reemplazar las líneas 67-71:

```js
// ANTES:
//   markDayAbsent,
//   unmarkDayAbsent,
//   markDayVacation,
//   unmarkDayVacation,
//   markVacationRange,
// AHORA:
  registerAbsence,
  unregisterAbsence,
  registerAbsenceRange,
```

(Verificar la sección `export { ... } from './attendance/attendanceService'` o el import correspondiente y ajustar en ambos lugares si el facade importa y re-exporta por separado.)

- [ ] **Step 4: Verificar compilación**

Run: `CI=true npx craco test --watchAll=false --passWithNoTests src/services/attendance/absenceModel.test.js`
Expected: PASS (sanity: el proyecto sigue transpilando; los tests puros pasan).
Además comprobar que no queden imports rotos: `grep -rn "markDayVacation\|markDayAbsent\|unmarkDayVacation\|markVacationRange\|unmarkDayAbsent" src/` no debe devolver referencias FUERA de las que se van a editar en Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/services/attendance/attendanceService.js src/services/api.js
git commit -m "feat(faltas): servicio register/unregister absence (elimina vacation)"
```

---

## Task 4: ClientDetail — display, billing mirror, modal y undo

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`
- Modify: `src/services/attendance/dayRoster.js:19`

**Interfaces:**
- Consumes: `absenceModel` (Task 1), `registerAbsence`/`registerAbsenceRange`/`unregisterAbsence` (Task 3).

- [ ] **Step 1: Importar helpers y reemplazar `getDayStyle`/`getDayTooltip`**

Al tope de `ClientDetail.jsx`, agregar:
```js
import { dayStyle, dayTooltip, outcomePreview } from '../../services/attendance/absenceModel'
```
Actualizar el import del servicio (líneas 22-26): quitar `markDayAbsent, unmarkDayAbsent, markDayVacation, unmarkDayVacation, markVacationRange` y poner `registerAbsence, unregisterAbsence, registerAbsenceRange`.

Borrar las funciones locales `getDayStyle` (107-115) y `getDayTooltip` (117-128). Donde se
las invoque en el render, reemplazar por `dayStyle(...)` / `dayTooltip(...)` de `absenceModel`,
pasando `isChargeable`. Buscar los call-sites: `grep -n "getDayStyle\|getDayTooltip" src/pages/Clients/ClientDetail.jsx`. Cada llamada pasa a
`dayStyle(status, isJustified, isChargeable)` y `dayTooltip(status, isJustified, isChargeable, notes)`.

- [ ] **Step 2: `getDayStatus` devuelve `isChargeable`**

En `getDayStatus` (961-978), incluir `isChargeable` en cada retorno:
- Para el registro persistido: `isChargeable: rec.isChargeable ?? true`.
- Para los derivados (`recovery`, `not_scheduled`, `scheduled`, `attended`): `isChargeable: true`.

```js
    if (rec && rec.status !== 'scheduled') return { status: rec.status, isJustified: rec.isJustified ?? false, isChargeable: rec.isChargeable ?? true, isAssigned: true, notes: rec.notes ?? null }
    if (day > today) return { status: 'scheduled', isJustified: false, isChargeable: true, isAssigned: true }
    return { status: 'attended', isJustified: false, isChargeable: true, isAssigned: true }
```
(Y añadir `isChargeable: true` a los tres retornos `not_scheduled`/`recovery` de las líneas 967-971.)

- [ ] **Step 3: Billing mirror por `is_chargeable`**

En `MonthCard`, cambiar `vacationDays` (910-915) y `discountedDays` (889-891):

```js
  // Días descontados del mes (no cobrables) → adenda por defecto del modal.
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const discountedDays = attendance
    .filter(a => a.status === 'absent' && a.isChargeable === false && String(a.date).startsWith(monthPrefix))
    .map(a => new Date(String(a.date) + 'T12:00:00'))
```

```js
  const vacationDays = days.filter(d => {
    const dateStr = format(d, 'yyyy-MM-dd')
    const rec = attendance.find(a => a.date === dateStr)
    const name = DAY_INDEX_TO_NAME[getDay(d)]
    return name && plan.assignedDays.includes(name) && d >= effectiveStart && (!deactDate || d < deactDate) && rec?.status === 'absent' && rec?.isChargeable === false
  }).length
```
(El resto del cálculo de billing no cambia: `chargeableDays = plannedDays - vacationDays`.)

- [ ] **Step 4: Wiring del modal `onConfirm` y undo**

Reemplazar el `onConfirm` del AbsenceModal (1251-1257):

```js
        onConfirm={({ type, reason, range }) => {
          const isJustified = type === 'justified'
          if (range)
            return withProcessing(() => registerAbsenceRange(client.id, range.from, range.to, isJustified, user?.name, reason))
          return withProcessing(() => registerAbsence(client.id, selectedDate, isJustified, user?.name, reason))
        }}
```

Unificar el ruteo de undo en `handleDayClick` (990-995): tanto `vacation` (ya no existe) como `absent` van a un único modal de deshacer falta. Simplificar a:
```js
    if (isAssigned) {
      if (status === 'scheduled' || status === 'attended') setModal('absence')
      else if (status === 'absent') setModal('undoAbsence')
    } else {
```
Borrar la rama `else if (status === 'vacation') setModal('undoVacation')`.

Eliminar el `ConfirmModal` de `undoVacation` (1273-1284) por completo. En el `ConfirmModal`
de `undoAbsence` (1260-1271), cambiar el `onConfirm` a `unregisterAbsence` y ajustar el mensaje
para que use el crédito de forma genérica:
```js
        onConfirm={() => withProcessing(() => unregisterAbsence(client.id, selectedDate, user?.name))}
```
Mensaje: usar `selectedRecord?.isJustified && selectedRecord?.isChargeable` para decidir si mostrar "Se descontará 1 día de recupero." (guardar `isChargeable` en `selectedRecord` en `handleDayClick`, línea 988: `setSelectedRecord({ status, isJustified, isChargeable })`).

- [ ] **Step 5: Preview de resultado en el AbsenceModal**

En `AbsenceModal`, reemplazar el banner ámbar `isPaid` (1594-1598) por un preview derivado.
Agregar (dentro del componente, tras `const justifiedReason = ...`):
```js
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const previewText = selected
    ? outcomePreview({ isJustified: selected === 'justified', date, today: todayStr, monthPaid: !!isPaid })
    : null
```
Y renderizar, cuando `selected !== null` y NO hay rango activo, un bloque informativo:
```jsx
        {selected && !(isJustified && rangeOn) && (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">{previewText}</div>
        )}
```
Para el caso rango, mostrar una nota fija: "Cada día del rango se evalúa por separado según su fecha y el estado de cobro del mes." Actualizar el copy de los botones "Justificada"/"No justificada" (1582, 1589) para que no prometan un resultado fijo (p. ej. Justificada: "Puede o no cobrarse según la fecha y si el mes ya se cobró; genera recupero cuando se cobra.").

Actualizar el comentario de cabecera del AbsenceModal (1513-1515) para reflejar `registerAbsence`.

- [ ] **Step 6: `dayRoster` — quitar 'vacation'**

En `src/services/attendance/dayRoster.js:19`:
```js
export const ABSENT_STATUSES = ['absent']
```
Correr sus tests: `CI=true npx craco test src/services/attendance/dayRoster.test.js` → PASS (el flatten de faltas ya trataba 'absent' como ausencia; ninguna fila 'vacation' existe post-migración).

- [ ] **Step 7: Recompilar Tailwind y verificar build**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
(Las clases `bg-orange-400`, `bg-red-300`, etc. ya existían, pero recompilar por si el modal introduce alguna nueva.)
Run: `CI=true npx craco test --watchAll=false src/services/attendance/` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx src/services/attendance/dayRoster.js src/tailwind.output.css
git commit -m "feat(faltas): ClientDetail sobre modelo unificado (display/billing/modal/undo)"
```

---

## Task 5: Dashboard — stats de asistencia consistentes con el nuevo modelo

**Files:**
- Modify: `src/services/dashboard/attendanceStats.js`
- Modify: `src/services/dashboard/attendanceStats.test.js`
- Modify: `src/services/dashboard/dashboardService.js` (mapeo de la fila, si aplica)

**Interfaces:**
- Consumes: `get_attendance_stats` (actualizada en Task 2), cuya columna `vacation` ahora = faltas justificadas no cobrables.

- [ ] **Step 1: Confirmar la semántica esperada con un test**

En `attendanceStats.test.js`, el contrato NO cambia (vacation y scheduled siguen fuera del denominador; attended en numerador; absent justificado/injustificado cuentan como no-asistencia). Añadir un test que fije que una falta justificada COBRABLE (`absentJustified`) cuenta en el denominador y una no cobrable (`vacation`) no:

```js
  test('falta justificada cobrable cuenta como ausencia; no cobrable no', () => {
    // 8 attended, 1 absentJustified (cobrable) → 8/9; vacation (no cobrable) ignorada
    expect(attendanceRate({ attended: 8, absentJustified: 1, vacation: 5, scheduled: 4 }))
      .toBeCloseTo(8 / 9)
  })
```

- [ ] **Step 2: Correr el test**

Run: `CI=true npx craco test src/services/dashboard/attendanceStats.test.js`
Expected: PASS si `attendanceRate` ya incluye `absentJustified` en el denominador; si FALLA, ajustar `attendanceStats.js` para que el denominador sea `attended + absentJustified + absentUnjustified + recovery` (excluyendo `vacation` y `scheduled`). Ver la definición actual de `attendanceRate` antes de editar y mantener el resto igual.

- [ ] **Step 3: Verificar el mapeo de la fila en `dashboardService.js`**

Confirmar que `dashboardService.js:263` (`vacation: Number(r.vacation) || 0`) sigue leyendo la columna `vacation` que ahora devuelve la RPC con su nueva semántica. No requiere cambio de código, solo verificación. Documentar con un comentario que `vacation` = faltas justificadas no cobrables.

- [ ] **Step 4: Correr toda la suite del dashboard**

Run: `CI=true npx craco test src/services/dashboard/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard/attendanceStats.js src/services/dashboard/attendanceStats.test.js src/services/dashboard/dashboardService.js
git commit -m "feat(faltas): stats de asistencia bucketean faltas por cobrabilidad"
```

---

## Task 6: Verificación end-to-end (flujo real) + lessons

**Files:**
- Modify: `tasks/lessons.md` (si hubo correcciones)

- [ ] **Step 1: Suite completa de tests unitarios**

Run: `CI=true npx craco test --watchAll=false`
Expected: PASS. Sin referencias colgadas: `grep -rn "vacation\|markDayVacation\|markVacationRange\|mark_day_vacation" src/` solo debe aparecer donde `vacation` significa "no cobrable" (dashboard) o en comentarios actualizados.

- [ ] **Step 2: Verificación por flujo real (app corriendo)**

Levantar la app (`npm start`) e ir al detalle de un cliente con plan y meses cargados.
Demostrar cada escenario del spec y observar calendario + montos:
1. Falta HOY justificada, mes impago → celda rojo claro "Falta justificada (+1 recupero)", monto NO baja, balance de recupero +1.
2. Falta HOY justificada, mes pago → +1 recupero, monto congelado.
3. Falta FUTURA justificada, mes impago → celda naranja "Falta justificada (no cobrable)", monto del mes baja, sin recupero.
4. Falta FUTURA justificada, mes pago → rojo claro +1 recupero, monto no baja.
5. Falta injustificada (hoy y futuro) → rojo "Falta no justificada", se cobra, sin recupero.
6. Rango justificado que cruza hoy/pago → cada día resuelve su color/cobro correcto.
7. Deshacer una falta con recupero → el crédito se revoca (balance -1) y el día vuelve a attended/scheduled.
8. El motivo aparece en el tooltip del día y en `recovery_credits.note` (verificar vía `execute_sql`: `SELECT note, granted_at, expires_at, created_at FROM recovery_credits ORDER BY created_at DESC LIMIT 1`).
9. Vigencia = `granted_at (fecha falta) + 30`; `created_at` = hoy.
10. Un día que era `vacation` antes de migrar se ve "Falta justificada (no cobrable)" y sigue sin cobrarse; el balance de recupero histórico no cambió.

- [ ] **Step 3: Documentar resultado**

Anotar en `tasks/todo.md` un breve review de lo verificado. Si hubo alguna corrección durante la implementación, capturar el patrón en `tasks/lessons.md`.

- [ ] **Step 4: Commit final (si aplica)**

```bash
git add tasks/
git commit -m "docs(faltas): verificación y lessons del modelo unificado"
```

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** columna `is_chargeable` + backfill (T2/§migración), invariante recupero (T1/T2), RPCs unificadas (T2), drop de vacation + 5 RPCs (T2), billing por is_chargeable (T2 §9), display por atributos (T1/T4), preview del modal (T1/T4), vigencia fecha_falta+30 y created_at (T2), motivo en credit.note (T2), dashboard consistente (T5), verificación de los 10 escenarios (T6). ✔
- **Placeholders:** sin TBD/TODO; el único "pegar función completa desde 055/038" es deliberado (evita duplicar ~140 líneas ya versionadas y minimiza riesgo de derivar la lógica de precio/stats no relacionada). ✔
- **Consistencia de tipos:** `registerAbsence(clientId, date, isJustified, userName, notes)` y firma RPC `register_absence(p_client_id, p_date, p_is_justified, p_notes, p_created_by)` coinciden en orden; `getClientAttendance` expone `isChargeable`, consumido por `getDayStatus`/`dayStyle`/`dayTooltip`; `outcomePreview` mismos params que `deriveAbsence`. ✔
- **Fuera de alcance (confirmado):** flujo "pide devolución" (flecha amarilla). ✔
