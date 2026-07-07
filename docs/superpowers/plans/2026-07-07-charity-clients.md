# Clientes de beneficencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Agregar clientes de beneficencia que participan de la operativa (transporte, grupos, asistencia) pero quedan fuera de toda facturación, dashboard financiero y métricas comerciales; sí cuentan en asistencia.

**Architecture:** Flag `is_charity` en `clients` + `clients_full`, threadeado por los RPCs de cliente (con guard admin-only). Exclusión aplicada en 4 RPCs de agregación (`WHERE NOT c.is_charity`) y en 2 secciones del dashboard en frontend. Facturación lazy gateada por el flag; al marcar beneficencia se anulan facturas pendientes no emitidas vía RPC nuevo.

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), Jest (craco).

## Global Constraints

- Variables/código en inglés; UI en español. Sin `;` innecesarios en JS/JSX.
- Migraciones vía Supabase MCP `apply_migration`; próxima es la **041**.
- Los RPCs de agregación se recrean copiando su **definición viva** (`pg_get_functiondef`), sumando el filtro — NO se reescriben de memoria.
- Los RPCs de cliente acumulan overloads: hay que `DROP` la firma vieja antes de recrear.
- Charity solo lo edita admin+ (`hasAccess('billing')` en frontend + `is_admin_or_superadmin()` server-side).
- `get_attendance_stats` NO se filtra (asistencia incluye beneficencia).
- Commit termina con: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Migración 041 — flag, view, RPCs de cliente, void RPC

**Files:**
- Create: `supabase/migrations/041_charity_clients.sql`
- Apply: Supabase MCP `apply_migration` (name `charity_clients`)

**Interfaces:**
- Produces: columna `clients.is_charity`; `clients_full."isCharity"`; RPCs `create_client_full`/`update_client_full` con `p_is_charity boolean` final; RPC `void_pending_invoices(uuid)`.

- [ ] **Step 1: Extraer definiciones vivas exactas**

Correr con `mcp__supabase__execute_sql` y guardar los resultados (son la base para editar):
```sql
SELECT pg_get_functiondef('public.create_client_full'::regprocedure);
SELECT pg_get_functiondef('public.update_client_full'::regprocedure);
SELECT pg_get_viewdef('public.clients_full', true);
SELECT oid::regprocedure::text FROM pg_proc WHERE proname IN ('create_client_full','update_client_full');
```
Expected: una sola firma por cada RPC de cliente (si hay más de una, DROP de todas menos la usada). Guardar el texto de las funciones y de la view.

- [ ] **Step 2: Escribir la migración**

Create `supabase/migrations/041_charity_clients.sql` con, en orden:
1. `ALTER TABLE clients ADD COLUMN is_charity BOOLEAN NOT NULL DEFAULT false;`
2. `CREATE OR REPLACE VIEW clients_full AS <cuerpo vivo> , c.is_charity AS "isCharity"` — pegar el `pg_get_viewdef` y agregar la columna al final del SELECT (antes del FROM del nivel superior).
3. `DROP FUNCTION IF EXISTS public.create_client_full(<lista exacta de tipos del step 1>);` y lo mismo para `update_client_full`.
4. Recrear ambas con `CREATE OR REPLACE FUNCTION` (cuerpo vivo del step 1) agregando `p_is_charity boolean DEFAULT false` como último parámetro y:
   - create: en el `INSERT INTO clients (...)` agregar `is_charity` con valor
     `CASE WHEN is_admin_or_superadmin() THEN COALESCE(p_is_charity, false) ELSE false END`.
   - update: en el `UPDATE clients SET ...` agregar
     `is_charity = CASE WHEN is_admin_or_superadmin() THEN COALESCE(p_is_charity, is_charity) ELSE is_charity END`.
