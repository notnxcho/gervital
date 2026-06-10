# Integración Biller (eFactura) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emitir e-Tickets mensuales (plan + transporte) y registrar receptores en Biller (test.biller.uy) desde Gervital, con la primera factura de prueba emitida al terminar la Fase 1.

**Architecture:** Una Edge Function `biller` (patrón `admin-users`) orquesta toda la comunicación con la API de Biller v2 usando un Bearer token guardado como secreto (nunca en el frontend). El comprobante se arma en un módulo puro testeable; los montos salen de `calculate_month_billing` (gross, IVA incluido → `montos_brutos: true`). El receptor viaja **inline** en cada comprobante (robusto ante la falta de endpoint de update y suficiente para que Biller cree/actualice y envíe el PDF por email). `sync_client` pre-registra el receptor y guarda su ID para biyectividad y visibilidad en el panel.

**Tech Stack:** React 19 + CRA, Supabase (Postgres + Edge Functions Deno/TS), API REST Biller v2.

**Spec:** `docs/superpowers/specs/2026-06-05-biller-efactura-design.md`

---

## Decisiones de diseño locked-in

- **Receptor inline siempre** en `comprobantes/crear` (`tipo_documento=3` CI, `nombre_fantasia`, `sucursal.emails`). `sync_client` es complementario (no bloqueante).
- **`numero_interno` = `"{clientId}-{year}-{month}"`** (determinístico → idempotencia sin depender de que exista la fila `monthly_invoices`).
- **Ítems inline**, código estable derivado del plan vigente: `PLAN-{frequency}-{SCHEDULE}` (IVA 22%, `indicador_facturacion: 3`) y `TRANS-{distance_range}-{frequency}` (IVA 10%, `indicador_facturacion: 2`).
- **`montos_brutos: true`**, `precio` = `*ChargeableGross`, `cantidad: 1`, `moneda: "UYU"`, `forma_pago: 1` (contado).
- Toda la **autorización por rol** se hace en la Edge Function (service_role bypassa RLS). `billing` = admin/superadmin; `sync_client` = cualquier usuario conocido; `void_invoice` = superadmin.

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/022_biller_integration.sql` | Crear | Columnas fiscales + Biller en `clients` y `monthly_invoices`; RPCs (`mark_invoice_emitted`, `set_invoice_emit_error`, `mark_invoice_voided`, `set_invoice_dgi_status`, `set_client_biller_sync`); recreación de `create_client_full`/`update_client_full`, vistas `clients_full`/`invoices_view`. |
| `supabase/functions/biller/lib/comprobante.ts` | Crear | Funciones puras: `buildComprobante`, `buildClientePayload`, mapas de IVA/tipo doc/labels, derivación de códigos. |
| `supabase/functions/biller/lib/comprobante_test.ts` | Crear | Deno tests del builder. |
| `supabase/functions/biller/index.ts` | Crear | `Deno.serve`: auth del caller, gating por rol, dispatch de acciones, fetch a Biller. |
| `src/services/biller/billerService.js` | Crear | Wrapper de `supabase.functions.invoke('biller', ...)`. |
| `src/services/api.js` | Modificar | Re-export de `billerService`. |
| `src/services/clients/clientTransformers.js` | Modificar | Mapear `documentType`/`documentNumber` a params RPC. |
| `src/pages/Clients/AddClient.jsx` | Modificar | Campos de documento (alta + edición). |
| `src/pages/Clients/ClientDetail.jsx` | Modificar | Botón "Emitir e-Ticket", chip DGI, badge sync, anular. |
| `src/pages/Dashboard/Dashboard.jsx` | Modificar | Botón + modal de emisión masiva. |

---

# FASE 1 — Primera factura de prueba (objetivo de HOY)

Al terminar la Task 8 podés emitir el primer e-Ticket en test.biller.uy. Las fases 2–3 agregan sync automático, DGI polling, anulación y emisión masiva.

---

### Task 1: Migración 022 — columnas

**Files:**
- Create: `supabase/migrations/022_biller_integration.sql`

- [ ] **Step 1: Escribir la primera parte de la migración (columnas + índice)**

Crear el archivo con este contenido inicial:

```sql
-- 022_biller_integration.sql
-- Integración con Biller (eFactura Uruguay): datos fiscales del cliente,
-- mapeo de receptor, y resultado de emisión por comprobante.

-- ── clients: datos fiscales + mapeo Biller ───────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'ci'
    CHECK (document_type IN ('ci', 'rut', 'dni', 'pasaporte', 'otro')),
  ADD COLUMN IF NOT EXISTS document_number TEXT,
  ADD COLUMN IF NOT EXISTS biller_client_id BIGINT,
  ADD COLUMN IF NOT EXISTS biller_branch_id BIGINT,
  ADD COLUMN IF NOT EXISTS biller_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS biller_sync_error TEXT;

-- ── monthly_invoices: resultado de emisión ───────────────────────────────────
ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS biller_id BIGINT,
  ADD COLUMN IF NOT EXISTS biller_serie TEXT,
  ADD COLUMN IF NOT EXISTS biller_numero TEXT,
  ADD COLUMN IF NOT EXISTS biller_hash TEXT,
  ADD COLUMN IF NOT EXISTS dgi_status TEXT
    CHECK (dgi_status IN ('pending_dgi', 'accepted', 'rejected')),
  ADD COLUMN IF NOT EXISTS dgi_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS emit_error TEXT;

-- Idempotencia/upsert por cliente-mes (defensivo: ensure_client_months ya asume unicidad).
CREATE UNIQUE INDEX IF NOT EXISTS monthly_invoices_client_year_month_uniq
  ON monthly_invoices (client_id, year, month);