5. RPC nuevo:
```sql
CREATE OR REPLACE FUNCTION void_pending_invoices(p_client_id uuid)
RETURNS integer AS $$
DECLARE deleted_count integer;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM monthly_invoices
  WHERE client_id = p_client_id
    AND invoice_status = 'pending'
    AND invoiced_at IS NULL
    AND paid_at IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```
(Verificar en el step 1 que `monthly_invoices` tiene columnas `invoice_status`, `invoiced_at`, `paid_at`; si difieren, ajustar. Confirmar con `SELECT column_name FROM information_schema.columns WHERE table_name='monthly_invoices';`.)

- [ ] **Step 3: Aplicar vía MCP** (`apply_migration` name `charity_clients`). Expected: sin error.

- [ ] **Step 4: Verificar**
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='clients' AND column_name='is_charity';
SELECT 'isCharity' = ANY(ARRAY(SELECT json_object_keys(to_json(t)) FROM clients_full t LIMIT 1)) AS has_col;
```
Expected: fila `is_charity`; `has_col = true` (si hay al menos un cliente).

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/041_charity_clients.sql
git commit -m "feat(clients): migración 041 flag is_charity, RPCs y void_pending_invoices

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Filtrar agregadores contables (migración 042)

**Files:**
- Create: `supabase/migrations/042_charity_exclusion.sql`

**Interfaces:**
- Consumes: `clients.is_charity` (Task 1).
- Produces: versiones filtradas de `get_dashboard_finance_series`, `get_month_collection_panel`, `get_billing_breakdown_rows`, `get_churn_board` (mismas firmas).

- [ ] **Step 1: Extraer definiciones vivas**
```sql
SELECT pg_get_functiondef('public.get_dashboard_finance_series'::regprocedure);
SELECT pg_get_functiondef('public.get_month_collection_panel'::regprocedure);
SELECT pg_get_functiondef('public.get_billing_breakdown_rows'::regprocedure);
SELECT pg_get_functiondef('public.get_churn_board'::regprocedure);
```

- [ ] **Step 2: Escribir la migración** — para cada función, pegar su cuerpo vivo con `CREATE OR REPLACE FUNCTION` y agregar `AND NOT c.is_charity` en el `WHERE` donde se referencia la tabla `clients c`:
  - `get_dashboard_finance_series`: en el join/WHERE del CTE `live` que une a `clients c`.
  - `get_month_collection_panel`: en el `WHERE` del `FROM clients c CROSS JOIN LATERAL ...`.
  - `get_billing_breakdown_rows`: en el `WHERE` (junto a `deleted_at`/`error IS NULL`).
  - `get_churn_board`: en el `WHERE c.deleted_at IS NOT NULL`.
  - Confirmar el alias real de `clients` en cada una (`c`); si difiere, usar el alias correcto.

- [ ] **Step 3: Aplicar vía MCP** (`apply_migration` name `charity_exclusion`). Expected: sin error.

- [ ] **Step 4: Verificar exclusión** — con un cliente charity de prueba:
```sql
-- marcar un cliente existente como charity temporalmente y comprobar que no aparece
-- en el panel de cobranza del mes actual; revertir después.
```
(Detalle en verificación final; alcanza con confirmar que las funciones recrean sin error y devuelven filas para no-charity.)

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/042_charity_exclusion.sql
git commit -m "feat(clients): excluir beneficencia de agregadores contables (finance/panel/breakdown/churn)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Threading del flag + servicio void

**Files:**
- Modify: `src/services/clients/clientTransformers.js` (`transformClientToDb`, `transformUpdateToDb`, `transformClientFromDb`)
- Modify: `src/services/invoices/invoiceService.js` (agregar `voidPendingInvoices`)
- Modify: `src/services/api.js` (re-export `voidPendingInvoices`)

**Interfaces:**
- Produces: `p_is_charity` en payloads de create/update; `client.isCharity` en objetos del frontend; `voidPendingInvoices(clientId): Promise<number>`.

- [ ] **Step 1: `transformClientToDb`** — agregar al objeto de params:
```js
    p_is_charity: client.isCharity || false,