```

- [ ] **Step 2: Aplicar y verificar las columnas**

Aplicar la migración (vía MCP Supabase `apply_migration` con name `022_biller_integration` y este SQL, o `psql`). Verificar:

Run (MCP `execute_sql`):
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='clients' AND column_name LIKE 'biller%' OR column_name LIKE 'document%'
ORDER BY column_name;
```
Expected: `biller_branch_id, biller_client_id, biller_sync_error, biller_synced_at, document_number, document_type`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_biller_integration.sql
git commit -m "feat(billing): migración 022 columnas Biller en clients y monthly_invoices"
```

---

### Task 2: Migración 022 — RPCs y vistas

**Files:**
- Modify: `supabase/migrations/022_biller_integration.sql`

- [ ] **Step 1: Agregar RPCs de persistencia de Biller**

Anexar al archivo de la migración 022:

```sql
-- ── RPC: persistir emisión exitosa (upsert) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_invoice_emitted(
  p_client_id uuid, p_year integer, p_month integer,
  p_biller_id bigint, p_serie text, p_numero text, p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  INSERT INTO monthly_invoices (
    client_id, year, month, invoice_status, invoiced_at, invoice_number,
    biller_id, biller_serie, biller_numero, biller_hash, dgi_status, emit_error, updated_at
  ) VALUES (
    p_client_id, p_year, p_month, 'invoiced', NOW(), p_serie || '-' || p_numero,
    p_biller_id, p_serie, p_numero, p_hash, 'pending_dgi', NULL, NOW()
  )
  ON CONFLICT (client_id, year, month) DO UPDATE SET
    invoice_status = 'invoiced', invoiced_at = NOW(),
    invoice_number = EXCLUDED.invoice_number, biller_id = EXCLUDED.biller_id,
    biller_serie = EXCLUDED.biller_serie, biller_numero = EXCLUDED.biller_numero,
    biller_hash = EXCLUDED.biller_hash, dgi_status = 'pending_dgi',
    emit_error = NULL, updated_at = NOW();
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── RPC: persistir error de emisión ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_invoice_emit_error(
  p_client_id uuid, p_year integer, p_month integer, p_error text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  INSERT INTO monthly_invoices (client_id, year, month, emit_error, updated_at)
  VALUES (p_client_id, p_year, p_month, p_error, NOW())
  ON CONFLICT (client_id, year, month) DO UPDATE SET
    emit_error = EXCLUDED.emit_error, updated_at = NOW();
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── RPC: anular (revertir a pending) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_invoice_voided(
  p_client_id uuid, p_year integer, p_month integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE monthly_invoices SET
    invoice_status = 'pending', invoiced_at = NULL, invoice_number = NULL,
    biller_id = NULL, biller_serie = NULL, biller_numero = NULL, biller_hash = NULL,
    dgi_status = NULL, dgi_checked_at = NULL, updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── RPC: actualizar estado DGI ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_invoice_dgi_status(
  p_client_id uuid, p_year integer, p_month integer, p_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE monthly_invoices SET dgi_status = p_status, dgi_checked_at = NOW(), updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── RPC: guardar mapeo de receptor Biller ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_client_biller_sync(
  p_client_id uuid, p_biller_client_id bigint, p_biller_branch_id bigint, p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE clients SET
    biller_client_id = COALESCE(p_biller_client_id, biller_client_id),
    biller_branch_id = COALESCE(p_biller_branch_id, biller_branch_id),
    biller_synced_at = CASE WHEN p_error IS NULL THEN NOW() ELSE biller_synced_at END,
    biller_sync_error = p_error,
    updated_at = NOW()
  WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;
```

- [ ] **Step 2: Recrear `create_client_full` y `update_client_full` con campos de documento**

Anexar (DROP de las firmas viejas — los overloads se acumulan y rompen con "function is not unique", ver lección RPC overload):

```sql
-- ── Recrear create_client_full / update_client_full con documento ─────────────
DROP FUNCTION IF EXISTS public.create_client_full(text, text, text, text, date, text, date, integer, text, boolean, text[], text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.update_client_full(uuid, text, text, text, text, date, text, date, integer, text, boolean, text[], text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean, boolean);

CREATE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT false,
  p_plan_assigned_days text[] DEFAULT '{}', p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_med_dietary text DEFAULT NULL, p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL,
  p_med_medication text DEFAULT NULL, p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL,
  p_med_is_diabetic boolean DEFAULT false, p_med_is_celiac boolean DEFAULT false, p_med_is_hypertensive boolean DEFAULT false,
  p_document_type text DEFAULT 'ci', p_document_number text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date, document_type, document_number)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date, COALESCE(p_document_type,'ci'), p_document_number)
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

CREATE FUNCTION public.update_client_full(
  p_client_id uuid, p_first_name text DEFAULT NULL, p_last_name text DEFAULT NULL, p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT NULL,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT NULL,
  p_plan_assigned_days text[] DEFAULT NULL, p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_med_dietary text DEFAULT NULL, p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL,
  p_med_medication text DEFAULT NULL, p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL,
  p_med_is_diabetic boolean DEFAULT NULL, p_med_is_celiac boolean DEFAULT NULL, p_med_is_hypertensive boolean DEFAULT NULL,
  p_document_type text DEFAULT NULL, p_document_number text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE clients SET
    first_name = COALESCE(p_first_name, first_name),
    last_name = COALESCE(p_last_name, last_name),
    email = COALESCE(p_email, email),
    phone = COALESCE(p_phone, phone),
    birth_date = COALESCE(p_birth_date, birth_date),
    cognitive_level = COALESCE(p_cognitive_level, cognitive_level),
    start_date = COALESCE(p_start_date, start_date),
    document_type = COALESCE(p_document_type, document_type),
    document_number = COALESCE(p_document_number, document_number),
    updated_at = NOW()
  WHERE id = p_client_id;

  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (p_client_id, p_ec_name, p_ec_relationship, p_ec_phone)
    ON CONFLICT (client_id) DO UPDATE SET name = EXCLUDED.name, relationship = EXCLUDED.relationship, phone = EXCLUDED.phone, updated_at = NOW();
  END IF;

  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (p_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range)
    ON CONFLICT (client_id) DO UPDATE SET street = EXCLUDED.street, access_notes = EXCLUDED.access_notes,
      doorbell = EXCLUDED.doorbell, concierge = EXCLUDED.concierge,
      distance_range = COALESCE(EXCLUDED.distance_range, client_addresses.distance_range), updated_at = NOW();
  END IF;

  IF p_med_dietary IS NOT NULL OR p_med_medical IS NOT NULL OR p_med_mobility IS NOT NULL
     OR p_med_medication IS NOT NULL OR p_med_medication_schedule IS NOT NULL OR p_med_notes IS NOT NULL
     OR p_med_is_diabetic IS NOT NULL OR p_med_is_celiac IS NOT NULL OR p_med_is_hypertensive IS NOT NULL THEN
    INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive)
    VALUES (p_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, COALESCE(p_med_is_diabetic,FALSE), COALESCE(p_med_is_celiac,FALSE), COALESCE(p_med_is_hypertensive,FALSE))
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

- [ ] **Step 3: Recrear vistas `clients_full` e `invoices_view` con campos nuevos**

Anexar:

```sql
-- ── clients_full: exponer documento + estado Biller ──────────────────────────
CREATE OR REPLACE VIEW public.clients_full WITH (security_invoker = true) AS
 SELECT c.id, c.first_name AS "firstName", c.last_name AS "lastName", c.email, c.phone,
    c.birth_date AS "birthDate", c.cognitive_level AS "cognitiveLevel", c.start_date AS "startDate",
    c.document_type AS "documentType", c.document_number AS "documentNumber",
    c.biller_client_id AS "billerClientId", c.biller_branch_id AS "billerBranchId",
    c.biller_synced_at AS "billerSyncedAt", c.biller_sync_error AS "billerSyncError",
    ( SELECT count(*)::integer FROM recovery_credits rc
        WHERE rc.client_id = c.id AND rc.status = 'available' AND rc.expires_at >= CURRENT_DATE) AS "recoveryDaysAvailable",
    c.avatar_url AS "avatarUrl", c.deleted_at AS "deletedAt",
    c.deactivation_reason AS "deactivationReason", c.deactivation_notes AS "deactivationNotes",
    c.created_at AS "createdAt",
    CASE WHEN cp.id IS NOT NULL THEN jsonb_build_object('frequency', cp.frequency, 'schedule', cp.schedule, 'hasTransport', cp.has_transport, 'assignedDays', cp.assigned_days) ELSE NULL::jsonb END AS plan,
    CASE WHEN ec.id IS NOT NULL THEN jsonb_build_object('name', ec.name, 'relationship', ec.relationship, 'phone', ec.phone) ELSE NULL::jsonb END AS "emergencyContact",
    CASE WHEN ca.id IS NOT NULL THEN jsonb_build_object('street', ca.street, 'accessNotes', ca.access_notes, 'doorbell', ca.doorbell, 'concierge', ca.concierge, 'latitude', ca.latitude, 'longitude', ca.longitude, 'distanceRange', ca.distance_range) ELSE NULL::jsonb END AS address,
    CASE WHEN mi.id IS NOT NULL THEN jsonb_build_object('dietaryRestrictions', mi.dietary_restrictions, 'medicalRestrictions', mi.medical_restrictions, 'mobilityRestrictions', mi.mobility_restrictions, 'medication', mi.medication, 'medicationSchedule', mi.medication_schedule, 'notes', mi.notes, 'isDiabetic', mi.is_diabetic, 'isCeliac', mi.is_celiac, 'isHypertensive', mi.is_hypertensive) ELSE NULL::jsonb END AS "medicalInfo"
   FROM clients c
     LEFT JOIN LATERAL (
       SELECT cp2.id, cp2.frequency, cp2.schedule, cp2.has_transport, cp2.assigned_days
       FROM client_plans cp2 WHERE cp2.client_id = c.id AND cp2.effective_from <= date_trunc('month', CURRENT_DATE)::date
       ORDER BY cp2.effective_from DESC LIMIT 1
     ) cp ON true
     LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- ── invoices_view: exponer campos Biller/DGI ─────────────────────────────────
DROP VIEW IF EXISTS invoices_view;
CREATE VIEW invoices_view AS
SELECT mi.id, mi.client_id AS "clientId", mi.year, mi.month,
  mi.planned_days AS "plannedDays", mi.chargeable_days AS "chargeableDays",
  mi.chargeable_amount AS "chargeableAmount", mi.monthly_rate AS "monthlyRate",
  mi.attendance_monthly_rate_net AS "attendanceMonthlyRateNet", mi.attendance_monthly_rate_gross AS "attendanceMonthlyRateGross",
  mi.attendance_chargeable_net AS "attendanceChargeableNet", mi.attendance_chargeable_gross AS "attendanceChargeableGross",
  mi.transport_monthly_rate_net AS "transportMonthlyRateNet", mi.transport_monthly_rate_gross AS "transportMonthlyRateGross",
  mi.transport_chargeable_net AS "transportChargeableNet", mi.transport_chargeable_gross AS "transportChargeableGross",
  mi.is_amount_overridden AS "isAmountOverridden", mi.original_chargeable_amount AS "originalChargeableAmount",
  mi.invoice_status AS "invoiceStatus", mi.invoiced_at AS "invoicedAt",
  mi.invoice_number AS "invoiceNumber", mi.invoice_url AS "invoiceUrl",
  mi.biller_id AS "billerId", mi.biller_serie AS "billerSerie", mi.biller_numero AS "billerNumero",
  mi.biller_hash AS "billerHash", mi.dgi_status AS "dgiStatus", mi.dgi_checked_at AS "dgiCheckedAt",
  mi.emit_error AS "emitError",
  mi.payment_status AS "paymentStatus", mi.paid_at AS "paidAt", mi.paid_date AS "paidDate",
  mi.paid_amount AS "paidAmount", mi.payment_method AS "paymentMethod", mi.payment_notes AS "paymentNotes",
  mi.created_at AS "createdAt", mi.updated_at AS "updatedAt"
FROM monthly_invoices mi;
ALTER VIEW invoices_view SET (security_invoker = on);
```

- [ ] **Step 4: Aplicar y verificar las firmas (sin overloads duplicados)**

Run (MCP `execute_sql`):
```sql
SELECT proname, count(*) FROM pg_proc
WHERE proname IN ('create_client_full','update_client_full','mark_invoice_emitted','set_client_biller_sync')
GROUP BY proname ORDER BY proname;
```
Expected: cada función con count = 1 (sin overloads acumulados).

Run:
```sql
SELECT "documentType","billerClientId" FROM clients_full LIMIT 1;
SELECT "billerId","dgiStatus","emitError" FROM invoices_view LIMIT 1;
```
Expected: ambas devuelven columnas sin error.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/022_biller_integration.sql
git commit -m "feat(billing): RPCs y vistas Biller; create/update_client_full con documento"
```

---

### Task 3: Builder de comprobante (módulo puro) — TDD

**Files:**
- Create: `supabase/functions/biller/lib/comprobante.ts`
- Test: `supabase/functions/biller/lib/comprobante_test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// comprobante_test.ts
import { assertEquals, assert } from 'jsr:@std/assert@1'
import { buildComprobante, TIPO_ETICKET } from './comprobante.ts'

const baseClient = {
  id: 'c1', first_name: 'Ana', last_name: 'Pérez',
  email: 'ana@example.com', document_type: 'ci', document_number: '12345678',
  street: '18 de Julio 1234',
}
const billingNoTransport = {
  hasTransport: false,
  attendanceChargeableGross: 9000, transportChargeableGross: 0,
  totalChargeableGross: 9000,
}
const plan = { frequency: 3, schedule: 'afternoon', distance_range: null }

Deno.test('e-Ticket CI: una sola línea de asistencia con IVA 22%', () => {
  const c = buildComprobante({ client: baseClient, plan, billing: billingNoTransport, year: 2026, month: 5 })
  assertEquals(c.tipo_comprobante, TIPO_ETICKET)
  assertEquals(c.montos_brutos, true)
  assertEquals(c.moneda, 'UYU')
  assertEquals(c.numero_interno, 'c1-2026-5')
  assertEquals(c.cliente.tipo_documento, 3)
  assertEquals(c.cliente.documento, '12345678')
  assertEquals(c.items.length, 1)
  assertEquals(c.items[0].codigo, 'PLAN-3-AFTERNOON')
  assertEquals(c.items[0].precio, 9000)
  assertEquals(c.items[0].indicador_facturacion, 3)
  assert(c.cliente.sucursal.emails.includes('ana@example.com'))
})

Deno.test('con transporte: agrega línea TRANS con IVA 10%', () => {
  const billing = { hasTransport: true, attendanceChargeableGross: 9000, transportChargeableGross: 1500, totalChargeableGross: 10500 }
  const c = buildComprobante({ client: baseClient, plan: { frequency: 3, schedule: 'afternoon', distance_range: '2_to_5km' }, billing, year: 2026, month: 0 })
  assertEquals(c.items.length, 2)
  assertEquals(c.items[1].codigo, 'TRANS-2_to_5km-3')
  assertEquals(c.items[1].precio, 1500)
  assertEquals(c.items[1].indicador_facturacion, 2)
})

Deno.test('sin email: no rompe y emails queda vacío', () => {
  const c = buildComprobante({ client: { ...baseClient, email: null }, plan, billing: billingNoTransport, year: 2026, month: 5 })
  assertEquals(c.cliente.sucursal.emails, [])
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `deno test supabase/functions/biller/lib/comprobante_test.ts`
Expected: FAIL — `Module not found "./comprobante.ts"`.

(Si `deno` no está instalado: `brew install deno`. Si no querés instalarlo, salteá Steps 2 y 4 y confiá en la prueba end-to-end de la Task 13.)

- [ ] **Step 3: Implementar el builder**

```typescript
// comprobante.ts
export const TIPO_ETICKET = 101
export const IVA_BASICA = 3   // 22% — asistencia
export const IVA_MINIMA = 2   // 10% — transporte

const DOC_TYPE_MAP: Record<string, number> = { rut: 2, ci: 3, otro: 4, pasaporte: 5, dni: 6 }
const SCHEDULE_LABEL: Record<string, string> = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }
const MONTH_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

export interface BillerClient {
  id: string; first_name: string; last_name: string; email: string | null
  document_type: string; document_number: string | null; street?: string | null
}
export interface PlanInfo { frequency: number; schedule: string; distance_range: string | null }
export interface Billing { hasTransport: boolean; attendanceChargeableGross: number; transportChargeableGross: number; totalChargeableGross: number }

export function buildClientePayload(client: BillerClient) {
  const fullName = `${client.first_name} ${client.last_name}`.trim().slice(0, 30)
  return {
    tipo_documento: DOC_TYPE_MAP[client.document_type] ?? 3,
    documento: client.document_number ?? '',
    nombre_fantasia: fullName,
    pais: 'UY',
    sucursal: {
      direccion: (client.street ?? '').slice(0, 70),
      pais: 'UY',
      emails: client.email ? [client.email] : [],
    },
  }
}

export function buildComprobante(
  { client, plan, billing, year, month, emisorSucursal }:
  { client: BillerClient; plan: PlanInfo; billing: Billing; year: number; month: number; emisorSucursal?: number }
) {
  const monthLabel = `${MONTH_ES[month]} ${year}`
  const items: Array<Record<string, unknown>> = [{
    codigo: `PLAN-${plan.frequency}-${plan.schedule.toUpperCase()}`,
    cantidad: 1,
    concepto: `Plan ${plan.frequency}x ${SCHEDULE_LABEL[plan.schedule] ?? plan.schedule} - ${monthLabel}`,
    precio: billing.attendanceChargeableGross,
    indicador_facturacion: IVA_BASICA,
  }]
  if (billing.hasTransport && billing.transportChargeableGross > 0) {
    items.push({
      codigo: `TRANS-${plan.distance_range ?? 'NA'}-${plan.frequency}`,
      cantidad: 1,
      concepto: `Transporte - ${monthLabel}`,
      precio: billing.transportChargeableGross,
      indicador_facturacion: IVA_MINIMA,
    })
  }
  const cliente = buildClientePayload(client)
  const comprobante: Record<string, unknown> = {
    tipo_comprobante: TIPO_ETICKET,
    forma_pago: 1,
    moneda: 'UYU',
    montos_brutos: true,
    numero_interno: `${client.id}-${year}-${month}`,
    cliente,
    emails_notificacion: cliente.sucursal.emails,
    items,
  }
  if (emisorSucursal) comprobante.sucursal = emisorSucursal
  return comprobante
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `deno test supabase/functions/biller/lib/comprobante_test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/biller/lib/comprobante.ts supabase/functions/biller/lib/comprobante_test.ts
git commit -m "feat(billing): builder puro de comprobante Biller + tests"
```

---

### Task 4: Edge Function `biller` — acción `emit_invoice`

**Files:**
- Create: `supabase/functions/biller/index.ts`

- [ ] **Step 1: Escribir la Edge Function (auth + dispatch + emit)**

```typescript
// index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buildComprobante } from './lib/comprobante.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const BILLER_BASE_URL = Deno.env.get('BILLER_BASE_URL') ?? ''
const BILLER_TOKEN = Deno.env.get('BILLER_TOKEN') ?? ''
const BILLER_SUCURSAL = Deno.env.get('BILLER_SUCURSAL') // opcional (id de sucursal emisora)

function billerHeaders() {
  return { 'Authorization': `Bearer ${BILLER_TOKEN}`, 'Content-Type': 'application/json' }
}

// Resuelve la versión de plan vigente para el mes (misma lógica que calculate_month_billing).
async function resolvePlan(admin: ReturnType<typeof createClient>, clientId: string, year: number, month: number) {
  const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const { data } = await admin.from('client_plans')
    .select('frequency, schedule, distance_range')
    .eq('client_id', clientId).lte('effective_from', firstOfMonth)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'No autenticado' }, 401)

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: callerProfile } = await admin.from('users').select('role').eq('auth_id', caller.id).single()
    const role = callerProfile?.role
    if (!role) return json({ error: 'No autorizado' }, 403)
    const isBilling = role === 'admin' || role === 'superadmin'

    const body = await req.json()
    const { action } = body

    if (action === 'emit_invoice') {
      if (!isBilling) return json({ error: 'No autorizado' }, 403)
      const { clientId, year, month } = body

      const { data: client } = await admin.from('clients')
        .select('id, first_name, last_name, email, document_type, document_number, client_addresses(street)')
        .eq('id', clientId).single()
      if (!client) return json({ error: 'Cliente no encontrado' }, 404)
      if (!client.document_number) return json({ error: 'El cliente no tiene documento cargado' }, 422)

      const { data: existing } = await admin.from('monthly_invoices')
        .select('biller_id').eq('client_id', clientId).eq('year', year).eq('month', month).maybeSingle()
      if (existing?.biller_id) return json({ error: 'La factura de este mes ya fue emitida' }, 409)

      const { data: billing, error: billErr } = await admin.rpc('calculate_month_billing', { p_client_id: clientId, p_year: year, p_month: month })
      if (billErr) return json({ error: billErr.message }, 400)
      if (billing?.error) return json({ error: billing.error }, 422)
      if (!billing || Number(billing.totalChargeableGross) <= 0) return json({ error: 'Monto a facturar es 0' }, 422)

      const plan = await resolvePlan(admin, clientId, year, month)
      if (!plan) return json({ error: 'Plan no encontrado' }, 422)

      const comprobante = buildComprobante({
        client: { ...client, street: client.client_addresses?.[0]?.street ?? null },
        plan: { frequency: plan.frequency, schedule: plan.schedule, distance_range: plan.distance_range },
        billing: {
          hasTransport: billing.hasTransport,
          attendanceChargeableGross: Number(billing.attendanceChargeableGross),
          transportChargeableGross: Number(billing.transportChargeableGross),
          totalChargeableGross: Number(billing.totalChargeableGross),
        },
        year, month,
        emisorSucursal: BILLER_SUCURSAL ? Number(BILLER_SUCURSAL) : undefined,
      })

      const resp = await fetch(`${BILLER_BASE_URL}/comprobantes/crear`, {
        method: 'POST', headers: billerHeaders(), body: JSON.stringify(comprobante),
      })
      const raw = await resp.text()
      if (!resp.ok) {
        await admin.rpc('set_invoice_emit_error', { p_client_id: clientId, p_year: year, p_month: month, p_error: `HTTP ${resp.status}: ${raw.slice(0, 500)}` })
        return json({ error: `Biller rechazó la emisión (HTTP ${resp.status})`, detail: raw.slice(0, 500) }, 502)
      }
      let parsed: { id?: number; serie?: string; numero?: string; hash?: string }
      try { parsed = JSON.parse(raw) } catch { parsed = {} }
      await admin.rpc('mark_invoice_emitted', {
        p_client_id: clientId, p_year: year, p_month: month,
        p_biller_id: parsed.id ?? null, p_serie: parsed.serie ?? '', p_numero: parsed.numero ?? '', p_hash: parsed.hash ?? null,
      })
      return json({ ok: true, serie: parsed.serie, numero: parsed.numero, id: parsed.id })
    }

    return json({ error: 'Acción inválida' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/biller/index.ts
git commit -m "feat(billing): edge function biller con acción emit_invoice"
```

---

### Task 5: Deploy de la Edge Function y secretos (CHECKPOINT — pegar token)

**Files:** ninguno (operación de infraestructura)

- [ ] **Step 1: Setear los secretos de Biller (acción del usuario)**

> **CHECKPOINT — pedir al usuario que ejecute en su terminal (prefijo `!`):**
> ```bash
> supabase secrets set BILLER_BASE_URL="https://test.biller.uy/v2" BILLER_TOKEN="<TU_TOKEN_DE_TEST>"
> ```
> Si la emisión luego falla por sucursal emisora faltante, agregar `BILLER_SUCURSAL="<id del panel>"`.

- [ ] **Step 2: Desplegar la función**

Run (vía MCP `deploy_edge_function` con slug `biller` e include de `index.ts` + `lib/comprobante.ts`, o CLI):
```bash
supabase functions deploy biller
```
Expected: deploy exitoso; `biller` aparece en `list_edge_functions`.

- [ ] **Step 3: Smoke test de auth**

Verificar que sin JWT devuelve 401 (la función vive; el dispatch responde). Confirmar en logs (MCP `get_logs` service `edge-function`) que no hay errores de import.

---

### Task 6: Servicio frontend `billerService`

**Files:**
- Create: `src/services/biller/billerService.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Crear el servicio**

```javascript
import { supabase } from '../supabase/client'

// Invoke the biller edge function, surfacing the server error message
async function invokeBiller(body) {
  const { data, error } = await supabase.functions.invoke('biller', { body })
  if (error) {
    let message = error.message
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) message = ctx.error
    } catch (_) { /* ignore parse errors */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/** Emit a monthly e-Ticket for a client (month is 0-indexed) */
export async function emitInvoice(clientId, year, month) {
  return invokeBiller({ action: 'emit_invoice', clientId, year, month })
}

/** Pre-register / sync a client as a Biller receptor */
export async function syncClientToBiller(clientId) {
  return invokeBiller({ action: 'sync_client', clientId })
}

/** Poll DGI acceptance status for an emitted invoice */
export async function checkDgiStatus(clientId, year, month) {
  return invokeBiller({ action: 'check_dgi_status', clientId, year, month })
}

/** Void an emitted invoice (issues a credit note in Biller) */
export async function voidInvoice(clientId, year, month) {
  return invokeBiller({ action: 'void_invoice', clientId, year, month })
}
```

- [ ] **Step 2: Re-exportar desde el facade `api.js`**

Agregar junto a los otros re-exports en `src/services/api.js`:
```javascript
export { emitInvoice, syncClientToBiller, checkDgiStatus, voidInvoice } from './biller/billerService'
```

- [ ] **Step 3: Verificar build**

Run: `npx eslint src/services/biller/billerService.js`
Expected: sin errores. (Si no hay eslint configurado, verificar que `npm start` compila sin errores de import.)

- [ ] **Step 4: Commit**

```bash
git add src/services/biller/billerService.js src/services/api.js
git commit -m "feat(billing): billerService frontend (emit/sync/dgi/void)"
```

---

### Task 7: Campos de documento en alta/edición de cliente

**Files:**
- Modify: `src/services/clients/clientTransformers.js`
- Modify: `src/pages/Clients/AddClient.jsx`

- [ ] **Step 1: Mapear documento en `transformClientToDb`**

En `clientTransformers.js`, dentro del objeto que devuelve `transformClientToDb` (después de `p_start_date`), agregar:
```javascript
    p_document_type: clientData.documentType || 'ci',
    p_document_number: clientData.documentNumber || null,
```

- [ ] **Step 2: Mapear documento en `transformUpdateToDb`**

En `transformUpdateToDb`, después del bloque de `p_start_date`, agregar:
```javascript
  if (updateData.documentType !== undefined) params.p_document_type = updateData.documentType
  if (updateData.documentNumber !== undefined) params.p_document_number = updateData.documentNumber
```

- [ ] **Step 3: Agregar opciones y estado inicial en AddClient**

En `AddClient.jsx`, debajo de `COGNITIVE_LEVEL_OPTIONS` (línea ~58) agregar:
```javascript
const DOCUMENT_TYPE_OPTIONS = [
  { value: 'ci', label: 'Cédula (CI)' },
  { value: 'rut', label: 'RUT' },
  { value: 'dni', label: 'DNI' },
  { value: 'pasaporte', label: 'Pasaporte' },
  { value: 'otro', label: 'Otro' }
]
```
En `INITIAL_FORM_DATA`, después de `startDate:` agregar:
```javascript
  documentType: 'ci',
  documentNumber: '',
```

- [ ] **Step 4: Cargar documento en modo edición**

En el `setFormData({...})` del `useEffect` de edición (línea ~140), después de `startDate: client.startDate || '',` agregar:
```javascript
          documentType: client.documentType || 'ci',
          documentNumber: client.documentNumber || '',
```

- [ ] **Step 5: Incluir documento en `clientData` del submit**

En `handleSubmit`, dentro del objeto `clientData` (después de `startDate: formData.startDate,`) agregar:
```javascript
        documentType: formData.documentType,
        documentNumber: formData.documentNumber,
```

- [ ] **Step 6: Renderizar los inputs en el paso 1**

En el grid de datos personales, después del bloque `<Input label="Fecha de ingreso" ... />` (línea ~517) agregar:
```jsx
                  <Select
                    label="Tipo de documento"
                    value={formData.documentType}
                    onChange={(e) => updateField('documentType', e.target.value)}
                    options={DOCUMENT_TYPE_OPTIONS}
                  />
                  <Input
                    label="Número de documento"
                    value={formData.documentNumber}
                    onChange={(e) => updateField('documentNumber', e.target.value)}
                    error={errors.documentNumber}
                    placeholder="1.234.567-8"
                  />
```

- [ ] **Step 7: Verificar en la app**

Run: `npm start`. Crear un cliente con CI; editar otro y confirmar que la CI persiste tras recargar.
Run (MCP `execute_sql`): `SELECT first_name, document_type, document_number FROM clients ORDER BY created_at DESC LIMIT 1;`
Expected: el documento aparece guardado.

- [ ] **Step 8: Commit**

```bash
git add src/services/clients/clientTransformers.js src/pages/Clients/AddClient.jsx
git commit -m "feat(clients): campos de documento (tipo + número) en alta y edición"
```

---

### Task 8: Botón "Emitir e-Ticket" en el detalle de cliente → PRIMERA FACTURA

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Importar `emitInvoice` y agregar estado de emisión**

En el import de servicios (bloque `import { ... } from '../../services/api'`, línea 6) agregar `emitInvoice`.
Junto a los otros `useState` del componente (línea ~668) agregar:
```javascript
  const [emitting, setEmitting] = useState(false)
  const [emitErr, setEmitErr] = useState(null)
```

- [ ] **Step 2: Agregar el handler de emisión (errores visibles, no silenciados)**

Después de `handleUndoPayment` (línea ~808) agregar:
```javascript
  const handleEmitInvoice = async () => {
    setInvoiceDropOpen(false)
    setEmitErr(null)
    setEmitting(true)
    try {
      const res = await emitInvoice(client.id, year, month)
      await onRefresh()
      window.alert(`e-Ticket emitido: ${res.serie}-${res.numero}`)
    } catch (err) {
      setEmitErr(err.message)
      window.alert(`Error al emitir: ${err.message}`)
    } finally {
      setEmitting(false)
    }
  }
```

- [ ] **Step 3: Reemplazar la acción del dropdown "Sin factura"**

En el dropdown de factura, sustituir el botón "Marcar como facturado" (líneas ~903-909, rama `else`) por la acción primaria de emisión + la manual como secundaria:
```jsx
                  ) : (
                    <>
                      <button
                        onClick={handleEmitInvoice}
                        disabled={emitting}
                        className="w-full px-3 py-2 text-left text-sm text-indigo-700 font-medium hover:bg-indigo-50 disabled:opacity-50"
                      >
                        {emitting ? 'Emitiendo…' : 'Emitir e-Ticket'}
                      </button>
                      <button
                        onClick={() => { setInvoiceDropOpen(false); setModal('invoice') }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
                      >
                        Marcar como facturado manualmente
                      </button>
                    </>
                  )}
```

- [ ] **Step 4: Mostrar el último error de emisión (si existe)**

Dentro de la rama `else` del dropdown, antes del fragmento de botones, mostrar el error persistido o el de la última acción:
```jsx
                      {(emitErr || invoice?.emitError) && (
                        <div className="px-3 py-2 text-xs text-red-600 border-b border-gray-100">
                          {emitErr || invoice.emitError}
                        </div>
                      )}
```
(Colocar este bloque como primer hijo del `<>...</>` agregado en el Step 3.)

- [ ] **Step 5: Emitir la primera factura de prueba**

Run: `npm start`. Pre-requisitos: el cliente de prueba debe tener CI cargada (Task 7) y un mes con monto > 0.
1. Abrir el detalle del cliente.
2. En el mes corriente, abrir el badge "Sin factura" → "Emitir e-Ticket".
3. Confirmar el alert `e-Ticket emitido: C-XXXXXX`.

Verificar:
- En el panel `test.biller.uy`: el comprobante existe, con línea de asistencia (IVA 22%) y transporte (IVA 10%) si aplica, y el email salió al cliente.
- Run (MCP `execute_sql`): `SELECT invoice_status, biller_serie, biller_numero, dgi_status FROM monthly_invoices WHERE client_id='<id>' AND year=<y> AND month=<m>;`
  Expected: `invoiced`, serie/numero poblados, `dgi_status='pending_dgi'`.

Si falla con error de sucursal emisora: setear `BILLER_SUCURSAL` (Task 5, Step 1) y re-deploy.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(billing): emisión de e-Ticket desde el detalle de cliente"
```

> **🎯 FIN DE FASE 1 — primera factura de prueba emitida.** Las fases siguientes son mejoras; podés pausar acá.

---

# FASE 2 — Integración completa

### Task 9: `sync_client` + auto-sync al crear + badge/retry

**Files:**
- Modify: `supabase/functions/biller/index.ts`
- Modify: `src/pages/Clients/AddClient.jsx`
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Agregar la acción `sync_client` en la Edge Function**

Antes del `return json({ error: 'Acción inválida' }, 400)` en `index.ts`, agregar:
```typescript
    if (action === 'sync_client') {
      // Cualquier usuario conocido puede sincronizar (puede crear clientes)
      const { clientId } = body
      const { data: client } = await admin.from('clients')
        .select('id, first_name, last_name, email, document_type, document_number, client_addresses(street)')
        .eq('id', clientId).single()
      if (!client) return json({ error: 'Cliente no encontrado' }, 404)
      if (!client.document_number) return json({ error: 'El cliente no tiene documento cargado' }, 422)

      const fullName = `${client.first_name} ${client.last_name}`.trim().slice(0, 30)
      const docMap: Record<string, number> = { rut: 2, ci: 3, otro: 4, pasaporte: 5, dni: 6 }
      const payload = {
        tipo_documento: docMap[client.document_type] ?? 3,
        documento: client.document_number,
        nombre_fantasia: fullName,
        pais: 'UY',
        sucursal: {
          direccion: (client.client_addresses?.[0]?.street ?? '').slice(0, 70),
          pais: 'UY',
          emails: client.email ? [client.email] : [],
        },
      }
      const resp = await fetch(`${BILLER_BASE_URL}/clientes/crear`, { method: 'POST', headers: billerHeaders(), body: JSON.stringify(payload) })
      const raw = await resp.text()
      if (!resp.ok) {
        await admin.rpc('set_client_biller_sync', { p_client_id: clientId, p_biller_client_id: null, p_biller_branch_id: null, p_error: `HTTP ${resp.status}: ${raw.slice(0, 300)}` })
        return json({ error: `Biller rechazó el alta del cliente (HTTP ${resp.status})`, detail: raw.slice(0, 300) }, 502)
      }
      let parsed: { cliente?: number; sucursal?: number }
      try { parsed = JSON.parse(raw) } catch { parsed = {} }
      await admin.rpc('set_client_biller_sync', { p_client_id: clientId, p_biller_client_id: parsed.cliente ?? null, p_biller_branch_id: parsed.sucursal ?? null, p_error: null })
      return json({ ok: true, billerClientId: parsed.cliente, billerBranchId: parsed.sucursal })
    }
```
Re-deploy: `supabase functions deploy biller`.

- [ ] **Step 2: Disparar sync fire-and-forget al crear cliente**

En `AddClient.jsx`, importar `syncClientToBiller` desde `../../services/api`. En `handleSubmit`, en la rama de creación (después de obtener `newClient`, línea ~325), agregar tras los avatares:
```javascript
        if (newClient?.id && formData.documentNumber) {
          syncClientToBiller(newClient.id).catch(err => console.warn('Sync Biller falló:', err))
        }
```

- [ ] **Step 3: Badge de estado Biller + retry en el detalle**

En `ClientDetail.jsx`, importar `syncClientToBiller`. En el card de resumen del cliente (junto a los datos del plan/transporte), agregar un chip:
```jsx
              {client.billerClientId ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 border border-green-200">
                  Biller ✓
                </span>
              ) : (
                <button
                  onClick={async () => {
                    try { await syncClientToBiller(client.id); await onRefresh() }
                    catch (e) { window.alert(`No se pudo sincronizar: ${e.message}`) }
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                  title={client.billerSyncError || 'Sin sincronizar en Biller'}
                >
                  Sincronizar Biller
                </button>
              )}
```
(Ubicarlo donde el layout del resumen tenga lugar; usar `roleHasAccess(user?.role,'clients')` no es necesario — todos ven clientes.)

- [ ] **Step 4: Verificar**

Crear un cliente con CI → confirmar en `test.biller.uy` que el receptor aparece y que `clients.biller_client_id` quedó poblado. Para un cliente sin sync, usar el botón "Sincronizar Biller".

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/biller/index.ts src/pages/Clients/AddClient.jsx src/pages/Clients/ClientDetail.jsx
git commit -m "feat(billing): sync_client + auto-sync al crear + badge/retry en detalle"
```

---

### Task 10: Estado DGI (polling) + chip por mes

**Files:**
- Modify: `supabase/functions/biller/index.ts`
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Acción `check_dgi_status` en la Edge Function**

Agregar antes del `return json({ error: 'Acción inválida' }, 400)`:
```typescript
    if (action === 'check_dgi_status') {
      if (!isBilling) return json({ error: 'No autorizado' }, 403)
      const { clientId, year, month } = body
      const { data: inv } = await admin.from('monthly_invoices')
        .select('biller_id').eq('client_id', clientId).eq('year', year).eq('month', month).maybeSingle()
      if (!inv?.biller_id) return json({ error: 'Factura no emitida' }, 422)

      const resp = await fetch(`${BILLER_BASE_URL}/comprobantes/obtener?id=${inv.biller_id}`, { headers: billerHeaders() })
      const raw = await resp.text()
      if (!resp.ok) return json({ error: `Biller HTTP ${resp.status}`, detail: raw.slice(0, 300) }, 502)
      let parsed: { estado?: string }
      try { parsed = JSON.parse(raw) } catch { parsed = {} }
      const estado = (parsed.estado ?? '').toLowerCase()
      const status = estado.includes('acept') ? 'accepted' : estado.includes('rechaz') ? 'rejected' : 'pending_dgi'
      await admin.rpc('set_invoice_dgi_status', { p_client_id: clientId, p_year: year, p_month: month, p_status: status })
      return json({ ok: true, dgiStatus: status, estado: parsed.estado })
    }
```
Re-deploy.

- [ ] **Step 2: Chip DGI en el badge "Facturado"**

En `ClientDetail.jsx`, importar `checkDgiStatus`. En la rama `isInvoiced` del dropdown de factura (después de "Facturado el ..."), agregar:
```jsx
                      <div className="px-3 py-2 text-xs border-b border-gray-100">
                        <span className={
                          invoice.dgiStatus === 'accepted' ? 'text-green-700'
                          : invoice.dgiStatus === 'rejected' ? 'text-red-700' : 'text-amber-700'
                        }>
                          DGI: {invoice.dgiStatus === 'accepted' ? 'Aceptado' : invoice.dgiStatus === 'rejected' ? 'Rechazado' : 'Pendiente'}
                        </span>
                        <button
                          onClick={async () => { try { await checkDgiStatus(client.id, year, month); await onRefresh() } catch (e) { window.alert(e.message) } }}
                          className="ml-2 text-indigo-600 hover:underline"
                        >
                          Actualizar
                        </button>
                      </div>
```

- [ ] **Step 3: Verificar**

En un mes emitido, click "Actualizar" → el chip refleja el estado DGI del ambiente de test.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/biller/index.ts src/pages/Clients/ClientDetail.jsx
git commit -m "feat(billing): polling de estado DGI con chip por mes"
```

---

### Task 11: Anulación (nota de crédito) — superadmin

**Files:**
- Modify: `supabase/functions/biller/index.ts`
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Acción `void_invoice` en la Edge Function**

Agregar antes del `return json({ error: 'Acción inválida' }, 400)`:
```typescript
    if (action === 'void_invoice') {
      if (role !== 'superadmin') return json({ error: 'No autorizado' }, 403)
      const { clientId, year, month } = body
      const { data: inv } = await admin.from('monthly_invoices')
        .select('biller_id').eq('client_id', clientId).eq('year', year).eq('month', month).maybeSingle()
      if (!inv?.biller_id) return json({ error: 'Factura no emitida' }, 422)

      const resp = await fetch(`${BILLER_BASE_URL}/comprobantes/anular`, {
        method: 'POST', headers: billerHeaders(), body: JSON.stringify({ id: inv.biller_id, fecha_emision_hoy: true }),
      })
      const raw = await resp.text()
      if (!resp.ok) return json({ error: `Biller HTTP ${resp.status}`, detail: raw.slice(0, 300) }, 502)
      await admin.rpc('mark_invoice_voided', { p_client_id: clientId, p_year: year, p_month: month })
      return json({ ok: true })
    }
```
Re-deploy.

- [ ] **Step 2: Acción de anular en el dropdown (solo superadmin)**

En `ClientDetail.jsx`, importar `voidInvoice`. En la rama `isInvoiced` del dropdown, al final, agregar (gated por rol):
```jsx
                      {user?.role === 'superadmin' && (
                        <button
                          onClick={async () => {
                            if (!window.confirm('¿Anular la factura? Se generará una nota de crédito en Biller.')) return
                            try { await voidInvoice(client.id, year, month); await onRefresh() }
                            catch (e) { window.alert(`No se pudo anular: ${e.message}`) }
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                        >
                          Anular factura
                        </button>
                      )}
```

- [ ] **Step 3: Verificar**

Como superadmin, anular un comprobante de test → confirmar nota de crédito en `test.biller.uy` y que el mes vuelve a "Sin factura".

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/biller/index.ts src/pages/Clients/ClientDetail.jsx
git commit -m "feat(billing): anulación de comprobante (nota de crédito) para superadmin"
```

---

### Task 12: Emisión masiva desde el Dashboard

**Files:**
- Modify: `src/pages/Dashboard/Dashboard.jsx`

- [ ] **Step 1: Construir la lista de candidatos del mes**

En `Dashboard.jsx`, importar `getClients`, `calculateMonthBilling`, `emitInvoice` desde `../../services/api`, y `roleHasAccess`/`useAuth`. Agregar estado:
```javascript
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkRows, setBulkRows] = useState([]) // { client, amount, status, selected }
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: [] })
```
Función para armar candidatos (usa el `year`/`month` mostrado en el dashboard):
```javascript
  const openBulk = async () => {
    setBulkOpen(true)
    const clients = await getClients()
    const rows = await Promise.all(clients.map(async (c) => {
      let amount = 0, reason = null
      try {
        const b = await calculateMonthBilling(c.id, year, month)
        amount = b.totalChargeableGross
      } catch (_) { reason = 'sin plan' }
      const status = !c.documentNumber ? 'sin CI'
        : amount <= 0 ? 'monto 0'
        : reason ? reason
        : 'listo'
      return { client: c, amount, status, selected: status === 'listo' }
    }))
    setBulkRows(rows)
  }
```

- [ ] **Step 2: Emisión secuencial respetando rate limit (1 req/s)**

```javascript
  const runBulk = async () => {
    const targets = bulkRows.filter(r => r.selected && r.status === 'listo')
    setBulkRunning(true)
    setBulkProgress({ done: 0, total: targets.length, failed: [] })
    const failed = []
    for (let i = 0; i < targets.length; i++) {
      try {
        await emitInvoice(targets[i].client.id, year, month)
      } catch (e) {
        failed.push({ name: `${targets[i].client.firstName} ${targets[i].client.lastName}`, error: e.message })
      }
      setBulkProgress({ done: i + 1, total: targets.length, failed: [...failed] })
      await new Promise(res => setTimeout(res, 1100)) // 1 req/s
    }
    setBulkRunning(false)
  }
```

- [ ] **Step 3: UI del botón + modal**

Agregar (gated por `roleHasAccess(user?.role,'billing')`) un botón "Emitir facturas del mes" que llame `openBulk`, y un `<Modal>` que liste `bulkRows` (nombre, monto, estado, checkbox habilitado solo si `status==='listo'`), una barra de progreso `${bulkProgress.done}/${bulkProgress.total}`, el botón "Emitir seleccionadas" (`runBulk`, disabled si `bulkRunning`), y al final la lista de `bulkProgress.failed` con un botón para reintentar (re-ejecuta `runBulk` filtrando los fallidos). Usar el componente `Modal` de `../../components/ui/Modal` y `Button`.

- [ ] **Step 4: Verificar**

Con 2-3 clientes de prueba con CI, abrir el modal, confirmar estados (los sin CI deshabilitados), emitir seleccionados y ver el progreso. Confirmar en `test.biller.uy` los comprobantes y en `monthly_invoices` los `invoice_status='invoiced'`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard/Dashboard.jsx
git commit -m "feat(billing): emisión masiva mensual desde el dashboard"
```

---

# FASE 3 — Verificación integral

### Task 13: Checklist end-to-end en ambiente de test

**Files:** ninguno (verificación manual + SQL)

- [ ] **Step 1: Verificación de receptores (sync)**

Crear un cliente nuevo con CI → confirmar receptor en `test.biller.uy` y `biller_client_id` no nulo.

- [ ] **Step 2: Verificación de montos vs cálculo**

Para 3 escenarios (sin transporte; con transporte; mes con días `vacation`/prorrateo), comparar el total del e-Ticket en el panel contra:
```sql
SELECT (calculate_month_billing('<id>', <y>, <m>))->>'totalChargeableGross';
```
Expected: coinciden exactamente (gross).

- [ ] **Step 3: Verificación de IVA por línea**

En el comprobante del panel: línea de asistencia con IVA 22%, transporte con IVA 10%. Confirmar que el PDF llegó al email del cliente.

- [ ] **Step 4: DGI + anulación**

Actualizar estado DGI (Task 10) → "Aceptado". Anular (Task 11) → nota de crédito generada; el mes vuelve a "Sin factura".

- [ ] **Step 5: Idempotencia**

Reintentar `emit_invoice` sobre un mes ya emitido → respuesta 409 "ya fue emitida" (no se duplica).

- [ ] **Step 6: Registrar pendientes con soporte Biller**

Confirmar por soporte (no bloquea): endpoint de PDF para poblar `invoice_url`, y endpoint de update de clientes. Documentar la respuesta en el spec.

---

## Pasaje a producción (post-verificación, fuera del alcance de hoy)

1. Cargar CI de todos los clientes reales.
2. Sync masivo (botón por cliente o un loop puntual).
3. `supabase secrets set BILLER_BASE_URL="https://biller.uy/v2" BILLER_TOKEN="<token prod>"` (+ `BILLER_SUCURSAL` si aplica).
4. Primera emisión masiva supervisada.

## Notas para el implementador

- **No hay cultura de tests automatizados** en el repo salvo CRA/jest por defecto. El único test automatizado de este plan es el Deno test del builder (Task 3), que es donde un bug cuesta caro (IVA incorrecto). El resto se verifica manualmente contra el ambiente de test de Biller.
- **El token nunca va al frontend ni al repo**: vive solo como secreto de la Edge Function.
- **Recompilar Tailwind** si algún cambio de UI agrega clases nuevas no presentes: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.
- **month es 0-indexed** en toda la app (year, month) — respetarlo en cada llamada.