```

- [ ] **Step 2: `transformUpdateToDb`** — agregar condicional (siguiendo el patrón de los demás `p_*`):
```js
  if (client.isCharity !== undefined) params.p_is_charity = client.isCharity
```

- [ ] **Step 3: `transformClientFromDb`** — agregar al objeto devuelto:
```js
    isCharity: row.isCharity || false,
```
(Confirmar el nombre exacto de la propiedad que devuelve la view: `isCharity`.)

- [ ] **Step 4: `voidPendingInvoices` en invoiceService.js**:
```js
export async function voidPendingInvoices(clientId) {
  const { data, error } = await supabase.rpc('void_pending_invoices', { p_client_id: clientId })
  if (error) throw new Error(error.message)
  return data
}
```

- [ ] **Step 5: Re-export en api.js** — agregar `voidPendingInvoices` al bloque de `./invoices/invoiceService`.

- [ ] **Step 6: Verificar imports** — `CI=true npx craco test src/services --watchAll=false`. Expected: PASS (142+).

- [ ] **Step 7: Commit**
```bash
git add src/services/clients/clientTransformers.js src/services/invoices/invoiceService.js src/services/api.js
git commit -m "feat(clients): threading de isCharity y servicio voidPendingInvoices

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wizard AddClient — checkbox + skip pricing/biller + void on edit

**Files:**
- Modify: `src/pages/Clients/AddClient.jsx`

**Interfaces:**
- Consumes: `useAuth().hasAccess`, `voidPendingInvoices`.

- [ ] **Step 1: Estado del plan** — agregar `isCharity: false` al estado del formulario del plan (junto a `hasTransport`).

- [ ] **Step 2: Precargar en edición** — donde se hidrata el form desde el cliente existente, setear `isCharity: client.isCharity || false`.

- [ ] **Step 3: Checkbox en paso 2 (solo admin+)** — dentro del render del paso "Plan y asistencia", gated por `hasAccess('billing')`:
```jsx
{hasAccess('billing') && (
  <label className="flex items-center gap-2 text-sm text-gray-700">
    <input
      type="checkbox"
      checked={form.isCharity}
      onChange={(e) => setForm({ ...form, isCharity: e.target.checked })}
    />
    Cliente de beneficencia (no genera facturación)
  </label>
)}
```
(Ajustar `form`/`setForm` a los nombres reales del estado del paso 2.)

- [ ] **Step 4: Ocultar preview de precio si charity** — envolver el bloque de preview de precio (líneas ~402-437) en `{!form.isCharity && ( ... )}`.

- [ ] **Step 5: Threading en submit** — incluir `isCharity: form.isCharity` en el `clientData` que se pasa a `createClient`/`updateClient`.

- [ ] **Step 6: Skip biller + void on edit** — en `handleSubmit`:
  - No llamar `syncClientToBiller` si `form.isCharity`.
  - En el path de edición, si el flag pasó de `false`→`true` (comparar con el valor original del cliente), llamar `await voidPendingInvoices(clientId)` tras el update.

- [ ] **Step 7: Verificar build** — `CI=true npm run build 2>&1 | grep -E "Compiled|Failed"`. Expected: Compiled successfully.

- [ ] **Step 8: Commit**
```bash
git add src/pages/Clients/AddClient.jsx
git commit -m "feat(clients): checkbox beneficencia en wizard, skip pricing/biller, void al marcar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ClientDetail — badge + gate ensureClientMonths + ocultar montos

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Gate `ensureClientMonths`** — en el efecto que llama `ensureClientMonths(id)` (~línea 176), envolver en `if (!client?.isCharity)`. (Confirmar que `client` ya está cargado; si no, gatear cuando se conozca el flag.)

- [ ] **Step 2: Badge de beneficencia** — cerca del nombre/encabezado, si `client.isCharity`, renderizar un badge (ícono `HeartArrowDown`/`Heart` o similar de iconoir, en violeta). Verificar ícono disponible con `node -e`.

- [ ] **Step 3: Ocultar montos/facturación** — en el calendario y header de detalle, envolver los montos (cobrable/potencial), precios y botones de facturación/cobranza en `{!client.isCharity && ( ... )}`. Mantener el calendario de asistencia visible. (Estos bloques ya están gated por `hasAccess('billing')`; sumar la condición `&& !client.isCharity`.)

- [ ] **Step 4: Verificar build** — `CI=true npm run build 2>&1 | grep -E "Compiled|Failed"`. Expected: Compiled successfully.

- [ ] **Step 5: Commit**
```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(clients): ficha de beneficencia (badge, sin facturación, gate ensureClientMonths)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ClientList — badge + filtro

**Files:**
- Modify: `src/pages/Clients/ClientList.jsx`

- [ ] **Step 1: Filtro** — agregar entrada `isCharity` en `FILTERS_CONFIG` (mirror del bloque `hasTransport`, ~líneas 64-72) y el predicado `matchesCharity` en el memo `filteredClients` (~212-229).

- [ ] **Step 2: Badge** — renderizar chip/dot de beneficencia en card (~398-407/428-444) y row (~495-501/515-521), consistente con el badge de ClientDetail (mismo ícono/color).

- [ ] **Step 3: Verificar build** — `CI=true npm run build 2>&1 | grep -E "Compiled|Failed"`. Expected: Compiled successfully.

- [ ] **Step 4: Commit**
```bash
git add src/pages/Clients/ClientList.jsx
git commit -m "feat(clients): badge y filtro de beneficencia en la lista

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Dashboard — filtrar beneficencia en Commercial y Finance

**Files:**
- Modify: `src/pages/Dashboard/sections/CommercialSection.jsx`
- Modify: `src/pages/Dashboard/sections/FinanceSection.jsx`

- [ ] **Step 1: CommercialSection** — tras `getClients({ includeDeleted: true })` (~línea 58), filtrar `.filter(c => !c.isCharity)` antes de pasar a `commercialStats`/`churnKpis`/`baseComposition`/`flowSeries`.

- [ ] **Step 2: FinanceSection** — tras `getClients({ includeDeleted: true })` (~línea 78), aplicar el mismo `.filter(c => !c.isCharity)` para los cálculos que usan la lista (ARPU/breakeven/counts). El panel de cobranza ya se filtra server-side (Task 2), no requiere cambio adicional.

- [ ] **Step 3: Verificar `getDashboardMetrics`** — comprobar si `FinanceSection`/`Dashboard` sigue usando `getDashboardMetrics`. Si se usa, filtrar charity en `dashboardService.js` (`activeClients` y agregación de invoices). Si no se usa (según memoria del proyecto), no tocar.

- [ ] **Step 4: Verificar build** — `CI=true npm run build 2>&1 | grep -E "Compiled|Failed"`. Expected: Compiled successfully.

- [ ] **Step 5: Commit**
```bash
git add src/pages/Dashboard/sections/CommercialSection.jsx src/pages/Dashboard/sections/FinanceSection.jsx
git commit -m "feat(dashboard): excluir clientes de beneficencia de finanzas y comercial

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verificación final

- Suite de servicios verde: `CI=true npx craco test src/services --watchAll=false`.
- Build limpio: `CI=true npm run build`.
- BD (execute_sql, con cleanup): marcar un cliente de prueba como charity →
  1. no aparece en `get_month_collection_panel`, `get_billing_breakdown_rows`, `get_churn_board`, `get_dashboard_finance_series` (previsto);
  2. **sí** aparece en `get_attendance_stats` si tiene registros de asistencia;
  3. `void_pending_invoices` borra solo pendientes no emitidas/no pagadas;
  4. revertir el flag del cliente de prueba.
- Confirmar transporte/grupos siguen incluyendo al cliente (sin cambios de código allí).
